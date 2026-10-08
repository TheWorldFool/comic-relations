import type { ReadingPhase } from '../shared/types.js';
import { identityView } from '../shared/identity-people.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { dataDir, projectDir } from './store.js';
import type { Reading } from './analysis.js';
import { readingProtocol } from './reading-prompt.js';
import { parseReadingOutput, describeReadingIssues, ReadingOutputError, isModelRefusal, ModelRefusalError } from './reading-output.js';
import type { Project, Settings, IdentityReviewResult } from '../shared/types.js';
import { readingOptions, readingContext, referenceCharacters } from './reading-request.js';
import { ReadingImages } from './reading-images.js';
import { memoryIssue } from './reading-memory.js';
import { reviewIdentities, identityReviewPrompt } from './identity-review.js';
import { coverReferencePages, coverReferenceLabel } from './identity-context.js';
import { fetchWithRetry } from './request-retry.js';
import { createHash } from 'node:crypto';
import { ModelJsonError, parseModelJson, parseIdentityReviewJson } from './model-json.js';
const configPath = path.join(dataDir, 'settings.json');

type Config = { baseUrl: string; model: string; apiKey?: string };
export async function config(): Promise<Config> {
  const saved = JSON.parse(await readFile(configPath, 'utf8').catch(() => '{}'));
  const fileKey = process.env.DEEPSEEK_API_KEY_FILE ? (await readFile(process.env.DEEPSEEK_API_KEY_FILE, 'utf8').catch(() => '')).trim() : '';
  return { baseUrl: saved.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', model: saved.model || process.env.DEEPSEEK_MODEL || 'deepseek-flash', apiKey: Object.hasOwn(saved, 'apiKey') ? saved.apiKey : process.env.DEEPSEEK_API_KEY || fileKey };
}
export async function publicSettings(): Promise<Settings> { const c = await config(); return { baseUrl: c.baseUrl, model: c.model, hasKey: !!c.apiKey }; }
export async function saveSettings(input: unknown) {
  const data = z.object({ baseUrl: z.url(), model: z.string().trim().min(1), apiKey: z.string().trim().optional() }).parse(input);
  const url = new URL(data.baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('API 地址需要 HTTPS，本地服务可用 HTTP。');
  const old = await config();
  await writeFile(configPath, JSON.stringify({ ...data, apiKey: data.apiKey || (old.baseUrl === data.baseUrl ? old.apiKey : '') }, null, 2), { mode: 0o600 });
}
class ModelTruncationError extends Error {
  constructor(public readonly metadata:Record<string,unknown>){
    super('模型自动恢复后仍未返回完整结果，本页未提交，已保留已读进度。请点击“继续分析”重试；截断用量已记录在本机诊断文件中。');
    this.name='ModelTruncationError';
  }
}
const numeric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
export type TokenUsage = { promptTokens?:number; completionTokens?:number; reasoningTokens?:number };
// Accumulated over the attempts of one page read; elapsed time is measured by the caller.
export type PageMetrics = { onPhase?:(phase:ReadingPhase)=>void; identityReviewMs?:number; identityReviewResult?:IdentityReviewResult; identityReviewRequests?:number; attempts:number; promptTokens:number; completionTokens:number; reasoningTokens:number; preparationMs?:number; modelMs?:number; contextCharacters?:number; imageCount?:number; model?:string; endpointOrigin?:string; promptHash?:string; reasoningEffort?:string; maxTokens?:number };
export async function completion(messages: unknown[], signal: AbortSignal, recoverTruncation=false, onAdjustment?:(adjustments:string[])=>void, onUsage?:(usage:TokenUsage)=>void, onRequest?:(model:string,origin:string,options:ReturnType<typeof readingOptions>)=>void, purpose:'reading'|'identity-review'='reading') {
  const c = await config();
  if (!c.apiKey) throw new Error('请先在阅读设置中填写 DeepSeek API Key。');
  const options=readingOptions(c.model,recoverTruncation);
  const response = await fetchWithRetry(`${c.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` }, body: JSON.stringify({ model: c.model, messages, response_format: { type: 'json_object' }, ...options, stream: false }), signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]) },()=>onRequest?.(c.model,new URL(c.baseUrl).origin,options));
  if (!response.ok) {
    const hints: Record<number, string> = { 401: 'API Key 无效', 402: 'API 余额不足', 429: '请求限流，请稍后继续', 400: '请求被拒绝，请检查模型是否支持图片和 JSON 输出' };
    throw new Error(`DeepSeek ${response.status}：${hints[response.status] || '服务请求失败，请稍后继续'}`);
  }
  const data = await response.json() as { choices?: { message: { content: string; refusal?:string }; finish_reason?: string }[];usage?:{prompt_tokens?:number;completion_tokens?:number;completion_tokens_details?:{reasoning_tokens?:number}} };
  // Report usage before any early return: rejected and truncated attempts are billed too.
  if(data.usage)onUsage?.({promptTokens:numeric(data.usage.prompt_tokens),completionTokens:numeric(data.usage.completion_tokens),reasoningTokens:numeric(data.usage.completion_tokens_details?.reasoning_tokens)});
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) throw new ModelRefusalError();
  const content = choice?.message?.content;
  if(isModelRefusal(content))throw new ModelRefusalError();
  // Even valid-looking JSON must never be committed when the provider says it was cut off.
  if (choice?.finish_reason === 'length') {
    if(typeof content==='string'){try{if(isModelRefusal(JSON.parse(content)))throw new ModelRefusalError();}catch(error){if(error instanceof ModelRefusalError)throw error;}}
    throw new ModelTruncationError({finishReason:'length',model:c.model,request:options,promptTokens:numeric(data.usage?.prompt_tokens),completionTokens:numeric(data.usage?.completion_tokens),reasoningTokens:numeric(data.usage?.completion_tokens_details?.reasoning_tokens),contentCharacters:typeof content==='string'?content.length:0});
  }
  const {output,adjustments}=(purpose==='identity-review'?parseIdentityReviewJson:parseModelJson)(content,{finishReason:choice?.finish_reason,model:c.model,contentCharacters:typeof content==='string'?content.length:0});
  if (isModelRefusal(output)) throw new ModelRefusalError();
  if(adjustments.length)onAdjustment?.(adjustments);
  return output;
}
export async function testConnection() {
  const tiny = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } }).png().toBuffer();
  await completion([{ role: 'user', content: [{ type: 'text', text: 'Return JSON only: {"color":"name of the image color"}' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${tiny.toString('base64')}` } }] }], new AbortController().signal);
}
export async function readPage(project: Project, signal: AbortSignal, metrics?: PageMetrics, preparedImages?: ReadingImages): Promise<Reading> {
  const images = preparedImages || new ReadingImages(project.id, signal);
  try { return await readPreparedPage(identityView(project), signal, images, metrics); }
  finally { if (!preparedImages) images.close(); }
}
export async function auditIdentity(project:Project,personId:string,signal:AbortSignal,metrics:PageMetrics){
  project=identityView(project);
  const person=project.characters.find(c=>c.id===personId);
  if(!person||!project.processed)throw new Error('请选择已有出场记录的人物。');
  let last=project.processed-1;
  while(last>=0&&project.pages[last].analysis?.kind!=='story')last--;
  if(last<0)throw new Error('没有可复核的正文记录。');
  const reading:Reading={kind:'story',confidence:1,reason:'身份复核',summary:'',storyTime:'',memory:'',turningPoint:null,relationChanges:[],characters:[{
    id:person.id,name:person.name,aliases:person.aliases,description:person.description,appearance:person.appearance,avatarBox:null,
    identityConcern:'用户要求复核此人与已有档案是否重复。该人物不一定出现在最近页，优先比较其已有参考图；证据不足返回 pending。',
  }]};
  const view={...project,processed:last},images=new ReadingImages(project.id,signal);
  const started=Date.now();metrics.promptHash=createHash('sha256').update(identityReviewPrompt).digest('hex');
  try{return await reviewIdentities(view,reading,images,signal,async messages=>{
    metrics.identityReviewRequests=1;
    return completion(messages,signal,false,undefined,usage=>{
      metrics.promptTokens+=usage.promptTokens||0;metrics.completionTokens+=usage.completionTokens||0;metrics.reasoningTokens+=usage.reasoningTokens||0;
    },(model,origin,options)=>{metrics.attempts++;metrics.model=model;metrics.endpointOrigin=origin;metrics.maxTokens=options.max_tokens;},'identity-review');
  },'archive',result=>{metrics.identityReviewResult=result;});}finally{metrics.modelMs=Date.now()-started;metrics.identityReviewMs=metrics.modelMs;images.close();}
}
async function readPreparedPage(project: Project, signal: AbortSignal, images: ReadingImages, metrics?: PageMetrics): Promise<Reading> {
  const page = project.pages[project.processed];
  metrics?.onPhase?.('preparing');
  const prepareStarted = Date.now();
  const context = readingContext(project);
  const protocol = readingProtocol(context.memoryInstruction);
  const contextText = JSON.stringify(context);
  let previousIndex = project.processed - 1;
  while (previousIndex >= 0 && project.pages[previousIndex].analysis?.kind !== 'story') previousIndex--;
  const previous = project.pages[previousIndex];
  const references = referenceCharacters(project).filter(person => person.avatar&&person.identityState!=='pending');
  const [image, previousImage, portraits, covers] = await Promise.all([
    images.page(page),
    previous ? images.page(previous, 'reference') : Promise.resolve(null),
    Promise.all(references.map(async person => ({ person, image: await images.avatar(person.avatar!) }))),
    Promise.all(coverReferencePages(project).map(async cover=>({...cover,image:await images.page(cover.page,'reference').catch(()=>null)}))),
  ]);
  signal.throwIfAborted();
  const content: unknown[] = [{ type: 'text', text: `阅读当前页，正文分格方向为${project.direction === 'rtl' ? '从右到左' : '从左到右'}。forcedStory=true 时用户已确认为正文。前文上下文：${contextText}` }, { type: 'image_url', image_url: { url: image } }];
  if (previousImage) content.push({type:'text',text:`第 ${previousIndex+1} 页已读正文参考，仅用于辨认同一人物和场景衔接，不是当前页，不再次提取事件：`},{type:'image_url',image_url:{url:previousImage}});
  for (const { person, image } of portraits) if (image) content.push({type:'text',text:`已知人物参考头像（不是当前页）：${person.id} ${person.name}`},{type:'image_url',image_url:{url:image}});
  for(const cover of covers)if(cover.image)content.push({type:'text',text:coverReferenceLabel(cover.number)},{type:'image_url',image_url:{url:cover.image}});
  content.push({type:'text',text:protocol.task});
  if (metrics) {
    metrics.preparationMs = Date.now() - prepareStarted;
    metrics.contextCharacters = contextText.length;
    metrics.promptHash = createHash('sha256').update(protocol.system).digest('hex');
    metrics.imageCount = 1 + Number(!!previousImage) + portraits.filter(p => p.image).length+covers.filter(c=>c.image).length;
  }
  // File processing overlaps the request; the next model call still waits for
  // this page to be validated, applied and saved by run().
  images.prefetch(project);
  const messages: {role: string; content: unknown}[] = [
    { role:'system', content: protocol.system },
    { role:'user', content },
  ];
  const attempts: unknown[] = [];
  let recoverTruncation=false;
  const diagnosticDir = path.join(projectDir(project.id), 'diagnostics');
  // Diagnostics are best effort: a read-only or full data directory must not
  // turn a valid page into a failed one.
  const saveDiagnostic = async (resolved: boolean) => {
    try {
      await mkdir(diagnosticDir, { recursive: true });
      await writeFile(path.join(diagnosticDir, `${page.id}.json`), JSON.stringify({ page:project.processed+1, pageId:page.id, recordedAt:new Date().toISOString(), resolved, attempts }, null, 2));
    } catch { /* keep the reading result even when the diagnostic cannot be stored */ }
  };
  // One correction request at most; never skip the page or replace missing story data.
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    metrics?.onPhase?.(attempt?'repairing':'reading');

    let output: unknown;
    let detail = '';
    let failedText = '';
    let jsonMetadata:Record<string,unknown>|undefined;
    const jsonAdjustments:string[]=[];
    const collectUsage=(usage:TokenUsage)=>{if(!metrics)return;metrics.promptTokens+=usage.promptTokens||0;metrics.completionTokens+=usage.completionTokens||0;metrics.reasoningTokens+=usage.reasoningTokens||0;};
    const modelStarted = Date.now();
    try {
      try { output = await completion(messages, signal,recoverTruncation,adjustments=>jsonAdjustments.push(...adjustments),collectUsage,(model,origin,options)=>{if(metrics){metrics.attempts++;metrics.model=model;metrics.endpointOrigin=origin;metrics.reasoningEffort='reasoning_effort' in options?String(options.reasoning_effort):'thinking' in options?'none':'provider-default';metrics.maxTokens=options.max_tokens;}}); }
      finally { if (metrics) metrics.modelMs = (metrics.modelMs || 0) + Date.now() - modelStarted; }
    }
    catch (error) {
      if(error instanceof ModelTruncationError){
        attempts.push({attempt:attempt+1,type:'truncation',...error.metadata});
        await saveDiagnostic(false);
        if(attempt===1)throw error;
        recoverTruncation=true;
        // Keep the original image/context. Do not try to stitch together partial JSON.
        messages.push({role:'user',content:'上一轮因输出长度限制中断，请重新返回本页完整 JSON，不续写半截内容。保留全部有证据的剧情和变化，但不要复述旧档案、逐字对白或推理过程。仅返回新增/变化的档案与状态，证据用简短句；无需变化的数组用 []。不得删除实际信息来凑格式，不得猜测。' + '\n' + protocol.task});
        continue;
      }
      if (!(error instanceof ModelJsonError)) throw error;
      detail = error.detail; failedText = error.content; jsonMetadata=error.metadata;
    }
    if (!detail) {
      const { parsed, adjustments } = parseReadingOutput(output);
      adjustments.unshift(...jsonAdjustments);
      const checked = parsed.success ? protocol.schema.safeParse(parsed.data) : parsed;
      const memoryError = checked.success ? memoryIssue(project, checked.data) : undefined;
      if (checked.success && !memoryError) {
        if (attempts.length || adjustments.length) {
          attempts.push({ attempt:attempt+1, output, adjustments, valid:true });
          await saveDiagnostic(true);
        }
        const reading:Reading=checked.data;
        if(reading.kind==='story'||page.override==='story'){
          metrics?.onPhase?.('identity');
          reading.identityReview=await reviewIdentities(project,reading,images,signal,async reviewMessages=>{
            const started=Date.now();
            if(metrics){
              metrics.identityReviewRequests=(metrics.identityReviewRequests||0)+1;
              metrics.promptHash=createHash('sha256').update(protocol.system+'\n'+identityReviewPrompt).digest('hex');
            }
            try{return await completion(reviewMessages,signal,false,undefined,collectUsage,()=>{if(metrics)metrics.attempts++;},'identity-review');}
            finally{if(metrics){const elapsed=Date.now()-started;metrics.modelMs=(metrics.modelMs||0)+elapsed;metrics.identityReviewMs=(metrics.identityReviewMs||0)+elapsed;}}
          },'reading',result=>{if(metrics)metrics.identityReviewResult=result;});
        }
        return reading;
      }
      const issues = checked.success ? [{path:['memoryMode'],message:memoryError!}] : checked.error.issues;
      detail = describeReadingIssues(issues);
      failedText = JSON.stringify(output);
      attempts.push({ attempt:attempt+1, output, issues, adjustments });
    } else attempts.push({ attempt:attempt+1, rawContent:failedText, error:detail, ...jsonMetadata });
    await saveDiagnostic(false);
    if (attempt === 1) throw new ReadingOutputError(detail);
    messages.push(
      { role:'assistant', content:failedText || '{}' },
      { role:'user', content:`上一条输出未通过校验：${detail}\n${protocol.task}\n请根据同一页漫画和前文，重新返回完整 JSON。只修正格式或补齐从原页可确认的字段，不添加臆测，不删除人物或关系以规避校验。时间不明用空字符串，无别名用 []，头像框不确定用 null；confidence 为 0~1 数字，directed 为布尔值，人物 id 只能含英文字母、数字、下划线和短横线。不要返回解释、Markdown 或 Schema。` },
    );
  }
  throw new Error('阅读输出处理失败。');
}
