import { randomUUID } from 'node:crypto';
import type { Page, PageTiming, Project, ReadingRun } from '../shared/types.js';

export function ensureReadingRuns(project:Project){
  // Import the old last-call measurements once, before overwriting page.timing.
  // They cannot recover attempts made before this ledger existed.
  project.readingRuns ||= project.pages.flatMap((p,index)=>p.timing?[{...p.timing,id:randomUUID(),pageId:p.id,pageNumber:index+1,recordedAt:project.updatedAt,outcome:'legacy' as const}]:[]);
}

export function recordReadingRun(project:Project,page:Page,timing:PageTiming,outcome:ReadingRun['outcome'],task:'reading'|'identity-review'='reading'){
  ensureReadingRuns(project);
  project.readingRuns!.push({...timing,task,id:randomUUID(),pageId:page.id,pageNumber:project.pages.findIndex(p=>p.id===page.id)+1,recordedAt:new Date().toISOString(),outcome});
  const saved=project.pages.find(p=>p.id===page.id);
  if(saved&&task==='reading')saved.timing=timing;
}
