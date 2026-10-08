import { identityPeople } from '../shared/identity-people.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CorrectionInput, ManualCorrection, Project } from '../shared/types.js';
import { relationKey, type Reading } from './analysis.js';
import { factKey, applyCharacterFacts } from './character-facts.js';
import { visibleCast, visibleRelations } from './identity-state.js';

const text=z.string().trim().min(1).max(2000);
const fact=z.object({key:text,label:text,value:text,certainty:z.enum(['confirmed','uncertain']),evidence:text,sincePage:z.number().int().positive(),target:z.string().optional()});
const relation=z.object({source:text,target:text,kind:text,label:text,directed:z.boolean(),evidence:text,sincePage:z.number().int().positive()});
export const correctionSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('character'),personId:text,name:text,aliases:z.array(text),description:z.string().max(2000),appearance:z.string().max(1000),nameType:z.enum(['named','descriptive'])}),
  z.object({kind:z.literal('fact'),personId:text,section:z.enum(['profile','status']),action:z.enum(['upsert','remove']),fact}),
  z.object({kind:z.literal('relation'),action:z.enum(['upsert','remove']),relation}),
]);
export const correctionKey=(c:CorrectionInput)=>c.kind==='character'?`person:${c.personId}`:c.kind==='fact'?`fact:${c.personId}:${c.section}:${factKey(c.fact)}`:`relation:${relationKey(c.relation)}`;

export function correctProject(project:Project,input:CorrectionInput){
  if(!project.processed)throw new Error('请先分析页面，再校正已识别的人物。');
  const known=new Set(identityPeople(project).map(c=>c.id));
  if(input.kind==='relation'){
    if(!known.has(input.relation.source)||!known.has(input.relation.target)||input.relation.source===input.relation.target)throw new Error('关系两端必须是不同的现有人物。');
  }else if(!known.has(input.personId)||(input.kind==='fact'&&input.fact.target&&(!known.has(input.fact.target)||input.fact.target===input.personId)))throw new Error('人物或状态目标无效。');
  if(input.kind==='fact'&&input.fact.sincePage>project.processed||input.kind==='relation'&&input.relation.sincePage>project.processed)throw new Error('证据页不能超过已读范围。');
  const c:ManualCorrection={...structuredClone(input),id:randomUUID(),page:project.processed};
  project.corrections=[...(project.corrections||[]).filter(old=>correctionKey(old)!==correctionKey(c)),c];
  applyCorrectionValue(project,c);
  const stage=project.stages.at(-1);
  if(stage){stage.characters=structuredClone(visibleCast(project));stage.relations=structuredClone(visibleRelations(project));}
  project.canUndoMerge=false;
}

export function applyCorrectionValue(project:Project,c:CorrectionInput){
  if(c.kind==='character'){
    const person=identityPeople(project).find(p=>p.id===c.personId)!;
    Object.assign(person,{name:c.name,aliases:c.aliases,description:c.description,appearance:c.appearance,nameType:c.nameType});
  }else if(c.kind==='fact'){
    const person=identityPeople(project).find(p=>p.id===c.personId)!;
    if(c.action==='upsert'){const field=c.section==='profile'?'profile':'statuses';person[field]=person[field]?.filter(f=>factKey(f)!==factKey(c.fact));}
    applyCharacterFacts(person,c.section,[{...c.fact,action:c.action,evidence:`人工校正：${c.fact.evidence}`}],c.fact.sincePage);
  }else{
    const index=project.relations.findIndex(r=>relationKey(r)===relationKey(c.relation));
    if(c.action==='remove'){if(index>=0)project.relations.splice(index,1);}
    else{const corrected={...c.relation,evidence:`人工校正：${c.relation.evidence}`};if(index>=0)project.relations[index]=corrected;else project.relations.push(corrected);}
  }
}

export function respectCorrections(project:Project,reading:Reading):Reading{
  if(!project.corrections?.length)return reading;
  const result=structuredClone(reading),locked=new Set(project.corrections.map(correctionKey));
  for(const person of result.characters){
    const rule=project.corrections.find(c=>c.kind==='character'&&c.personId===person.id);
    if(rule?.kind==='character')Object.assign(person,{name:rule.name,aliases:rule.aliases,description:rule.description,appearance:rule.appearance,nameType:rule.nameType});
    person.profileUpdates=person.profileUpdates?.filter(f=>!locked.has(`fact:${person.id}:profile:${factKey(f)}`));
    person.statusChanges=person.statusChanges?.filter(f=>!locked.has(`fact:${person.id}:status:${factKey(f)}`));
  }
  result.relationChanges=result.relationChanges.filter(r=>!locked.has(`relation:${relationKey(r)}`));
  return result;
}

export function mergeCorrections(project:Project,source:string,target:string){
  if(project.corrections?.some(c=>c.kind!=='relation'&&c.personId===source))throw new Error('请先解除待并入人物的人工固定项，再确认合并后的结论。');
  const resolve=(id:string)=>id===source?target:id;
  const mapped=(project.corrections||[]).map(c=>c.kind==='relation'?{...c,relation:{...c.relation,source:resolve(c.relation.source),target:resolve(c.relation.target)}}:c.kind==='fact'?{...c,personId:resolve(c.personId),fact:{...c.fact,...(c.fact.target?{target:resolve(c.fact.target)}:{})}}:{...c,personId:resolve(c.personId)}).filter(c=>c.kind==='relation'?c.relation.source!==c.relation.target:c.kind==='fact'?c.personId!==c.fact.target:true);
  if(new Set(mapped.map(correctionKey)).size!==mapped.length)throw new Error('两个人物有冲突的人工固定项，请先解除相关固定再合并。');
  return mapped;
}
