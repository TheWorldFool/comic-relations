import type { Project } from './types.js';

// Pending tracks retain compatibility with the reader's stable IDs, but are
// stored separately from the established cast. Legacy projects need no rewrite.
export function identityPeople(project:Project){
  return [...new Map([...project.characters,...(project.pendingIdentities||[])].map(c=>[c.id,c])).values()];
}
export function identityView(project:Project):Project{return {...project,characters:identityPeople(project)};}
export function separatePending(project:Project){
  const people=identityPeople(project);
  project.pendingIdentities=people.filter(c=>c.identityState==='pending');
  project.characters=people.filter(c=>c.identityState!=='pending');
}

export function appearanceCorrections(project:Project){
  return (project.appearances||[]).filter(a=>a.bindings.some(b=>b.method==='manual')).map(a=>({id:a.id,page:a.page,observedName:a.observed.name,characterId:a.characterId,trackId:a.trackId,reason:a.bindings.at(-1)?.reason}));
}
