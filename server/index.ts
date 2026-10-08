import { identityPeople } from '../shared/identity-people.js';
import { bindAppearances } from './appearances.js';
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { projectsDir, projectDir, readProject, saveProject, listProjects, listProjectEntries, restoreProject, dataDir } from './store.js';
import { publicSettings, saveSettings, readPage, testConnection, auditIdentity, type PageMetrics } from './provider.js';
import { applyReading, resetAnalysis, validateReferences, type Reading } from './analysis.js';
import { describeReadingIssues, ModelRefusalError, isModelRefusal } from './reading-output.js';
import type { Project, Page } from '../shared/types.js';
import { mergeCharacters, resolveIdentities } from './identity.js';
import { correctionSchema, correctProject } from './corrections.js';
import { confirmIdentity, addReference } from './identity-state.js';
import { recordReadingRun, ensureReadingRuns } from './reading-timing.js';
import { reorderPages } from './page-order.js';
import { classifyPages } from './page-selection.js';
import { ReadingImages } from './reading-images.js';
import { pagesClassified } from '../shared/page-selection.js';
import { researchBackground } from './background-research.js';

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) { next(); return; }
  // A malformed Origin header must not reach the URL parser; treat it as non-local.
  let host: string;
  try { host = new URL(origin).hostname; } catch { res.status(403).json({ error: '仅允许本地访问。' }); return; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { res.status(403).json({ error: '仅允许本地访问。' }); return; }
  next();
});
app.use(express.json({ limit: '1mb' }));
// Serve image directories only; project/config files are never exposed as static files.
app.get('/media/:project/:folder/:file', (req, res) => {
  if (!['images','thumbs','avatars'].includes(req.params.folder) || !/^[a-zA-Z0-9_-]+\.jpg$/.test(req.params.file)) { res.sendStatus(404); return; }
  res.sendFile(path.join(projectDir(req.params.project), req.params.folder, req.params.file));
});
const tempDir = path.join(dataDir, 'tmp'); await mkdir(tempDir, { recursive: true });
const upload = multer({ dest: tempDir, preservePath: true, limits: { fileSize: 32 * 1024 * 1024, files: 1000 }, fileFilter: (_req, file, cb) => {
  // Reject unsupported files loudly: silently dropping them would import a
  // different page count than the user selected.
  if (/\.(jpe?g|png|webp|gif)$/i.test(file.originalname)) { cb(null, true); return; }
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
  cb(new Error(`不支持的文件“${name.length > 80 ? `…${name.slice(-80)}` : name}”：请只导入 JPG、PNG、WebP 或 GIF 图片。`));
} });
const jobs = new Map<string, AbortController>();
const locks = new Set<string>();
async function exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (locks.has(id) || jobs.has(id)) throw new Error('项目正在处理，请暂停后再修改。');
  locks.add(id); try { return await fn(); } finally { locks.delete(id); }
}
// Provider and library errors can embed absolute filesystem paths, and job errors
// end up in project snapshots users paste into bug reports. Only curated text is surfaced.
function describeError(error: Error & { code?: string }) {
  if (error.code === 'ENOENT') return '找不到项目或文件。';
  if (/Input file is missing|Input (?:file|buffer) contains unsupported image format/i.test(error.message || '')) return '页面图片文件缺失或已损坏，无法读取。请重新导入这一页。';
  return error.message || '出现未知错误，请重试。';
}
for (const project of await listProjects()) {
  if (project.status === 'running') { project.status = 'paused'; project.error = '服务重启，已保留完成的页面，可继续阅读。'; await saveProject(project); }
  const pending = project.pages[project.processed];
  if (pending?.analysis && isModelRefusal(pending.analysis)) {
    pending.analysis = {kind:'blocked',confidence:1,reason:new ModelRefusalError().message,summary:'',storyTime:''};
    project.status = 'paused'; project.error = new ModelRefusalError().message; await saveProject(project);
  }
}
app.get('/api/settings', async (_req, res) => { res.json(await publicSettings()); });
app.put('/api/settings', async (req, res) => {
  if (jobs.size) throw new Error('请先暂停阅读，再修改模型配置。');
  await saveSettings(req.body); res.json(await publicSettings());
});
app.post('/api/settings/test', async (_req, res) => { await testConnection(); res.json({ ok: true }); });
app.get('/api/projects', async (_req, res) => { res.json(await listProjectEntries()); });
app.post('/api/projects', async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
  const project: Project = { id: randomUUID(), name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), direction: 'rtl', pages: [], characters: [], relations: [], stages: [], memory: '', processed: 0, status: 'idle' };
  await saveProject(project); res.status(201).json(project);
});
app.get('/api/projects/:id', async (req, res) => {
  const project=await readProject(req.params.id);
  // A final snapshot may be visible on disk before the job's final save and
  // lock release finish. Do not invite the UI to resume/edit during that gap.
  if(jobs.has(project.id))project.status='running';
  res.json(project);
});
app.post('/api/projects/:id/restore',async(req,res)=>{
  if(req.body?.confirm!==true)throw new Error('请确认恢复备份；恢复前的项目文件会另行保留。');
  res.json(await exclusive(req.params.id,()=>restoreProject(String(req.params.id))));
});
app.get('/api/projects/:id/export', async (req, res) => {
  const p = await readProject(req.params.id);
  res.setHeader('Content-Disposition', `attachment; filename="comic-relations-${p.id}.json"`); res.json(p);
});
app.post('/api/projects/:id/pages', upload.array('files', 1000), async (req, res) => {
  const files = req.files as Express.Multer.File[];
  const created: string[] = [];
  try {
    const projectId = String(req.params.id);
    const p = await exclusive(projectId, async () => {
      const project = await readProject(projectId);
      if (!files?.length) throw new Error('请选择 JPG、PNG、WebP 或 GIF 图片。');
      const dir = projectDir(project.id);
      await Promise.all(['images','thumbs','avatars'].map(folder => mkdir(path.join(dir, folder), { recursive: true })));
      const pages: Page[] = [];
      for (const file of files) {
        const id = randomUUID();
        const imagePath = path.join(dir, 'images', `${id}.jpg`); const thumbPath = path.join(dir, 'thumbs', `${id}.jpg`);
        created.push(imagePath, thumbPath);
        const result = await sharp(file.path, { limitInputPixels: 100_000_000 }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 94 }).toFile(imagePath);
        await sharp(imagePath).resize({ width: 160, height: 220, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toFile(thumbPath);
        const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
        pages.push({ id, name, image: `/media/${project.id}/images/${id}.jpg`, thumbnail: `/media/${project.id}/thumbs/${id}.jpg`, width: result.width, height: result.height, override: 'auto' });
      }
      pages.sort((a,b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      project.pages.push(...pages);
      project.canUndoMerge=false;
      if (project.status === 'completed') project.status = 'paused';
      await saveProject(project); return project;
    });
    res.json(p);
  } catch (error) { await Promise.all(created.map(file => rm(file, { force: true }))); throw error; }
  finally { await Promise.all((files || []).map(file => rm(file.path, { force: true }))); }
});
app.patch('/api/projects/:id', async (req, res) => {
  const data = z.object({ name: z.string().trim().min(1).max(100).optional(), direction: z.enum(['rtl','ltr']).optional(),workContext:z.object({originalWork:z.string().trim().max(300),background:z.string().trim().max(6000),characterGuide:z.string().trim().max(10000),sources:z.array(z.object({title:z.string(),url:z.url().refine(url=>/^https?:\/\//i.test(url))})).max(20).optional()}).optional() }).parse(req.body);
  res.json(await exclusive(req.params.id, async () => {
    const p = await readProject(req.params.id);
    if (data.direction && data.direction !== p.direction) resetAnalysis(p);
    Object.assign(p, data); p.canUndoMerge=false; await saveProject(p); return p;
  }));
});
app.put('/api/projects/:id/page-selection',async(req,res)=>{
  const input=z.object({pages:z.array(z.object({id:z.string(),purpose:z.enum(['story','cover','ad','extra'])})),resetAnalysis:z.boolean().optional()}).parse(req.body);
  res.json(await exclusive(req.params.id,async()=>{const p=await readProject(req.params.id);classifyPages(p,input.pages,input.resetAnalysis);await saveProject(p);return p;}));
});
app.post('/api/projects/:id/background/research',async(req,res)=>{
  const {hint}=z.object({hint:z.string().trim().max(300).optional()}).parse(req.body||{});
  res.json(await exclusive(req.params.id,async()=>{
    const p=await readProject(req.params.id);
    if(!pagesClassified(p.pages))throw new Error('请先确认正文、封面和附页划分，再识别作品背景。');
    p.backgroundResearch=await researchBackground(p,AbortSignal.timeout(360000),hint);
    p.canUndoMerge=false;
    await saveProject(p);return p;
  }));
});
app.post('/api/projects/:id/background/apply',async(req,res)=>{
  const {researchId}=z.object({researchId:z.string()}).parse(req.body);
  res.json(await exclusive(req.params.id,async()=>{
    const p=await readProject(req.params.id),r=p.backgroundResearch;
    if(!r||r.id!==researchId||!r.sources.length||(!r.background&&!r.characterGuide))throw new Error('没有可采用的检索结果，请重新查找。');
    p.workContext={originalWork:r.originalWork,background:r.background,characterGuide:r.characterGuide,sources:r.sources};r.accepted=true;
    p.canUndoMerge=false;
    await saveProject(p);return p;
  }));
});
const mergeStateHash=(p:Project)=>createHash('sha256').update(JSON.stringify({...p,updatedAt:undefined})).digest('hex');
app.post('/api/projects/:id/characters/merge',async(req,res)=>{
  const {source,target}=z.object({source:z.string(),target:z.string()}).parse(req.body);
  res.json(await exclusive(req.params.id,async()=>{
    const p=await readProject(req.params.id),before=structuredClone(p);
    mergeCharacters(p,source,target);p.canUndoMerge=true;p.canRewindMerge=true;
    await writeFile(path.join(projectDir(p.id),'identity-merge-backup.json'),JSON.stringify({before,afterHash:mergeStateHash(p)}));
    await saveProject(p);return p;
  }));
});
app.post('/api/projects/:id/characters/merge/undo',async(req,res)=>{
  res.json(await exclusive(req.params.id,async()=>{
    const p=await readProject(req.params.id);
    const backup=JSON.parse(await readFile(path.join(projectDir(p.id),'identity-merge-backup.json'),'utf8').catch(()=>'null')) as {before:Project;afterHash:string}|null;
    if(!p.canUndoMerge||!backup||backup.afterHash!==mergeStateHash(p))throw new Error('合并后已有新的阅读或编辑，不能直接撤销。请先核对现有档案。');
    const restored=backup.before;restored.canUndoMerge=false;restored.canRewindMerge=false;await saveProject(restored);return restored;
  }));
});
app.post('/api/projects/:id/characters/:characterId/review',async(req,res)=>{
  res.json(await exclusive(req.params.id,async()=>{
    const p=await readProject(req.params.id),started=Date.now();
    const metrics:PageMetrics={attempts:0,promptTokens:0,completionTokens:0,reasoningTokens:0};
    let outcome:'success'|'error'='error';
    try{
      const decisions=await auditIdentity(p,String(req.params.characterId),AbortSignal.timeout(180000),metrics);
      const decision=decisions[0];
      if(decision?.decision==='match'&&decision.target){
        const source=String(req.params.characterId),target=decision.target;
        const suggestions=p.identitySuggestions??=[];
        const evidence=decision.evidence.map(e=>e.text).join('；');
        const old=suggestions.find(s=>s.source===source&&s.target===target);
        if(old){old.evidence=evidence;old.page=p.processed;}
        else suggestions.push({source,target,evidence,reviewed:true,page:p.processed});
      }
      const subject=identityPeople(p).find(c=>c.id===String(req.params.characterId));
      if(subject?.identityState==='pending'&&decision){subject.identityCandidates=[...new Set([...(decision.target?[decision.target]:[]),...decision.candidates])];subject.identityEvidence=[...decision.evidence.map(e=>e.text),...decision.conflicts].join('；')||'证据不足，保留待定';}
      const independent=decision&&['new','confirm'].includes(decision.decision);
      if(independent&&subject?.identityState==='pending')confirmIdentity(p,subject.id,`AI 复核确认独立身份：${decision.evidence.map(e=>e.text).join('；')}`,'model');
      p.identityReviewNotice=decision?.decision==='match'?'发现同一人物的证据，请核对候选后合并。':independent?'已确认独立身份，当前人物图已更新。':metrics.identityReviewResult?.issue||'证据仍不足，保留当前档案，未自动合并。';
      p.canUndoMerge=false;outcome='success';
      return p;
    }finally{
      if(metrics.attempts&&p.pages[p.processed-1])recordReadingRun(p,p.pages[p.processed-1],{...metrics,elapsedMs:Date.now()-started},outcome,'identity-review');
      await saveProject(p);
    }
  }));
});
app.post('/api/projects/:id/characters/:characterId/confirm',async(req,res)=>{
  res.json(await exclusive(req.params.id,async()=>{const p=await readProject(req.params.id);confirmIdentity(p,String(req.params.characterId));await saveProject(p);return p;}));
});
app.post('/api/projects/:id/appearances/bind',async(req,res)=>{
  const input=z.object({ids:z.array(z.string()).min(1).max(200),characterId:z.string().nullable(),reason:z.string().trim().min(1).max(1000),newName:z.string().trim().min(1).max(200).optional()}).parse(req.body);
  res.json(await exclusive(req.params.id,async()=>{
    const p=await readProject(req.params.id);
    bindAppearances(p,input.ids,input.characterId,input.reason,input.newName);
    await saveProject(p);return p;
  }));
});
app.post('/api/projects/:id/corrections',async(req,res)=>{
  const input=correctionSchema.parse(req.body);
  res.json(await exclusive(req.params.id,async()=>{const p=await readProject(req.params.id);correctProject(p,input);await saveProject(p);return p;}));
});
app.delete('/api/projects/:id/corrections/:correctionId',async(req,res)=>{
  res.json(await exclusive(req.params.id,async()=>{const p=await readProject(req.params.id);p.corrections=p.corrections?.filter(c=>c.id!==req.params.correctionId);p.canUndoMerge=false;await saveProject(p);return p;}));
});
app.post('/api/projects/:id/characters/merge/rewind',async(req,res)=>{
  if(req.body?.confirm!==true)throw new Error('请确认回到合并前，后续页面需要重新分析。');
  res.json(await exclusive(req.params.id,async()=>{
    const current=await readProject(req.params.id);
    const backup=JSON.parse(await readFile(path.join(projectDir(current.id),'identity-merge-backup.json'),'utf8').catch(()=>'null')) as {before:Project}|null;
    if(!current.canRewindMerge||!backup)throw new Error('没有可恢复的最近合并记录。');
    const restored=backup.before;
    if(restored.direction!==current.direction||restored.pages.slice(0,restored.processed).some((p,i)=>p.id!==current.pages[i]?.id||p.override!==current.pages[i]?.override))throw new Error('已读页顺序或用途发生变化，不能直接回到该合并记录。');
    await writeFile(path.join(projectDir(current.id),`project.before-merge-rewind-${Date.now()}.json`),JSON.stringify(current),{flag:'wx'});
    restored.pages=current.pages.map((page,i)=>i<restored.processed?restored.pages[i]:(({analysis,timing,...raw})=>raw)(page));
    ensureReadingRuns(current);
    restored.readingRuns=current.readingRuns;restored.workContext=current.workContext;restored.name=current.name;
    restored.status=restored.processed<restored.pages.length?'paused':'completed';delete restored.error;
    restored.canUndoMerge=false;restored.canRewindMerge=false;
    await saveProject(restored);return restored;
  }));
});
app.put('/api/projects/:id/order', async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);
  res.json(await exclusive(req.params.id, async () => {
    const p = await readProject(req.params.id);
    reorderPages(p,ids);
    await saveProject(p); return p;
  }));
});
app.patch('/api/projects/:id/pages/:pageId', async (req, res) => {
  const { override } = z.object({ override: z.enum(['auto','story','skip']) }).parse(req.body);
  res.json(await exclusive(req.params.id, async () => {
    const p = await readProject(req.params.id); const index = p.pages.findIndex(page => page.id === req.params.pageId);
    if (index < 0) throw new Error('页面不存在。');
    if (p.pages[index].override !== override) { p.pages[index].override = override; if (index < p.processed) resetAnalysis(p); }
    p.canUndoMerge=false;
    if(override==='auto')delete p.pages[index].purpose;
    else if(override==='story')p.pages[index].purpose='story';
    else if(!p.pages[index].purpose||p.pages[index].purpose==='story')p.pages[index].purpose='extra';
    await saveProject(p); return p;
  }));
});
app.delete('/api/projects/:id/pages/:pageId', async (req, res) => {
  res.json(await exclusive(req.params.id, async () => {
    const p = await readProject(req.params.id); const index = p.pages.findIndex(page => page.id === req.params.pageId);
    if (index < 0) throw new Error('页面不存在。');
    ensureReadingRuns(p);
    p.canUndoMerge=false;
    p.pages.splice(index, 1);
    // Removing a page the analysis does not cover yet cannot invalidate earlier
    // reading; only deleting a read page requires re-reading from the start.
    if (index < p.processed) {
      resetAnalysis(p);
    } else {
      // The pending page is gone, so any failure message about it is stale.
      if (index === p.processed) { delete p.error; if (p.status === 'error') p.status = 'paused'; }
      if (p.status === 'paused' && p.pages.length && p.processed >= p.pages.length) p.status = 'completed';
    }
    await saveProject(p); return p;
  }));
});
app.put('/api/projects/:id/characters/:characterId/avatar', async (req, res) => {
  const input = z.object({ pageId: z.string(), x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).parse(req.body);
  res.json(await exclusive(req.params.id, async () => {
    const p = await readProject(req.params.id); const person = p.characters.find(c => c.id === req.params.characterId); const page = p.pages.find(pg => pg.id === input.pageId);
    if (!person || !page) throw new Error('人物或页面不存在。');
    const avatar = await cropAvatar(p.id, page, person.id, input); person.avatar = avatar;
    addReference(person,{url:avatar,page:p.pages.indexOf(page)+1,view:'manual'});
    p.canUndoMerge=false;
    for (const stage of p.stages) { const c = stage.characters.find(c => c.id === person.id); if (c) c.avatar = avatar; }
    await saveProject(p); return p;
  }));
});
async function cropAvatar(projectId: string, page: Page, characterId: string, box: { x:number; y:number; width:number; height:number }) {
  const left = Math.min(page.width - 1, Math.floor(box.x * page.width)); const top = Math.min(page.height - 1, Math.floor(box.y * page.height));
  const width = Math.min(page.width - left, Math.max(1, Math.floor(box.width * page.width))); const height = Math.min(page.height - top, Math.max(1, Math.floor(box.height * page.height)));
  const filename = `${characterId}-${randomUUID()}.jpg`; const dir = projectDir(projectId);
  await mkdir(path.join(dir, 'avatars'), { recursive: true });
  await sharp(path.join(dir, 'images', `${page.id}.jpg`)).extract({ left, top, width, height }).resize(384,384,{fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toFile(path.join(dir, 'avatars', filename));
  return `/media/${projectId}/avatars/${filename}`;
}
async function run(project: Project, controller: AbortController) {
  const preparedImages = new ReadingImages(project.id, controller.signal);
  // Per-page cost of the page currently being read, stored once it is settled
  // (applied, refused or failed) so speed work can be measured instead of guessed.
  let measuring: { page: Page; startedAt: number; metrics: PageMetrics } | undefined;
  const recordTiming = (outcome:'success'|'error'|'cancelled') => {
    if (!measuring) return;
    const { page, startedAt, metrics } = measuring; measuring = undefined;
    recordReadingRun(project,page,{
      elapsedMs: Date.now() - startedAt, attempts: metrics.attempts,identityReviewMs:metrics.identityReviewMs,identityReviewRequests:metrics.identityReviewRequests,identityReviewResult:metrics.identityReviewResult,
      preparationMs: metrics.preparationMs, modelMs: metrics.modelMs,
      contextCharacters: metrics.contextCharacters, imageCount: metrics.imageCount,
      model:metrics.model,endpointOrigin:metrics.endpointOrigin,promptHash:metrics.promptHash,reasoningEffort:metrics.reasoningEffort,maxTokens:metrics.maxTokens,
      ...(metrics.promptTokens ? { promptTokens: metrics.promptTokens } : {}),
      ...(metrics.completionTokens ? { completionTokens: metrics.completionTokens } : {}),
      ...(metrics.reasoningTokens ? { reasoningTokens: metrics.reasoningTokens } : {}),
    },outcome);
  };
  try {
    while (project.processed < project.pages.length && !controller.signal.aborted) {
      const page = project.pages[project.processed];
      if (page.override === 'skip') {
        applyReading(project, { kind:page.purpose||'extra', confidence:1, reason:'手动排除，不参与剧情理解', summary:'', storyTime:'', memory: project.memory, turningPoint:null, characters:[], relationChanges:[] });
      } else {
        // Page purpose is fixed by the user before reading starts, so the model
        // never reclassifies a page here.
        measuring = { page, startedAt: Date.now(), metrics: { attempts:0, promptTokens:0, completionTokens:0, reasoningTokens:0 } };
        const reading: Reading = await readPage(project, controller.signal, measuring.metrics, preparedImages);
        if (controller.signal.aborted) { recordTiming('cancelled'); break; }
        const avatars: Record<string,string> = {};
        if (reading.kind === 'story' || page.override === 'story') {
          const normalized=resolveIdentities(project,reading).reading;
          validateReferences(project, normalized);
          for (const person of normalized.characters) if (person.avatarBox&&person.presence!=='mentioned') avatars[person.id] = await cropAvatar(project.id, page, person.id, person.avatarBox);
        }
        if(controller.signal.aborted){recordTiming('cancelled');break;}
        applyReading(project, reading, avatars);
        recordTiming('success');
      }
      await saveProject(project);
    }
    project.status = controller.signal.aborted ? 'paused' : 'completed';
  } catch (error) {
    recordTiming(controller.signal.aborted?'cancelled':'error');
    project.status = controller.signal.aborted || error instanceof ModelRefusalError ? 'paused' : 'error';
    if (error instanceof ModelRefusalError && !controller.signal.aborted) project.pages[project.processed].analysis = {kind:'blocked',confidence:1,reason:error.message,summary:'',storyTime:''};
    if (!controller.signal.aborted) project.error = error instanceof z.ZodError ? `模型输出校验失败：${describeReadingIssues(error.issues)}。本页未提交，已保留进度。` : describeError(error as Error & { code?: string });
  } finally { preparedImages.close(); try { await saveProject(project); } finally { jobs.delete(project.id); } }
}
app.post('/api/projects/:id/read', async (req, res) => {
  const p = await exclusive(req.params.id, async () => {
    const project = await readProject(req.params.id);
    if (!project.pages.length) throw new Error('请先导入漫画。');
    if(!pagesClassified(project.pages))throw new Error('开始分析前，请先完成所有页面的正文、封面和附页划分。');
    if (!(await publicSettings()).hasKey) throw new Error('请先配置 API Key。');
    if (project.processed >= project.pages.length) throw new Error('已完成全部阅读；重新阅读请先重置。');
    if (project.pages[project.processed].analysis?.kind === 'blocked' && project.pages[project.processed].override !== 'skip') throw new Error('当前页已被模型拒绝处理，不会重复发送。请排除此页或使用适合的非露骨素材。');
    project.status = 'running'; project.canUndoMerge=false; delete project.error; await saveProject(project);
    const controller = new AbortController(); jobs.set(project.id, controller);
    // Return the running snapshot before the background job can mutate it.
    setImmediate(() => { void run(project, controller).catch(error => console.error('保存阅读结果失败：', error.message)); });
    return project;
  }); res.json(p);
});
app.post('/api/projects/:id/pause', async (req, res) => { jobs.get(req.params.id)?.abort(); res.json({ ok:true }); });
app.post('/api/projects/:id/reset', async (req, res) => {
  res.json(await exclusive(req.params.id, async () => { const p = await readProject(req.params.id); resetAnalysis(p); await saveProject(p); return p; }));
});
app.use(express.static(path.resolve('dist')));
app.use((req, res) => { if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) res.status(404).json({ error:'资源不存在。' }); else res.sendFile(path.resolve('dist/index.html')); });
app.use((error: Error & { code?:string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof z.ZodError ? '输入数据格式不正确。' : error instanceof multer.MulterError ? '导入失败：每张图片最大 32 MB，单次最多 1000 张。' : describeError(error);
  res.status(error.code === 'ENOENT' ? 404 : 400).json({ error:message });
});
const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => console.log(`漫画阅读服务 http://127.0.0.1:${port}`));
