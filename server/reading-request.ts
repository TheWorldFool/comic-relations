import type { Project } from '../shared/types.js';

export function readingOptions(model:string,recoverTruncation=false){
  const maxTokens=Number(process.env.DEEPSEEK_MAX_TOKENS||32768);
  if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>393216)throw new Error('DEEPSEEK_MAX_TOKENS 必须是 1 至 393216 之间的整数。');
  // Only send these provider-specific options to models whose support is documented.
  if(!['deepseek-flash','deepseek-v4-pro'].includes(model))return {max_tokens:maxTokens};
  const effort=process.env.DEEPSEEK_REASONING_EFFORT||'low';
  if(!['low','high','max','none'].includes(effort))throw new Error('DEEPSEEK_REASONING_EFFORT 必须是 low、high、max 或 none。');
  return {max_tokens:maxTokens,...(recoverTruncation||effort==='none'?{thinking:{type:'disabled'}}:{thinking:{type:'enabled'},reasoning_effort:effort})};
}

export function readingContext(project:Project){
  const page=project.pages[project.processed],phase=project.stages.at(-1);
  return {page:project.processed+1,filename:page.name,direction:project.direction,forcedStory:page.override==='story',
    workContext:project.workContext||null,identityRedirects:project.identityRedirects||{},
    recentPages:project.pages.slice(Math.max(0,project.processed-3),project.processed).map(p=>({name:p.name,kind:p.analysis?.kind,override:p.override,summary:p.analysis?.kind==='story'?p.analysis.summary:''})),
    characters:project.characters.map(({avatar,records,...person})=>({...person,
      // Keep unresolved clues, without resending the full ledger on every page.
      records:records?.filter(r=>r.certainty==='uncertain').slice(-3)})),
    relations:project.relations,memory:project.memory,
    currentPhase:phase?{fromPage:phase.fromPage,title:phase.title,
      baselineRelations:(phase.baselineRelations||phase.relations).map(({evidence,sincePage,...relation})=>relation),
      baselineStatuses:(phase.baselineStatuses||phase.characters).map(({id,statuses})=>({id,statuses:statuses?.map(({evidence,sincePage,...state})=>state)}))}:null};
}
