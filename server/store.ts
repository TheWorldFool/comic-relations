import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { replaceFile } from './atomic-file.js';
import path from 'node:path';
import { z } from 'zod';
import type { Project } from '../shared/types.js';
export const dataDir = path.resolve(process.env.DATA_DIR || 'data');
export const projectsDir = path.join(dataDir, 'projects');
await mkdir(projectsDir, { recursive: true });
export function projectDir(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效项目 ID'); return path.join(projectsDir, id); }
const projectShape=z.object({id:z.string(),name:z.string(),createdAt:z.string(),updatedAt:z.string(),direction:z.enum(['ltr','rtl']),status:z.enum(['idle','running','paused','completed','error']),processed:z.number().int().nonnegative(),memory:z.string(),pages:z.array(z.object({id:z.string(),name:z.string(),width:z.number().positive(),height:z.number().positive(),image:z.string(),thumbnail:z.string(),override:z.enum(['auto','story','skip'])}).passthrough()),characters:z.array(z.object({id:z.string(),name:z.string(),aliases:z.array(z.string()),description:z.string(),firstPage:z.number()}).passthrough()),relations:z.array(z.object({source:z.string(),target:z.string(),kind:z.string(),label:z.string(),directed:z.boolean(),evidence:z.string(),sincePage:z.number()}).passthrough()),stages:z.array(z.object({id:z.string(),fromPage:z.number(),toPage:z.number(),title:z.string(),characters:z.array(z.unknown()),relations:z.array(z.unknown()),changes:z.array(z.string())}).passthrough())}).passthrough();
function parseProject(raw:string,id:string):Project{
  const parsed=projectShape.safeParse(JSON.parse(raw));
  if(!parsed.success||parsed.data.id!==id||parsed.data.processed>parsed.data.pages.length)throw new Error('项目结构不完整');
  return parsed.data as unknown as Project;
}
async function atomicWrite(file:string,raw:string){const temp=`${file}.tmp`;await writeFile(temp,raw);await replaceFile(temp,file);}
export async function readProject(id: string): Promise<Project> {
  try{return parseProject(await readFile(path.join(projectDir(id),'project.json'),'utf8'),id);}
  catch{throw new Error('项目文件无法读取或已损坏。可从书架恢复最近备份，当前文件会保留。');}
}
export async function saveProject(project: Project) {
  const dir=projectDir(project.id);await mkdir(dir,{recursive:true});
  const current=path.join(dir,'project.json');
  let previous:string|undefined;
  try{previous=await readFile(current,'utf8');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(previous!==undefined){
    parseProject(previous,project.id); // A corrupt current file must not overwrite a good backup.
    await atomicWrite(path.join(dir,'project.backup.json'),previous);
  }
  project.updatedAt=new Date().toISOString();
  const raw=JSON.stringify(project,null,2);parseProject(raw,project.id);
  await atomicWrite(current,raw);
}
export async function restoreProject(id:string){
  const dir=projectDir(id);
  let restored:Project;
  try{restored=parseProject(await readFile(path.join(dir,'project.backup.json'),'utf8'),id);}
  catch{throw new Error('没有可用的完整备份，请保留数据目录以便人工恢复。');}
  const current=await readFile(path.join(dir,'project.json'),'utf8').catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
  if(current!==undefined)await writeFile(path.join(dir,`project.before-restore-${Date.now()}.json`),current,{flag:'wx'});
  if(restored.status==='running')restored.status=restored.processed>=restored.pages.length?'completed':'paused';
  restored.updatedAt=new Date().toISOString();
  await atomicWrite(path.join(dir,'project.json'),JSON.stringify(restored,null,2));
  return restored;
}
export async function listProjectEntries(){
  const entries=await readdir(projectsDir,{withFileTypes:true});
  const results=await Promise.all(entries.filter(e=>e.isDirectory()&&/^[a-f0-9-]{36}$/.test(e.name)).map(async e=>{
    try{const p=await readProject(e.name);return {id:p.id,name:p.name,pages:p.pages.length,updatedAt:p.updatedAt};}
    catch{
      let backup:Project|undefined;
      try{backup=parseProject(await readFile(path.join(projectDir(e.name),'project.backup.json'),'utf8'),e.name);}catch{}
      return {id:e.name,name:backup?.name||`项目 ${e.name.slice(0,8)}`,pages:backup?.pages.length||0,updatedAt:backup?.updatedAt||'',unreadable:true,recoverable:!!backup,backupUpdatedAt:backup?.updatedAt};
    }
  }));
  return results.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export async function listProjects() {
  const entries=await listProjectEntries();
  return Promise.all(entries.filter(e=>!('unreadable' in e)).map(e=>readProject(e.id)));
}
