import type { Project } from './types.js';
import { identityPeople } from './identity-people.js';

export function reviewSummary(project:Project){
  const people=identityPeople(project);
  return {
    pending:people.filter(p=>p.identityState==='pending').length,
    missingPortraits:people.filter(p=>p.identityState!=='pending'&&!p.archived&&!p.avatar).length,
    failedPages:project.pages.flatMap((p,index)=>p.timing?.identityReviewResult?.status==='failed'||p.timing?.identityReviewResult?.status==='partial'?[index+1]:[]),
  };
}

export function recentReadingSpeed(project:Project){
  const times=project.pages.filter(p=>p.analysis?.kind==='story'&&p.timing&&p.timing.elapsedMs>0).slice(-10).map(p=>p.timing!.elapsedMs);
  const averageMs=times.length?times.reduce((a,b)=>a+b,0)/times.length:0;
  const remaining=project.pages.slice(project.processed).filter(p=>p.purpose==='story'||p.override==='story').length;
  return {averageMs,samples:times.length,remainingMs:averageMs*remaining};
}
