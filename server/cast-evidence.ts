import type { AppearanceEndpoint, Project } from '../shared/types.js';
import { identityPeople } from '../shared/identity-people.js';

// Archives are retained for audit/rebinding, but a withdrawn detection alone
// must not keep a character in the current graph. Legacy evidence stays valid.
export function refreshCastEvidence(project:Project){
  if(!project.identityBaseline||!project.appearances)return;
  const supported=new Set<string>(),first=new Map<string,number>();
  const seen=(id:string,page?:number)=>{
    supported.add(id);
    if(page!==undefined)first.set(id,Math.min(first.get(id)??Infinity,page));
  };
  for(const person of project.identityBaseline.characters)seen(person.id,person.firstPage);
  const byId=new Map(project.appearances.map(a=>[a.id,a]));
  const endpoint=(ref:AppearanceEndpoint)=>{
    const a=ref.appearanceId?byId.get(ref.appearanceId):undefined;
    const id=a?(a.characterId||a.trackId):ref.characterId;
    if(id)seen(id);
  };
  for(const a of project.appearances){
    seen(a.characterId||a.trackId,a.page);
    for(const f of [...a.profileUpdates,...a.statusChanges])if(f.target)endpoint(f.target);
  }
  for(const e of project.appearanceFacts||[]){
    endpoint(e.owner);
    for(const f of [...e.profileUpdates,...e.statusChanges])if(f.target)endpoint(f.target);
  }
  for(const e of project.appearanceRelations||[]){endpoint(e.source);endpoint(e.target);}
  for(const correction of project.corrections||[]){
    if(correction.kind==='relation'){seen(correction.relation.source);seen(correction.relation.target);}
    else{seen(correction.personId);if(correction.kind==='fact'&&correction.fact.target)seen(correction.fact.target);}
  }
  for(const person of identityPeople(project)){
    if(first.has(person.id))person.firstPage=first.get(person.id)!;
    if(person.identityState!=='pending'&&!supported.has(person.id))person.archived=true;
    else delete person.archived;
  }
}
