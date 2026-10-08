import { identityView, appearanceCorrections } from '../shared/identity-people.js';
import { memoryPlan } from './reading-memory.js';
import { identityHistory } from './identity-context.js';
import type { Project, CharacterFact } from '../shared/types.js';

export function readingOptions(model:string,recoverTruncation=false){
  const maxTokens=Number(process.env.DEEPSEEK_MAX_TOKENS||32768);
  if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>393216)throw new Error('DEEPSEEK_MAX_TOKENS 必须是 1 至 393216 之间的整数。');
  // Only send these provider-specific options to models whose support is documented.
  if(!['deepseek-flash','deepseek-v4-pro'].includes(model))return {max_tokens:maxTokens};
  const effort=process.env.DEEPSEEK_REASONING_EFFORT||'low';
  if(!['low','high','max','none'].includes(effort))throw new Error('DEEPSEEK_REASONING_EFFORT 必须是 low、high、max 或 none。');
  return {max_tokens:maxTokens,...(recoverTruncation||effort==='none'?{thinking:{type:'disabled'}}:{thinking:{type:'enabled'},reasoning_effort:effort})};
}

// Full identity/state indexes remain available, including long-absent people.
// Only repeated evidence and portraits are selected by recent relevance.
export function referenceCharacters(project:Project){
  const canonical=(id:string)=>{const seen=new Set<string>();while(project.identityRedirects?.[id]&&!seen.has(id)){seen.add(id);id=project.identityRedirects[id];}return id;};
  const scores=new Map<string,number>();
  for(const person of project.characters){
    const last=Math.max(person.firstPage,...(person.records||[]).map(r=>r.sincePage));
    scores.set(person.id,last);
  }
  const recent=project.pages.slice(0,project.processed).filter(p=>p.analysis?.kind==='story').slice(-3);
  recent.forEach((page,index)=>page.analysis?.characterIds?.forEach(id=>scores.set(canonical(id),project.processed+index+1)));
  return project.characters.filter(c=>!c.archived).sort((a,b)=>(scores.get(b.id)||0)-(scores.get(a.id)||0)||a.id.localeCompare(b.id)).slice(0,8);
}
const compactFact=({evidence,...fact}:CharacterFact)=>fact;
export function readingContext(project:Project){
  project=identityView(project);
  const page=project.pages[project.processed],phase=project.stages.at(-1);
  const active=new Set(referenceCharacters(project).map(c=>c.id));
  return {page:project.processed+1,filename:page.name,direction:project.direction,forcedStory:page.override==='story',
    appearanceCorrections:appearanceCorrections(project),
    recentAppearances:(project.appearances||[]).filter(a=>a.page>=project.processed-2).map(a=>({id:a.id,page:a.page,characterId:a.characterId,trackId:a.trackId,observed:a.observed.appearance,outfit:a.observed.outfit,hairStyle:a.observed.hairStyle,referenceApproved:['manual','reviewed'].includes(a.verification)})),
    manualCorrections:project.corrections||[],workContext:project.workContext||null,identityRedirects:project.identityRedirects||{},
    recentPages:project.pages.slice(0,project.processed).flatMap((p,index)=>p.analysis?.kind==='story'?[{page:index+1,name:p.name,summary:p.analysis.summary,characterIds:p.analysis.characterIds}]:[]).slice(-3),
    characters:project.characters.map(({avatar,references,records,profile,statuses,...person})=>({...person,...(person.identityState==='pending'?identityHistory(project,person.id):{}),
      profile:profile?.map(f=>f.certainty==='uncertain'||f.sincePage>=project.processed-2?f:compactFact(f)),
      statuses:statuses?.map(f=>f.certainty==='uncertain'||f.sincePage>=project.processed-2?f:compactFact(f)),
      records:active.has(person.id)?records?.filter(r=>r.certainty==='uncertain').slice(-3):undefined})),
    // Current relation states are never pruned: they are needed for old characters returning.
    relations:project.relations.map(({evidence,...relation})=>relation),memory:project.memory,
    memoryInstruction:memoryPlan(project),
    memoryState:project.readingMemory||{version:1,checkpointPage:project.processed,pending:[],threads:[]},
    currentPhase:phase?{fromPage:phase.fromPage,title:phase.title,
      baselineRelations:(phase.baselineRelations||phase.relations).map(({evidence,sincePage,...relation})=>relation),
      baselineStatuses:(phase.baselineStatuses||phase.characters).map(({id,statuses})=>({id,statuses:statuses?.map(({evidence,sincePage,...state})=>state)}))}:null};
}
