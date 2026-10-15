import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Project, ReadingCheckpoint, RereadReviewItem, RereadPreview } from '../shared/types.js';
import { identityPeople } from '../shared/identity-people.js';
import { resetAnalysis } from './analysis.js';
import { ensureReadingRuns } from './reading-timing.js';

const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
const signature=(p:Project)=>hash(JSON.stringify({...p,readingActivity:undefined}));
const filePath=(dir:string,id:string)=>{
  if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('恢复点标识无效。');
  return path.join(dir,'reading-history',`${id}.json`);
};
async function writeSnapshot(dir:string,id:string,raw:string){
  try{await mkdir(path.join(dir,'reading-history'),{recursive:true});await writeFile(filePath(dir,id),raw,{flag:'wx'});}
  catch{throw new Error('无法保存完整恢复点，请检查磁盘空间和数据目录权限；本次操作未覆盖原结果。');}
}
const sameLayout=(a:Project,b:Project,through:number)=>a.direction===b.direction&&a.pages.slice(0,through).every((page,i)=>{
  const other=b.pages[i];return other&&page.id===other.id&&page.override===other.override&&page.purpose===other.purpose;
});

// Immutable files are written before project.json points to them. An interrupted
// write leaves at most an unreferenced file, never a half-updated live snapshot.
export async function saveReadingCheckpoint(project:Project,dir:string){
  const snapshot=structuredClone(project);
  delete snapshot.readingCheckpoints;delete snapshot.reread;delete snapshot.readingActivity;
  delete snapshot.appearanceUndo;delete snapshot.readingRuns;
  snapshot.canUndoMerge=false;snapshot.canRewindMerge=false;
  snapshot.status='paused';delete snapshot.error;
  // Do not carry a failed/refused next page into a completed-prefix checkpoint.
  snapshot.pages=snapshot.pages.map((page,i)=>i<snapshot.processed?page:(({analysis,timing,...raw})=>raw)(page));
  const raw=JSON.stringify(snapshot),entry:ReadingCheckpoint={id:randomUUID(),throughPage:project.processed,hash:hash(raw)};
  await writeSnapshot(dir,entry.id,raw);
  project.readingCheckpoints=[...(project.readingCheckpoints||[]).filter(c=>c.throughPage!==entry.throughPage),entry].sort((a,b)=>a.throughPage-b.throughPage);
}

async function readSnapshot(dir:string,id:string,expectedHash:string,projectId:string){
  let raw:string;
  try{raw=await readFile(filePath(dir,id),'utf8');}catch{throw new Error('恢复点文件缺失或无法读取，当前结果未改动。');}
  if(hash(raw)!==expectedHash)throw new Error('恢复点校验失败，当前结果未改动。');
  const snapshot=JSON.parse(raw) as Project;
  if(snapshot.id!==projectId||!Array.isArray(snapshot.pages)||!Number.isInteger(snapshot.processed)||snapshot.processed<0||snapshot.processed>snapshot.pages.length)throw new Error('恢复点与项目不匹配。');
  return snapshot;
}

async function prefixAt(project:Project,fromPage:number,dir:string){
  if(project.reread)throw new Error('请先完成本次重读核对或恢复原结果。');
  if(!Number.isInteger(fromPage)||fromPage<1||fromPage>project.processed)throw new Error('请选择已完成分析的页面作为重读起点。');
  if(fromPage===1){const empty=structuredClone(project);resetAnalysis(empty);return empty;}
  const entry=project.readingCheckpoints?.find(c=>c.throughPage===fromPage-1);
  if(!entry)return null;
  const prefix=await readSnapshot(dir,entry.id,entry.hash,project.id);
  if(prefix.processed!==fromPage-1||!sameLayout(prefix,project,fromPage-1))throw new Error('恢复点的页序、用途或方向已变化，请从头重读。');
  return prefix;
}

// Carry human decisions as an explicit review queue, not ID-based automatic
// assignments: freshly analyzed pages may reuse an old ID for a different face.
export function preservedEdits(project:Project,prefix:Project):RereadReviewItem[]{
  const result:RereadReviewItem[]=[],people=identityPeople(project),names=(id:string)=>people.find(c=>c.id===id)?.name||id;
  const add=(id:string,page:number,kind:string,title:string,detail:string,data:unknown)=>result.push({id,page:Math.max(1,Math.min(project.processed,page)),kind,title,detail,data:structuredClone(data)});
  const unchanged=(value:unknown,values:unknown[])=>values.some(old=>JSON.stringify(old)===JSON.stringify(value));
  for(const a of project.appearances||[]){
    const manual=a.bindings.filter(b=>b.method==='manual').at(-1);
    if(!manual||unchanged(a,prefix.appearances||[]))continue;
    add(`appearance:${a.id}`,a.page,'出场归属',`${a.observed.name} → ${a.characterId?names(a.characterId):'待定身份'}`,manual.reason,a);
  }
  for(const c of [...(project.corrections||[]),...(project.manualCharacterEdits||[])]){
    if(unchanged(c,[...(prefix.corrections||[]),...(prefix.manualCharacterEdits||[])]))continue;
    const page=c.kind==='character'?people.find(p=>p.id===c.personId)?.firstPage||c.page:c.kind==='fact'?c.fact.sincePage:c.relation.sincePage;
    const title=c.kind==='character'?c.name:c.kind==='fact'?`${names(c.personId)} · ${c.fact.label}：${c.fact.value}`:`${names(c.relation.source)} → ${names(c.relation.target)}：${c.relation.label}`;
    add(`correction:${c.id}`,page,c.scope==='once'?'本次校正':'持续固定',title,c.kind==='character'?c.description:c.kind==='fact'?c.fact.evidence:c.relation.evidence,c);
  }
  for(const c of prefix.corrections||[])if(!project.corrections?.some(current=>current.id===c.id))add(`unlocked:${c.id}`,Math.min(c.page,prefix.processed),'固定项已变更','原固定项已解除或替换','此恢复点仍包含旧固定项。请在人工校正中解除旧固定，再按保留项核对。',c);
  for(const [kind,events,old] of [['档案与状态',project.appearanceFacts||[],prefix.appearanceFacts||[]],['关系',project.appearanceRelations||[],prefix.appearanceRelations||[]]] as const){
    events.forEach((e,i)=>{
      if(!e.manual||unchanged(e,old))return;
      const endpoint=(ref:{characterId?:string;appearanceId?:string})=>{const id=ref.characterId||project.appearances?.find(a=>a.id===ref.appearanceId)?.characterId;return id?names(id):'待定人物';};
      const detail='owner' in e?`${endpoint(e.owner)}：${[...e.profileUpdates,...e.statusChanges].map(f=>`${f.action==='remove'?'撤销':''}${f.label} · ${f.value}（${f.evidence}）`).join('；')}`:`${endpoint(e.source)} → ${endpoint(e.target)}：${e.action==='remove'?'解除':''}${e.label}（${e.evidence}）`;
      add(`event:${kind}:${i}`,e.evidencePage||e.page,'本次校正',kind,detail,e);
    });
  }
  for(const [source,target] of Object.entries(project.identityRedirects||{}))if(prefix.identityRedirects?.[source]!==target)add(`merge:${source}`,people.find(p=>p.id===target)?.firstPage||1,'身份归并',`${source} → ${names(target)}`,'保留原归并映射；请按新出场证据核对，不按旧 ID 自动合并。',{source,target});
  for(const person of people){
    const old=identityPeople(prefix).find(c=>c.id===person.id);
    if(person.identityEvidence?.startsWith('用户确认')&&person.identityEvidence!==old?.identityEvidence)add(`confirm:${person.id}`,person.firstPage,'独立身份',person.name,person.identityEvidence,person);
    for(const ref of person.references||[])if(ref.view==='manual'&&!unchanged(ref,old?.references||[]))add(`avatar:${person.id}:${ref.url}`,ref.page,'手动头像',person.name,'请确认新人物与原头像属于同一身份。',{personId:person.id,reference:ref});
  }
  return result.sort((a,b)=>a.page-b.page);
}

export async function previewReread(project:Project,fromPage:number,dir:string):Promise<RereadPreview>{
  const prefix=await prefixAt(project,fromPage,dir);
  return {fromPage,throughPage:project.processed,available:!!prefix,availableFromPages:[...new Set([1,...(project.readingCheckpoints||[]).filter(c=>c.throughPage<project.processed).map(c=>c.throughPage+1)])].sort((a,b)=>a-b),token:signature(project),items:prefix?preservedEdits(project,prefix):[]};
}

export async function prepareReread(project:Project,fromPage:number,token:string,dir:string){
  if(token!==signature(project))throw new Error('项目已经变化，请重新预览重读范围。');
  const prefix=await prefixAt(project,fromPage,dir);
  if(!prefix)throw new Error('此页没有完整的历史恢复点，不能伪造前文；请选择可用起点或从第 1 页重读。');
  const current=structuredClone(project);ensureReadingRuns(current);
  const raw=JSON.stringify(current),id=randomUUID();
  await writeSnapshot(dir,id,raw);
  const next:Project={...prefix,id:current.id,name:current.name,createdAt:current.createdAt,updatedAt:current.updatedAt,
    pages:current.pages.map((p,i)=>i<prefix.processed?{...p,analysis:prefix.pages[i].analysis,timing:prefix.pages[i].timing}:(({analysis,timing,...raw})=>raw)(p)),
    workContext:current.workContext,backgroundResearch:current.backgroundResearch,readingRuns:current.readingRuns,
    readingCheckpoints:current.readingCheckpoints?.filter(c=>c.throughPage<fromPage),
    status:'paused',canUndoMerge:false,canRewindMerge:false,
    reread:{id,backupHash:hash(raw),fromPage,previousProcessed:current.processed,createdAt:new Date().toISOString(),items:preservedEdits(current,prefix)}};
  delete next.error;delete next.appearanceUndo;delete next.readingActivity;
  return next;
}

export function dueRereadItems(project:Project){return project.reread?.items.filter(i=>!i.resolved&&i.page<=project.processed)||[];}
export function assertRereadReady(project:Project){if(dueRereadItems(project).length)throw new Error('已到达保留校正的证据页，请先核对重读面板中的人工校正，再继续分析。');}
export function resolveRereadItem(project:Project,id:string){
  const item=project.reread?.items.find(i=>i.id===id);
  if(!item||item.page>project.processed)throw new Error('该校正尚未到达证据页或已不存在。');
  item.resolved=true;delete project.error;
}
export async function originalReread(project:Project,dir:string){
  if(!project.reread)throw new Error('没有可恢复的重读记录。');
  return readSnapshot(dir,project.reread.id,project.reread.backupHash,project.id);
}
export async function restoreReread(project:Project,dir:string){
  const original=await originalReread(project,dir);
  if(project.pages.length!==original.pages.length||!sameLayout(original,project,original.pages.length))throw new Error('页序或用途已变化，请先恢复原页序；也可下载重读前结果。');
  const current=structuredClone(project);ensureReadingRuns(current);
  // Preserve both branches and all actual usage, including failed new requests.
  const abandonedId=randomUUID();await writeSnapshot(dir,abandonedId,JSON.stringify(current));
  original.readingRuns=current.readingRuns;original.name=current.name;original.workContext=current.workContext;original.backgroundResearch=current.backgroundResearch;
  original.status=original.processed===original.pages.length?'completed':'paused';
  original.canUndoMerge=false;original.canRewindMerge=false;delete original.appearanceUndo;delete original.error;delete original.readingActivity;
  return original;
}
export function finishReread(project:Project){
  if(!project.reread||project.processed<project.reread.previousProcessed||project.reread.items.some(i=>!i.resolved))throw new Error('请先读完原分析范围并核对全部保留项。');
  delete project.reread;delete project.error;
  project.status=project.processed===project.pages.length?'completed':'paused';
}
