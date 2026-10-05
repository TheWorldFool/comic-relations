import type { Character, CharacterFact } from '../shared/types.js';

export type FactUpdate = Omit<CharacterFact,'sincePage'|'target'> & {action:'upsert'|'remove';target?:string|null};
export const factKey = (fact:{key:string;target?:string|null})=>JSON.stringify([fact.key.trim().toLowerCase(),fact.target||null]);

export function applyCharacterFacts(person:Character,section:'profile'|'status',updates:FactUpdate[],page:number):string[] {
  const field=section==='profile'?'profile':'statuses';
  const facts=person[field]??=[];
  const changes:string[]=[];
  for(const update of updates){
    const index=facts.findIndex(f=>factKey(f)===factKey(update));
    const old=facts[index];
    // A rumour cannot replace (or erase) a confirmed fact. Its evidence remains in the record.
    if(old?.certainty==='confirmed'&&update.certainty==='uncertain'){
      const previous=[...(person.records||[])].reverse().find(r=>r.section===section&&factKey(r)===factKey(update));
      if(!previous||previous.value!==update.value||previous.certainty!==update.certainty||previous.action!==update.action)
        (person.records??=[]).push({...toFact(update,page),section,action:update.action});
      continue;
    }
    if(update.action==='remove'){
      if(!old)continue;
      facts.splice(index,1);
      changes.push(`${person.name}：撤销${old.label}（${old.value}）`);
    }else{
      if(old?.value===update.value&&old.certainty===update.certainty)continue;
      const next=toFact(update,page);
      if(index<0)facts.push(next);else facts[index]=next;
      changes.push(`${person.name}：${update.label}${old?`由“${old.value}”变为`:''}“${update.value}”${update.certainty==='uncertain'?'（待确认）':''}`);
    }
    (person.records??=[]).push({...toFact(update,page),section,action:update.action});
  }
  return changes;
}
function toFact(update:FactUpdate,page:number):CharacterFact {
  const {action,target,...fact}=update;
  return {...fact,key:fact.key.trim().toLowerCase(),sincePage:page,...(target?{target}:{})};
}
export function statusFingerprint(people:Character[]){
  return JSON.stringify(people.flatMap(person=>(person.statuses||[]).filter(s=>s.certainty==='confirmed').map(s=>JSON.stringify([person.id,factKey(s),s.value.trim()]))).sort());
}
