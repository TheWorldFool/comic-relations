import { refreshCastEvidence } from './cast-evidence.js';
import { randomUUID } from 'node:crypto';
import type { Appearance, AppearanceEndpoint, Project, Character } from '../shared/types.js';
import { identityPeople, separatePending } from '../shared/identity-people.js';
import { relationKey, type Reading } from './analysis.js';
import { applyCharacterFacts } from './character-facts.js';
import { addReference, visibleCast, visibleRelations } from './identity-state.js';
import { applyCorrectionValue } from './corrections.js';

export function beginAppearanceLedger(project:Project){
  project.identityBaseline??={throughPage:project.processed,characters:structuredClone(identityPeople(project)),relations:structuredClone(project.relations)};
  project.appearances??=[];project.appearanceRelations??=[];project.appearanceFacts??=[];
}

// One representative appearance per visible subject per page. A crop is an
// observation, never automatically an approved reference for an identity.
export function recordAppearancePage(project:Project,reading:Reading,avatars:Record<string,string>){
  const page=project.pages[project.processed],number=project.processed+1;
  const entries=reading.characters.filter(c=>c.presence!=='mentioned').map(person=>({person,id:randomUUID()}));
  const endpoint=(id:string):AppearanceEndpoint=>{
    const found=entries.find(e=>e.person.id===id);
    return found?{appearanceId:found.id}:{characterId:id};
  };
  for(const {person,id} of entries){
    const saved=identityPeople(project).find(c=>c.id===person.id)!;
    const review=reading.identityReview?.find(d=>(d.appearanceId||d.id)===person.id||d.decision==='match'&&d.target===person.id);
    const pending=saved.identityState==='pending';
    const verified=!!review&&['new','confirm','separate','match'].includes(review.decision);
    const evidence=review?[...review.evidence.map(e=>e.text),...review.conflicts].join('；'):person.identityConcern||'沿用前文身份，本次未单独复核';
    const update=(f:NonNullable<typeof person.statusChanges>[number])=>({...f,target:f.target?endpoint(f.target):undefined});
    const appearance:Appearance={id,pageId:page.id,page:number,trackId:person.id,characterId:pending?null:person.id,
      verification:pending?'pending':verified?'reviewed':'continuity',
      observed:{name:person.name,appearance:person.appearance||'',outfit:person.outfit,hairStyle:person.hairStyle,box:person.avatarBox,view:person.referenceView||'other',crop:avatars[person.id]},
      evidence,candidates:review?.candidates||saved.identityCandidates||[],
      profileUpdates:(person.profileUpdates||[]).map(f=>({...f})),statusChanges:(person.statusChanges||[]).map(update),
      bindings:[{characterId:pending?null:person.id,atPage:number,reason:evidence,method:'model'}]};
    project.appearances!.push(appearance);
    for(const f of [...(saved.profile||[]),...(saved.statuses||[]),...(saved.records||[])])if(f.sincePage===number)f.appearanceId=id;
    if(verified&&appearance.observed.crop&&!pending){
      addReference(saved,{url:appearance.observed.crop,page:number,view:appearance.observed.view,appearanceId:id});
      saved.avatar ||= appearance.observed.crop;
    }
  }
  for(const person of reading.characters.filter(c=>c.presence==='mentioned')){
    project.appearanceFacts!.push({owner:{characterId:person.id},page:number,pageId:page.id,profileUpdates:(person.profileUpdates||[]).map(f=>({...f})),statusChanges:(person.statusChanges||[]).map(f=>({...f,target:f.target?endpoint(f.target):undefined}))});
  }
  for(const r of reading.relationChanges){
    const source=endpoint(r.source),target=endpoint(r.target);
    project.appearanceRelations!.push({...r,source,target,page:number,pageId:page.id});
    const saved=project.relations.find(old=>relationKey(old)===relationKey(r)&&old.sincePage===number);
    if(saved){saved.sourceAppearanceId=source.appearanceId;saved.targetAppearanceId=target.appearanceId;}
  }
  refreshCastEvidence(project);
}

export function refreshAppearanceReferences(project:Project){
  refreshCastEvidence(project);
  const people=identityPeople(project);
  for(const person of people){
    const oldUrls=new Set(person.references?.filter(r=>r.appearanceId).map(r=>r.url));
    person.references=person.references?.filter(r=>!r.appearanceId);
    if(person.avatar&&oldUrls.has(person.avatar))person.avatar=person.references?.[0]?.url;
  }
  for(const appearance of project.appearances||[]){
    if(!appearance.characterId||!['reviewed','manual'].includes(appearance.verification)||!appearance.observed.crop)continue;
    const person=people.find(c=>c.id===appearance.characterId);
    if(!person||person.identityState==='pending')continue;
    addReference(person,{url:appearance.observed.crop,page:appearance.page,view:appearance.observed.view,appearanceId:appearance.id});
    person.avatar ||= appearance.observed.crop;
  }
}

// Replay only the evidence recorded since this version was first used. Older
// results form an immutable baseline; missing old detections are not invented.
export function rebuildAppearanceEvidence(project:Project){
  if(!project.identityBaseline)return;
  project.characters=identityPeople(project);project.pendingIdentities=[];
  const byId=new Map((project.appearances||[]).map(a=>[a.id,a]));
  const resolve=(endpoint:AppearanceEndpoint)=>{
    const a=endpoint.appearanceId?byId.get(endpoint.appearanceId):undefined;
    return a?(a.characterId||a.trackId):endpoint.characterId;
  };
  for(const person of project.characters){
    const base=project.identityBaseline.characters.find(c=>c.id===person.id);
    person.profile=structuredClone(base?.profile||[]);person.statuses=structuredClone(base?.statuses||[]);person.records=structuredClone(base?.records||[]);
  }
  const facts=[...(project.appearances||[]).map(a=>({...a,manual:false,evidencePage:a.page,owner:{appearanceId:a.id} as AppearanceEndpoint})),...(project.appearanceFacts||[])].sort((a,b)=>a.page-b.page||Number(!!a.manual)-Number(!!b.manual));
  for(const a of facts){
    const person=project.characters.find(c=>c.id===resolve(a.owner));
    if(!person)continue;
    for(const section of ['profile','status'] as const){
      const updates=(section==='profile'?a.profileUpdates:a.statusChanges).flatMap(f=>{
        const target=f.target?resolve(f.target):undefined;
        return f.target&&(!target||target===person.id)?[]:[{...f,target:target||null,appearanceId:a.owner.appearanceId}];
      });
      if(a.manual)for(const update of updates)applyCorrectionValue(project,{kind:'fact',personId:person.id,section,action:update.action,fact:{...update,target:update.target||undefined,sincePage:a.evidencePage||a.page}});
      else applyCharacterFacts(person,section,updates,a.page);
    }
  }
  project.relations=structuredClone(project.identityBaseline.relations);
  for(const event of project.appearanceRelations||[]){
    const source=resolve(event.source),target=resolve(event.target);
    if(!source||!target||source===target)continue;
    const relation={source,target,kind:event.kind,label:event.label,directed:event.directed,evidence:event.manual?`人工校正：${event.evidence}`:event.evidence,sincePage:event.evidencePage||event.page,sourceAppearanceId:event.source.appearanceId,targetAppearanceId:event.target.appearanceId};
    const index=project.relations.findIndex(r=>relationKey(r)===relationKey(relation));
    if(event.action==='remove'){if(index>=0)project.relations.splice(index,1);}
    else if(index<0)project.relations.push(relation);
    else if(event.manual||project.relations[index].label.trim()!==relation.label.trim())project.relations[index]=relation;
  }
  for(const correction of project.corrections||[])applyCorrectionValue(project,correction);
  refreshAppearanceReferences(project);
  separatePending(project);
  const stage=project.stages.at(-1);
  if(stage){
    stage.characters=structuredClone(visibleCast(project));stage.relations=structuredClone(visibleRelations(project));
    // The reader compares future changes with this stage's starting state.
    // Correct its identities too, using only evidence available at that point.
    if(stage.fromPage>project.identityBaseline.throughPage){
      const baseline=structuredClone({...project,stages:[],processed:stage.fromPage,
        appearances:project.appearances?.filter(a=>a.page<=stage.fromPage),
        appearanceFacts:project.appearanceFacts?.filter(a=>a.page<=stage.fromPage),
        appearanceRelations:project.appearanceRelations?.filter(a=>a.page<=stage.fromPage),
        corrections:project.corrections?.filter(c=>c.page<=stage.fromPage)});
      rebuildAppearanceEvidence(baseline);
      stage.baselineRelations=structuredClone(visibleRelations(baseline));
      stage.baselineStatuses=structuredClone(visibleCast(baseline).map(({id,statuses})=>({id,statuses})));
    }
  }
}

export function bindAppearances(project:Project,ids:string[],characterId:string|null,reason:string,newName?:string){
  if(!ids.length||new Set(ids).size!==ids.length)throw new Error('请选择不同的出场记录。');
  const draft=structuredClone(project),people=identityPeople(draft);
  if(!reason.trim())throw new Error('请填写校正依据。');
  if(newName!==undefined){
    if(characterId||!newName.trim()||newName.trim().length>200)throw new Error('请填写有效的独立人物名称。');
    characterId=`person_${randomUUID()}`;
    const first=draft.appearances?.find(a=>a.id===ids[0]);
    people.push({id:characterId,name:newName.trim(),aliases:[],description:'用户根据出场记录确认的独立人物',appearance:first?.observed.appearance||'',firstPage:Math.min(...ids.map(id=>draft.appearances?.find(a=>a.id===id)?.page||draft.processed)),identityState:'confirmed',nameType:'named'});
  }
  const target=people.find(c=>c.id===characterId);
  if(characterId&&(!target||target.identityState==='pending'))throw new Error('请选择已确认的人物档案。');
  const selected=ids.map(id=>draft.appearances?.find(a=>a.id===id));
  if(selected.some(a=>!a||a.page>draft.processed))throw new Error('出场记录不存在或超出已读范围。');
  for(const a of selected as Appearance[]){
    if(a.characterId===characterId&&a.verification==='manual')continue;
    a.characterId=characterId;a.verification=characterId?'manual':'pending';
    // Detaching one occurrence must not attach its facts back to the old person.
    if(!characterId){
      a.trackId=`pending_${a.id}`;
      if(!people.some(c=>c.id===a.trackId)){
        const pending:Character={id:a.trackId,name:`待辨认人物（P.${a.page}）`,aliases:[],description:'独立保留的待定出场',appearance:a.observed.appearance,firstPage:a.page,identityState:'pending',identityEvidence:reason};
        people.push(pending);
      }
    }
    a.bindings.push({characterId,atPage:draft.processed,reason,method:'manual'});
  }
  draft.characters=people;draft.pendingIdentities=[];
  // Drop emptied provisional indexes; appearances remain the source of evidence.
  const directlyReferenced=(id:string)=>draft.appearanceFacts?.some(e=>e.owner.characterId===id||e.statusChanges.some(f=>f.target?.characterId===id))||draft.appearanceRelations?.some(e=>e.source.characterId===id||e.target.characterId===id);
  draft.characters=draft.characters.filter(c=>c.identityState!=='pending'||directlyReferenced(c.id)||draft.identityBaseline?.characters.some(b=>b.id===c.id)||draft.corrections?.some(f=>f.kind==='relation'?[f.relation.source,f.relation.target].includes(c.id):f.personId===c.id||f.kind==='fact'&&f.fact.target===c.id)||draft.appearances?.some(a=>a.trackId===c.id&&!a.characterId));
  rebuildAppearanceEvidence(draft);
  draft.canUndoMerge=false;
  Object.assign(project,draft);
}

export function confirmTrackAppearances(project:Project,id:string,evidence:string,method:'model'|'manual'='model'){
  for(const a of project.appearances||[])if(a.trackId===id&&!a.characterId){
    a.characterId=id;a.verification=method==='manual'?'manual':'continuity';a.bindings.push({characterId:id,atPage:project.processed,reason:evidence,method});
  }
  refreshAppearanceReferences(project);
}

export function remapAppearanceIdentity(project:Project,source:string,target:string){
  for(const a of project.appearances||[]){
    if(a.characterId===source||!a.characterId&&a.trackId===source){
      a.characterId=target;if(a.verification==='pending')a.verification='continuity';a.bindings.push({characterId:target,atPage:project.processed,reason:'身份归并确认',method:'merge'});
    }
    if(a.trackId===source)a.trackId=target;
    a.candidates=[...new Set(a.candidates.map(id=>id===source?target:id))];
    for(const f of [...a.profileUpdates,...a.statusChanges])if(f.target?.characterId===source)f.target.characterId=target;
  }
  for(const e of project.appearanceFacts||[]){
    if(e.owner.characterId===source)e.owner.characterId=target;
    for(const f of [...e.profileUpdates,...e.statusChanges])if(f.target?.characterId===source)f.target.characterId=target;
  }
  for(const e of project.appearanceRelations||[])for(const end of [e.source,e.target])if(end.characterId===source)end.characterId=target;
}
