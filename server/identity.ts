import { identityView, separatePending } from '../shared/identity-people.js';
import { remapAppearanceIdentity, refreshAppearanceReferences } from './appearances.js';
import type { Character, CharacterFact, IdentitySuggestion, Project, Relation } from '../shared/types.js';
import type { Reading } from './analysis.js';
import { relationKey } from './analysis.js';
import { mergeCorrections } from './corrections.js';
import { factKey } from './character-facts.js';
import { addReference, visibleCast, visibleRelations } from './identity-state.js';

export function canonicalId(project:Project,id:string){
  const seen=new Set<string>();
  while(project.identityRedirects&&Object.hasOwn(project.identityRedirects,id)&&typeof project.identityRedirects[id]==='string'&&!seen.has(id)){seen.add(id);id=project.identityRedirects[id];}
  return id;
}
// Pure normalization: proposals are committed only when the entire page passes validation.
export function resolveIdentities(project:Project,input:Reading){
  project=identityView(project);
  if(new Set(input.characters.map(c=>c.id)).size!==input.characters.length)throw new Error('模型返回了重复人物 ID，请重试本页。');
  const reading=structuredClone(input),suggestions:IdentitySuggestion[]=[],redirects:Record<string,string>=Object.create(null),appearanceRedirects:Record<string,string>=Object.create(null);
  const mentions=[...(reading.mentions||[])];
  const known=new Set(project.characters.map(c=>c.id));
  const dropped=new Set<string>();
  for(const decision of reading.identityReview||[]){
    if(decision.appearanceId){appearanceRedirects[decision.id]=decision.appearanceId;continue;}
    if(decision.decision!=='match'||!decision.target)continue;
    const source=canonicalId(project,decision.id),target=canonicalId(project,decision.target);
    if(source===target)continue;
    // Correct this occurrence without merging or redirecting the historical person.
    if(known.has(source)&&project.characters.find(c=>c.id===source)?.identityState!=='pending')appearanceRedirects[decision.id]=target;
    else redirects[decision.id]=target;
  }
  for(const person of reading.characters){
    const id=canonicalId(project,person.id),match=person.sameAs;
    if(person.presence==='mentioned'&&!known.has(id)){
      dropped.add(person.id);mentions.push({name:person.name,evidence:match?.evidence||person.description||'对白中提及，尚未确认画面对应人物'});continue;
    }
    if(match&&!reading.identityReview){
      const target=canonicalId(project,match.id);
      if(known.has(target)&&target!==id){
        if(!known.has(id)&&match.confidence>=.9)redirects[person.id]=target;
        else suggestions.push({source:id,target,evidence:match.evidence,confidence:match.confidence,page:project.processed+1});
      }
    }
  }
  const resolve=(id:string)=>appearanceRedirects[id]||redirects[id]||canonicalId(project,id);
  const people=new Map<string,Reading['characters'][number]>();
  for(const raw of reading.characters){
    if(dropped.has(raw.id))continue;
    const id=resolve(raw.id),old=project.characters.find(c=>c.id===id);
    const person={...raw,id,statusChanges:raw.statusChanges?.map(s=>({...s,target:s.target?resolve(s.target):null})).filter(s=>s.target!==id)};
    const decision=reading.identityReview?.find(d=>d.id===raw.id);
    if(decision?.appearanceId){
      if(decision.decision==='separate'&&decision.identity)Object.assign(person,decision.identity);
      else Object.assign(person,{name:raw.name!==project.characters.find(c=>c.id===canonicalId(project,raw.id))?.name?raw.name:`待辨认人物（P.${project.processed+1}）`,nameType:'descriptive',aliases:[]});
    }else if(decision?.decision==='match'&&old?.nameType==='named'){
      person.name=old.name;person.nameType=old.nameType;
      person.aliases=[...old.aliases,...(decision.nameLink&&raw.name!==old.name?[raw.name]:[])];
      person.description=old.description;person.appearance=old.appearance;
    }
    if(old?.nameType==='named'&&person.nameType==='descriptive'){
      person.aliases=[...new Set([...person.aliases,person.name])];person.name=old.name;person.nameType='named';
    }
    const prior=people.get(id);
    if(prior){
      const preferred=person.nameType==='named'?person:prior;
      people.set(id,{...prior,...preferred,aliases:[...new Set([...prior.aliases,...person.aliases,prior.name,person.name])].filter(n=>n!==preferred.name),
        profileUpdates:combineUpdates(prior.profileUpdates,person.profileUpdates),statusChanges:combineUpdates(prior.statusChanges,person.statusChanges),avatarBox:prior.avatarBox||person.avatarBox});
    }else people.set(id,person);
  }
  reading.characters=[...people.values()];
  reading.relationChanges=reading.relationChanges.filter(r=>!dropped.has(r.source)&&!dropped.has(r.target)).map(r=>({...r,source:resolve(r.source),target:resolve(r.target)})).filter(r=>r.source!==r.target);
  for(const person of reading.characters)person.statusChanges=person.statusChanges?.filter(s=>!s.target||!dropped.has(s.target));
  reading.mentions=mentions;
  return {reading,redirects,appearanceRedirects,suggestions};
}
function combineUpdates<T extends {key:string;target?:string|null}>(a:T[]|undefined,b:T[]|undefined){
  const result=new Map<string,T>();for(const value of [...(a||[]),...(b||[])])result.set(factKey(value),value);return [...result.values()];
}
function mergeFacts(facts:CharacterFact[],resolve:(id:string)=>string,owner:string){
  const result=new Map<string,CharacterFact>();
  for(const raw of facts){
    const fact={...raw,...(raw.target?{target:resolve(raw.target)}:{})};if(fact.target===owner)continue;
    const key=factKey(fact),old=result.get(key);
    if(!old||old.certainty==='uncertain'&&fact.certainty==='confirmed'||old.certainty===fact.certainty&&fact.sincePage>old.sincePage)result.set(key,fact);
  }
  return [...result.values()];
}
function mergeRelations(relations:Relation[],resolve:(id:string)=>string){
  const result=new Map<string,Relation>();
  for(const raw of relations){const r={...raw,source:resolve(raw.source),target:resolve(raw.target)};if(r.source===r.target)continue;
    const key=relationKey(r),old=result.get(key);if(!old||r.sincePage>old.sincePage)result.set(key,r);
  }return [...result.values()];
}
export function mergeCharacters(project:Project,source:string,target:string){
  const people=identityView(project).characters;
  if(source===target||![source,target].every(id=>people.some(c=>c.id===id)))throw new Error('请选择两个不同的现有人物。');
  const corrections=mergeCorrections(project,source,target);
  project.characters=people;project.pendingIdentities=[];
  const resolve=(id:string)=>id===source?target:id;
  const mergePeople=(people:Character[])=>{
    const result:Character[]=[];
    const from=people.find(c=>c.id===source),to=people.find(c=>c.id===target);
    for(const person of people){
      if(person.id===source&&to)continue;
      const combined=person.id===target&&from?{...person,firstPage:Math.min(person.firstPage,from.firstPage),aliases:[...new Set([...person.aliases,...from.aliases,from.name])].filter(n=>n!==person.name),avatar:person.avatar||from.avatar,
        description:person.description||from.description,appearance:person.appearance||from.appearance,profile:[...(person.profile||[]),...(from.profile||[])],statuses:[...(person.statuses||[]),...(from.statuses||[])],records:[...(person.records||[]),...(from.records||[])]}:person;
      if(person.id===target&&from){
        combined.identityState=person.identityState==='pending'&&from.identityState==='pending'?'pending':'confirmed';
        for(const ref of from.references||[])addReference(combined,ref);
      }
      const id=resolve(combined.id);
      result.push({...combined,id,profile:mergeFacts(combined.profile||[],resolve,id),statuses:mergeFacts(combined.statuses||[],resolve,id),records:combined.records?.map(r=>({...r,...(r.target?{target:resolve(r.target)}:{})})).filter(r=>r.target!==id).sort((a,b)=>a.sincePage-b.sincePage)});
    }return result;
  };
  if(project.corrections)project.corrections=corrections;
  project.characters=mergePeople(project.characters);project.relations=mergeRelations(project.relations,resolve);
  for(const stage of project.stages){
    // Each stage uses only its own data: no later name, portrait or facts are copied backward.
    stage.characters=mergePeople(stage.characters);stage.relations=mergeRelations(stage.relations,resolve);
    if(stage.baselineRelations)stage.baselineRelations=mergeRelations(stage.baselineRelations,resolve);
    if(stage.baselineStatuses){const grouped=new Map<string,CharacterFact[]>();for(const p of stage.baselineStatuses){const id=resolve(p.id);grouped.set(id,[...(grouped.get(id)||[]),...(p.statuses||[])]);}stage.baselineStatuses=[...grouped].map(([id,statuses])=>({id,statuses:mergeFacts(statuses,resolve,id)}));}
  }
  for(const page of project.pages){
    if(page.analysis?.characterIds)page.analysis.characterIds=[...new Set(page.analysis.characterIds.map(resolve))];
    if(page.analysis?.identityObservations)for(const observation of page.analysis.identityObservations)observation.personId=resolve(observation.personId);
  }
  for(const person of project.characters)if(person.identityCandidates)person.identityCandidates=[...new Set(person.identityCandidates.map(resolve))].filter(id=>id!==person.id);
  remapAppearanceIdentity(project,source,target);
  if(project.identityBaseline){
    const baseline=project.identityBaseline;
    if(baseline.characters.some(c=>c.id===source)){
      if(!baseline.characters.some(c=>c.id===target))baseline.characters.push({id:target,name:project.characters.find(c=>c.id===target)!.name,aliases:[],description:'',firstPage:project.processed+1});
      const view:Project={...project,characters:baseline.characters,relations:baseline.relations,stages:[],pages:[],pendingIdentities:[],identityBaseline:undefined,appearances:undefined,appearanceFacts:undefined,appearanceRelations:undefined,corrections:[]};
      mergeCharacters(view,source,target);baseline.characters=view.characters;baseline.relations=view.relations;
    }
  }
  refreshAppearanceReferences(project);
  const current=project.stages.at(-1);
  if(current){current.characters=structuredClone(visibleCast(project));current.relations=structuredClone(visibleRelations(project));}
  project.identityRedirects=Object.fromEntries([...Object.entries(project.identityRedirects||{}).map(([id,value])=>[id,resolve(value)]),[source,target]]);
  project.identitySuggestions=project.identitySuggestions?.map(s=>({...s,source:resolve(s.source),target:resolve(s.target)})).filter(s=>s.source!==s.target);
  separatePending(project);
}
