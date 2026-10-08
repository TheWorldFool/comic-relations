import type { Project } from '../shared/types.js';
import { changesReadOrder } from '../shared/page-order.js';
import { resetAnalysis } from './analysis.js';
import { ensureReadingRuns } from './reading-timing.js';

export function reorderPages(project:Project, ids:string[]) {
  const pages=new Map(project.pages.map(page=>[page.id,page]));
  if(ids.length!==project.pages.length||new Set(ids).size!==ids.length||ids.some(id=>!pages.has(id)))throw new Error('排序需要包含所有页面且不能重复。');
  const reset=changesReadOrder(project,ids);
  const pendingChanged=ids[project.processed]!==project.pages[project.processed]?.id;
  ensureReadingRuns(project);
  if(ids.some((id,index)=>id!==project.pages[index].id))project.canUndoMerge=false;
  project.pages=ids.map(id=>pages.get(id)!);
  if(reset)resetAnalysis(project);
  else if(pendingChanged){delete project.error;if(project.status==='error')project.status='paused';}
}
