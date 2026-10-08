import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Project, Appearance } from '../shared/types.js';
import { identityPeople } from '../shared/identity-people.js';
import { beginAppearanceLedger, rebuildAppearanceEvidence } from './appearances.js';

export const manualAppearanceSchema=z.object({
  pageId:z.string().min(1),characterId:z.string().min(1).nullable(),
  name:z.string().trim().max(200).default(''),nameType:z.enum(['named','descriptive']).default('descriptive'),
  appearance:z.string().trim().max(1000).default(''),reason:z.string().trim().min(1).max(1000),
  box:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)})
    .refine(b=>b.x+b.width<=1.000001&&b.y+b.height<=1.000001,'框选范围超出原页。'),
});
export type ManualAppearanceInput=z.infer<typeof manualAppearanceSchema>;

export function addManualAppearance(project:Project,raw:ManualAppearanceInput){
  const input=manualAppearanceSchema.parse(raw),draft=structuredClone(project);
  const index=draft.pages.findIndex(p=>p.id===input.pageId),page=draft.pages[index];
  if(index<0||index>=draft.processed||page.analysis?.kind!=='story')throw new Error('只能补录已完成分析的正文页。请先完成该页阅读。');
  const people=identityPeople(draft);
  let person=people.find(c=>c.id===input.characterId);
  if(input.characterId&&(!person||person.identityState==='pending'))throw new Error('请选择已确认的人物，或建立独立档案。');
  if(!input.characterId&&!input.name)throw new Error('请填写人物姓名或临时外观称呼。');
  if(input.characterId&&draft.appearances?.some(a=>a.pageId===input.pageId&&a.characterId===input.characterId))throw new Error('本页已有该人物出场，请在逐次出场中核对，避免重复补录。');
  beginAppearanceLedger(draft);
  if(!person){
    person={id:`person_${randomUUID()}`,name:input.name,nameType:input.nameType,aliases:[],description:'人工补录的画面人物',appearance:input.appearance,firstPage:index+1,identityState:'confirmed'};
    draft.characters.push(person);
  }
  const entry:Appearance={id:randomUUID(),pageId:page.id,page:index+1,trackId:person.id,characterId:person.id,verification:'manual',
    observed:{name:person.name,appearance:input.appearance||person.appearance||'',box:input.box,view:'manual'},
    evidence:input.reason,candidates:[],profileUpdates:[],statusChanges:[],
    bindings:[{characterId:person.id,atPage:draft.processed,reason:input.reason,method:'manual'}]};
  draft.appearances!.push(entry);rebuildAppearanceEvidence(draft);draft.canUndoMerge=false;
  Object.assign(project,draft);
  return entry.id;
}
