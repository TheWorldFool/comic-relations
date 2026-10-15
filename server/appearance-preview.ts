import { createHash } from 'node:crypto';
import { z } from 'zod';
import { bindAppearances } from './appearances.js';
import { identityPeople } from '../shared/identity-people.js';
import type { AppearanceBindingInput, AppearanceBindingPreview, Project } from '../shared/types.js';

export const appearanceBindingSchema=z.object({ids:z.array(z.string()).min(1).max(200),characterId:z.string().nullable(),reason:z.string().trim().min(1).max(1000),newName:z.string().trim().min(1).max(200).optional(),previewToken:z.string().optional()});
export function appearancePreviewToken(project:Project,input:AppearanceBindingInput){
  return createHash('sha256').update(JSON.stringify(project)).update(JSON.stringify({ids:input.ids,characterId:input.characterId,reason:input.reason,newName:input.newName})).digest('hex');
}
function facts(project:Project){
  const result=new Map<string,{kind:AppearanceBindingPreview['changes'][number]['kind'];text:string}>();
  const people=identityPeople(project),name=(id:string)=>people.find(p=>p.id===id)?.name||id;
  for(const p of people){
    result.set(`person:${p.id}`,{kind:'人物',text:`${p.name} · ${p.identityState==='pending'?'待定':p.archived?'保留档案，无当前出场依据':'已确认'} · 初登场 P.${p.firstPage}`});
    for(const [section,kind] of [['profile','档案'],['statuses','状态']] as const)for(const f of p[section]||[]){
      result.set(JSON.stringify([section,p.id,f.key,f.target||'']),{kind,text:`${p.name} · ${f.label}${f.target?` → ${name(f.target)}`:''}：${f.value} · P.${f.sincePage}${f.certainty==='uncertain'?'（待确认）':''}`});
    }
  }
  for(const r of project.relations){
    const pair=r.directed?[r.source,r.target]:[r.source,r.target].sort();
    result.set(JSON.stringify(['relation',...pair,r.kind,r.directed]),{kind:'关系',text:`${name(r.source)} ${r.directed?'→':'↔'} ${name(r.target)}：${r.label} · P.${r.sincePage}`});
  }
  return result;
}
export function previewAppearanceBinding(project:Project,input:AppearanceBindingInput):AppearanceBindingPreview{
  const draft=structuredClone(project);
  bindAppearances(draft,input.ids,input.characterId,input.reason,input.newName);
  const before=facts(project),after=facts(draft),changes:AppearanceBindingPreview['changes']=[];
  for(const key of new Set([...before.keys(),...after.keys()])){
    const a=before.get(key),b=after.get(key);
    if(a?.text!==b?.text)changes.push({kind:(a||b)!.kind,before:a?.text||null,after:b?.text||null});
  }
  return {token:appearancePreviewToken(project,input),selected:input.ids.length,pages:[...new Set(project.appearances?.filter(a=>input.ids.includes(a.id)).map(a=>a.page))].sort((a,b)=>a-b),changes};
}
