import { identityPeople, separatePending } from '../shared/identity-people.js';
import { confirmTrackAppearances } from './appearances.js';
import type { Character, CharacterReference, Project } from '../shared/types.js';

// Pending people and their evidence remain stored, but do not assert graph facts.
export function visibleCast(project:Project){
  const known=new Set(project.characters.filter(c=>c.identityState!=='pending').map(c=>c.id));
  return project.characters.filter(c=>known.has(c.id)).map(c=>({...c,
    statuses:c.statuses?.filter(f=>!f.target||known.has(f.target)),
    records:c.records?.filter(f=>!f.target||known.has(f.target)),
  }));
}
export function visibleRelations(project:Project){
  const known=new Set(project.characters.filter(c=>c.identityState!=='pending').map(c=>c.id));
  return project.relations.filter(r=>known.has(r.source)&&known.has(r.target));
}
export function addReference(person:Character,reference:CharacterReference){
  const refs=[...(person.references||[])];
  if(refs.some(r=>r.page===reference.page&&r.view===reference.view))return;
  refs.push(reference);
  // Keep the first appearance and the latest sample of each other view, capped at four.
  const byView=new Map<string,CharacterReference>();
  for(const ref of refs.slice(1))byView.set(ref.view,ref);
  person.references=[refs[0],...Array.from(byView.values()).sort((a,b)=>b.page-a.page)].slice(0,4);
}
export function confirmIdentity(project:Project,id:string,evidence='用户确认：这是独立人物',method:'manual'|'model'='manual'){
  const person=identityPeople(project).find(c=>c.id===id);
  if(!person||person.identityState!=='pending')throw new Error('该人物不是待定身份。');
  person.identityState='confirmed';person.identityEvidence=evidence;person.identityCandidates=[];
  confirmTrackAppearances(project,id,evidence,method);
  separatePending(project);
  project.canUndoMerge=false;
  const stage=project.stages.at(-1);
  if(stage){stage.characters=structuredClone(visibleCast(project));stage.relations=structuredClone(visibleRelations(project));}
}
