import type { AppearanceEndpoint, Project, Stage } from '../shared/types.js';
import { factKey } from './character-facts.js';
import { relationKey } from './analysis.js';

// Rebuild readable records from explicit events, never replace names in prose.
export function rebuildStageRecords(project:Project,stage:Stage){
  const people=new Map(stage.characters.map(c=>[c.id,c]));
  const appearances=new Map((project.appearances||[]).map(a=>[a.id,a]));
  const resolve=(e:AppearanceEndpoint)=>e.appearanceId?appearances.get(e.appearanceId)?.characterId:e.characterId;
  const rows:{page:number;text:string}[]=[];
  const inStage=(page:number)=>page>=stage.fromPage&&page<=stage.toPage;
  const corrections=(project.corrections||[]).filter(c=>c.page<=stage.toPage);
  for(const event of [...(project.appearances||[]).map(a=>({...a,owner:{appearanceId:a.id},manual:false,evidencePage:a.page})),...(project.appearanceFacts||[])]){
    const id=resolve(event.owner),person=id?people.get(id):undefined;
    if(!person||!inStage(event.page))continue;
    for(const [section,updates] of [['profile',event.profileUpdates],['status',event.statusChanges]] as const)for(const f of updates){
      const target=f.target?resolve(f.target):undefined;
      if(f.target&&(!target||target===id||!people.has(target)))continue;
      if(corrections.some(c=>c.kind==='fact'&&c.personId===id&&c.section===section&&factKey(c.fact)===factKey({...f,target})))continue;
      rows.push({page:event.page,text:`P.${event.evidencePage||event.page} · ${person.name}${target?` 对${people.get(target)!.name}`:''}：${f.action==='remove'?'撤销':''}${f.label} · ${f.value}${f.certainty==='uncertain'?'（待确认观察）':''}${event.manual?'（人工校正）':''}`});
    }
  }
  for(const event of project.appearanceRelations||[]){
    const source=resolve(event.source),target=resolve(event.target);
    if(!source||!target||source===target||!people.has(source)||!people.has(target)||!inStage(event.page))continue;
    if(corrections.some(c=>c.kind==='relation'&&relationKey(c.relation)===relationKey({...event,source,target})))continue;
    rows.push({page:event.page,text:`P.${event.evidencePage||event.page} · ${people.get(source)!.name} ${event.directed?'→':'↔'} ${people.get(target)!.name}：${event.action==='remove'?'解除':''}${event.label}${event.manual?'（人工校正）':''}`});
  }
  for(const c of corrections){
    if(c.kind==='relation'&&people.has(c.relation.source)&&people.has(c.relation.target))rows.push({page:c.page,text:`人工固定 · ${people.get(c.relation.source)!.name} ${c.relation.directed?'→':'↔'} ${people.get(c.relation.target)!.name}：${c.action==='remove'?'解除':''}${c.relation.label}`});
    if(c.kind==='fact'&&people.has(c.personId)&&(!c.fact.target||people.has(c.fact.target)))rows.push({page:c.page,text:`人工固定 · ${people.get(c.personId)!.name}${c.fact.target?` 对${people.get(c.fact.target)!.name}`:''}：${c.action==='remove'?'撤销':''}${c.fact.label} · ${c.fact.value}`});
  }
  if(!stage.recordsRebuilt)stage.originalChanges=[...stage.changes];
  stage.changes=[...new Set(rows.sort((a,b)=>a.page-b.page).map(r=>r.text))];
  stage.recordsRebuilt=true;
  stage.recordsIncomplete=!project.identityBaseline||project.identityBaseline.throughPage>=stage.fromPage;
}
