import type { PagePurpose, Project } from '../shared/types.js';
import { suggestedPurpose } from '../shared/page-selection.js';
import { resetAnalysis } from './analysis.js';

export function classifyPages(project:Project,items:{id:string;purpose:PagePurpose}[],allowReset=false){
  if(!items.length||items.length!==project.pages.length||new Set(items.map(p=>p.id)).size!==items.length||items.some((p,i)=>p.id!==project.pages[i].id))throw new Error('页面列表已变化，请重新打开页面划分后确认。');
  const changesRead=items.some((p,i)=>i<project.processed&&suggestedPurpose(project.pages[i])!==p.purpose);
  if(changesRead&&!allowReset)throw new Error('修改已读页面用途需要清除旧分析，请确认后保存。');
  if(changesRead)resetAnalysis(project);
  for(let i=0;i<items.length;i++){project.pages[i].purpose=items[i].purpose;project.pages[i].override=items[i].purpose==='story'?'story':'skip';}
  if(project.error&&project.pages[project.processed]?.analysis?.kind==='uncertain')delete project.error;
  project.canUndoMerge=false;
}
