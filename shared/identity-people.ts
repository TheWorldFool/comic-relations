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

// A complete ledger supersedes the IDs saved before a later correction. Older
// pages may only have manually added crops, so those cannot replace all IDs.
export function pageIdentityIds(project:Project,pageNumber:number){
  if(pageNumber<1||pageNumber>project.processed)return [];
  const page=project.pages[pageNumber-1];
  if(!page)return [];
  const observed=(project.appearances||[]).filter(a=>a.page===pageNumber&&a.pageId===page.id).map(a=>a.characterId||a.trackId);
  const complete=project.identityBaseline!==undefined&&pageNumber>project.identityBaseline.throughPage&&project.appearances!==undefined;
  const ids=complete?observed:[...(page.analysis?.characterIds||[]),...observed];
  return [...new Set(ids.map(id=>{
    const seen=new Set<string>();
    while(project.identityRedirects&&Object.hasOwn(project.identityRedirects,id)&&typeof project.identityRedirects[id]==='string'&&!seen.has(id)){seen.add(id);id=project.identityRedirects[id];}
    return id;
  }))];
}

export function appearanceCorrections(project:Project){
  const people=identityPeople(project);
  return (project.appearances||[]).filter(a=>a.page<=project.processed&&project.pages[a.page-1]?.id===a.pageId&&a.bindings.some(b=>b.method==='manual')).map(a=>{
    const manual=a.bindings.filter(b=>b.method==='manual').at(-1)!;
    return {id:a.id,page:a.page,observedName:a.observed.name,box:a.observed.box,characterId:a.characterId,characterName:a.characterId?people.find(c=>c.id===a.characterId)?.name:null,trackId:a.trackId,manualReason:manual.reason,reason:a.bindings.at(-1)?.reason};
  });
}
