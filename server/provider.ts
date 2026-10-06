import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { dataDir, projectDir } from './store.js';
import { readingSchema, systemPrompt, type Reading } from './analysis.js';
import { parseReadingOutput, describeReadingIssues, ReadingOutputError, isModelRefusal, ModelRefusalError } from './reading-output.js';
import type { Project, Settings } from '../shared/types.js';
import { readingOptions, readingContext, referenceCharacters } from './reading-request.js';
import { ReadingImages } from './reading-images.js';
import { memoryIssue } from './reading-memory.js';
import { ModelJsonError, parseModelJson } from './model-json.js';
const configPath = path.join(dataDir, 'settings.json');
const modelReadingSchema = readingSchema.extend({memoryMode:readingSchema.shape.memoryMode.unwrap(),threadChanges:readingSchema.shape.threadChanges.unwrap()});
const modelReadingSchemaText = JSON.stringify(z.toJSONSchema(modelReadingSchema));

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
export type PageMetrics = { attempts:number; promptTokens:number; completionTokens:number; reasoningTokens:number; preparationMs?:number; modelMs?:number; contextCharacters?:number; imageCount?:number };
export async function completion(messages: unknown[], signal: AbortSignal, recoverTruncation=false, onAdjustment?:(adjustments:string[])=>void, onUsage?:(usage:TokenUsage)=>void) {
  const c = await config();
  if (!c.apiKey) throw new Error('请先在阅读设置中填写 DeepSeek API Key。');
  const options=readingOptions(c.model,recoverTruncation);
  const response = await fetch(`${c.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` }, body: JSON.stringify({ model: c.model, messages, response_format: { type: 'json_object' }, ...options, stream: false }), signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]) });
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
  const {output,adjustments}=parseModelJson(content,{finishReason:choice?.finish_reason,model:c.model,contentCharacters:typeof content==='string'?content.length:0});
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
  try { return await readPreparedPage(project, signal, images, metrics); }
  finally { if (!preparedImages) images.close(); }
}
async function readPreparedPage(project: Project, signal: AbortSignal, images: ReadingImages, metrics?: PageMetrics): Promise<Reading> {
  const page = project.pages[project.processed];
  const prepareStarted = Date.now();
  const context = readingContext(project);
  const contextText = JSON.stringify(context);
  let previousIndex = project.processed - 1;
  while (previousIndex >= 0 && project.pages[previousIndex].analysis?.kind !== 'story') previousIndex--;
  const previous = project.pages[previousIndex];
  const references = referenceCharacters(project).filter(person => person.avatar);
  const [image, previousImage, portraits] = await Promise.all([
    images.page(page),
    previous ? images.page(previous, 'reference') : Promise.resolve(null),
    Promise.all(references.map(async person => ({ person, image: await images.avatar(person.avatar!) }))),
  ]);
  signal.throwIfAborted();
  const content: unknown[] = [{ type: 'text', text: `阅读当前页，正文分格方向为${project.direction === 'rtl' ? '从右到左' : '从左到右'}。forcedStory=true 时用户已确认为正文。前文上下文：${contextText}` }, { type: 'image_url', image_url: { url: image } }];
  if (previousImage) content.push({type:'text',text:`第 ${previousIndex+1} 页已读正文参考，仅用于辨认同一人物和场景衔接，不是当前页，不再次提取事件：`},{type:'image_url',image_url:{url:previousImage}});
  for (const { person, image } of portraits) if (image) content.push({type:'text',text:`已知人物参考头像（不是当前页）：${person.id} ${person.name}`},{type:'image_url',image_url:{url:image}});
  if (metrics) {
    metrics.preparationMs = Date.now() - prepareStarted;
    metrics.contextCharacters = contextText.length;
    metrics.imageCount = 1 + Number(!!previousImage) + portraits.filter(p => p.image).length;
  }
  // File processing overlaps the request; the next model call still waits for
  // this page to be validated, applied and saved by run().
  images.prefetch(project);
  const messages: {role: string; content: unknown}[] = [
    { role:'system', content: `${systemPrompt}\n可处理页面的输出必须符合以下 JSON Schema（不要输出 Schema 本身；无法安全处理时只返回前述 blocked 对象）：${modelReadingSchemaText}` },
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
    if(metrics)metrics.attempts++;
    let output: unknown;
    let detail = '';
    let failedText = '';
    let jsonMetadata:Record<string,unknown>|undefined;
    const jsonAdjustments:string[]=[];
    const collectUsage=(usage:TokenUsage)=>{if(!metrics)return;metrics.promptTokens+=usage.promptTokens||0;metrics.completionTokens+=usage.completionTokens||0;metrics.reasoningTokens+=usage.reasoningTokens||0;};
    const modelStarted = Date.now();
    try {
      try { output = await completion(messages, signal,recoverTruncation,adjustments=>jsonAdjustments.push(...adjustments),collectUsage); }
      finally { if (metrics) metrics.modelMs = (metrics.modelMs || 0) + Date.now() - modelStarted; }
    }
    catch (error) {
      if(error instanceof ModelTruncationError){
        attempts.push({attempt:attempt+1,type:'truncation',...error.metadata});
        await saveDiagnostic(false);
        if(attempt===1)throw error;
        recoverTruncation=true;
        // Keep the original image/context. Do not try to stitch together partial JSON.
        messages.push({role:'user',content:'上一轮因输出长度限制中断，请重新返回本页完整 JSON，不续写半截内容。保留全部有证据的剧情和变化，但不要复述旧档案、逐字对白或推理过程。仅返回新增/变化的档案与状态，证据用简短句；无需变化的数组用 []。不得删除实际信息来凑格式，不得猜测。'});
        continue;
      }
      if (!(error instanceof ModelJsonError)) throw error;
      detail = error.detail; failedText = error.content; jsonMetadata=error.metadata;
    }
    if (!detail) {
      const { parsed, adjustments } = parseReadingOutput(output);
      adjustments.unshift(...jsonAdjustments);
      const memoryError = parsed.success ? (!parsed.data.memoryMode ? 'memoryMode: 必须明确 delta 或 checkpoint，不能把增量误作完整记忆' : !parsed.data.threadChanges ? 'threadChanges: 无线索变化时返回 []' : memoryIssue(project, parsed.data)) : undefined;
      if (parsed.success && !memoryError) {
        if (attempts.length || adjustments.length) {
          attempts.push({ attempt:attempt+1, output, adjustments, valid:true });
          await saveDiagnostic(true);
        }
        return parsed.data;
      }
      const issues = parsed.success ? [{path:['memoryMode'],message:memoryError!}] : parsed.error.issues;
      detail = describeReadingIssues(issues);
      failedText = JSON.stringify(output);
      attempts.push({ attempt:attempt+1, output, issues, adjustments });
    } else attempts.push({ attempt:attempt+1, rawContent:failedText, error:detail, ...jsonMetadata });
    await saveDiagnostic(false);
    if (attempt === 1) throw new ReadingOutputError(detail);
    messages.push(
      { role:'assistant', content:failedText || '{}' },
      { role:'user', content:`上一条输出未通过校验：${detail}\n请根据同一页漫画和前文，重新返回完整 JSON。只修正格式或补齐从原页可确认的字段，不添加臆测，不删除人物或关系以规避校验。时间不明用空字符串，无别名用 []，头像框不确定用 null；confidence 为 0~1 数字，directed 为布尔值，人物 id 只能含英文字母、数字、下划线和短横线。不要返回解释、Markdown 或 Schema。` },
    );
  }
  throw new Error('阅读输出处理失败。');
}
