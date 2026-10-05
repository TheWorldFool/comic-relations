import type { Character, CharacterFact } from '../shared/types';

export function factTitle(fact:CharacterFact,people:Character[]){
  const target=fact.target?people.find(p=>p.id===fact.target)?.name||fact.target:null;
  return `${target?`对${target} · `:''}${fact.label}`;
}
export function stateSummaries(person:Character,people:Character[]){
  return [...(person.statuses||[])].sort((a,b)=>Number(!!a.target)-Number(!!b.target)||b.sincePage-a.sincePage)
    .map(state=>({text:`${state.certainty==='uncertain'?'待确认 · ':''}${factTitle(state,people)}：${state.value}`,uncertain:state.certainty==='uncertain'}));
}
