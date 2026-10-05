import type { Character, CharacterFact, IdentitySuggestion, Project, Relation } from '../shared/types.js';
import type { Reading } from './analysis.js';
import { relationKey } from './analysis.js';
import { factKey } from './character-facts.js';

export function canonicalId(project:Project,id:string){
  const seen=new Set<string>();
  while(project.identityRedirects&&Object.hasOwn(project.identityRedirects,id)&&typeof project.identityRedirects[id]==='string'&&!seen.has(id)){seen.add(id);id=project.identityRedirects[id];}
  return id;
}
// Pure normalization: proposals are committed only when the entire page passes validation.
export function resolveIdentities(project:Project,input:Reading){
  if(new Set(input.characters.map(c=>c.id)).size!==input.characters.length)throw new Error('模型返回了重复人物 ID，请重试本页。');
  const reading=structuredClone(input),suggestions:IdentitySuggestion[]=[],redirects:Record<string,string>=Object.create(null);
  const mentions=[...(reading.mentions||[])];
  const known=new Set(project.characters.map(c=>c.id));
  const dropped=new Set<string>();
  for(const person of reading.characters){
    const id=canonicalId(project,person.id),match=person.sameAs;
    if(person.presence==='mentioned'&&!known.has(id)){
      dropped.add(person.id);mentions.push({name:person.name,evidence:match?.evidence||person.description||'对白中提及，尚未确认画面对应人物'});continue;
    }
    if(match){
      const target=canonicalId(project,match.id);
      if(known.has(target)&&target!==id){
        if(!known.has(id)&&match.confidence>=.9)redirects[person.id]=target;
        else suggestions.push({source:id,target,evidence:match.evidence,confidence:match.confidence,page:project.processed+1});
      }
    }
  }
  const resolve=(id:string)=>redirects[id]||canonicalId(project,id);
  const people=new Map<string,Reading['characters'][number]>();
  for(const raw of reading.characters){
    if(dropped.has(raw.id))continue;
    const id=resolve(raw.id),old=project.characters.find(c=>c.id===id);
    const person={...raw,id,statusChanges:raw.statusChanges?.map(s=>({...s,target:s.target?resolve(s.target):null})).filter(s=>s.target!==id)};
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
  return {reading,redirects,suggestions};
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
  if(source===target||![source,target].every(id=>project.characters.some(c=>c.id===id)))throw new Error('请选择两个不同的现有人物。');
  const resolve=(id:string)=>id===source?target:id;
  const mergePeople=(people:Character[])=>{
    const result:Character[]=[];
    const from=people.find(c=>c.id===source),to=people.find(c=>c.id===target);
    for(const person of people){
      if(person.id===source&&to)continue;
      const combined=person.id===target&&from?{...person,firstPage:Math.min(person.firstPage,from.firstPage),aliases:[...new Set([...person.aliases,...from.aliases,from.name])].filter(n=>n!==person.name),avatar:person.avatar||from.avatar,
        description:person.description||from.description,appearance:person.appearance||from.appearance,profile:[...(person.profile||[]),...(from.profile||[])],statuses:[...(person.statuses||[]),...(from.statuses||[])],records:[...(person.records||[]),...(from.records||[])]}:person;
      const id=resolve(combined.id);
      result.push({...combined,id,profile:mergeFacts(combined.profile||[],resolve,id),statuses:mergeFacts(combined.statuses||[],resolve,id),records:combined.records?.map(r=>({...r,...(r.target?{target:resolve(r.target)}:{})})).filter(r=>r.target!==id).sort((a,b)=>a.sincePage-b.sincePage)});
    }return result;
  };
  project.characters=mergePeople(project.characters);project.relations=mergeRelations(project.relations,resolve);
  for(const stage of project.stages){
    // Each stage uses only its own data: no later name, portrait or facts are copied backward.
    stage.characters=mergePeople(stage.characters);stage.relations=mergeRelations(stage.relations,resolve);
    if(stage.baselineRelations)stage.baselineRelations=mergeRelations(stage.baselineRelations,resolve);
    if(stage.baselineStatuses){const grouped=new Map<string,CharacterFact[]>();for(const p of stage.baselineStatuses){const id=resolve(p.id);grouped.set(id,[...(grouped.get(id)||[]),...(p.statuses||[])]);}stage.baselineStatuses=[...grouped].map(([id,statuses])=>({id,statuses:mergeFacts(statuses,resolve,id)}));}
  }
  project.identityRedirects=Object.fromEntries([...Object.entries(project.identityRedirects||{}).map(([id,value])=>[id,resolve(value)]),[source,target]]);
  project.identitySuggestions=project.identitySuggestions?.map(s=>({...s,source:resolve(s.source),target:resolve(s.target)})).filter(s=>s.source!==s.target);
}
