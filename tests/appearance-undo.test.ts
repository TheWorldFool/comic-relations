import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReading, resetAnalysis, type Reading } from '../server/analysis.js';
import { bindWithUndo, restoreAppearanceBinding, invalidateAppearanceUndo } from '../server/appearance-undo.js';
import { appearanceCorrections } from '../shared/identity-people.js';
import type { Project } from '../shared/types.js';

function fixture(){
  const p:Project={id:'test',name:'校正撤销',createdAt:'',updatedAt:'1',direction:'ltr',status:'paused',processed:0,memory:'',characters:[],relations:[],stages:[],pages:[1,2].map(n=>({id:`p${n}`,name:String(n),image:'',thumbnail:'',width:100,height:100,override:'story'}))};
  const r:Reading={kind:'story',confidence:1,reason:'正文',summary:'旧称呼的剧情',storyTime:'',memory:'调查',memoryMode:'delta',threadChanges:[],turningPoint:null,characters:['甲','乙'].map((name,i)=>({id:`c${i}`,name,aliases:[],description:'人物',avatarBox:{x:i*.5,y:0,width:.4,height:.5},...(i===0?{statusChanges:[{key:'health',label:'健康',value:'受伤',action:'upsert' as const,certainty:'confirmed' as const,target:null,evidence:'绷带'}]}:{})})),relationChanges:[{action:'upsert',source:'c0',target:'c1',kind:'team',label:'同伴',directed:false,evidence:'一起调查'}]};
  applyReading(p,r,{c0:'/crop.jpg'});
  p.readingRuns=[{id:'run',pageId:'p1',pageNumber:1,recordedAt:'now',outcome:'success',attempts:1,elapsedMs:2000}];
  return p;
}
test('撤销完整恢复出场、档案、参考图与关系，保留原用量；只保留最近一次入口',()=>{
  const p=fixture(),original=structuredClone(p),input={ids:[p.appearances![0].id],characterId:null,newName:'丙',reason:'独立身份'};
  const backup=bindWithUndo(p,input);
  assert.equal(p.appearanceUndo?.available,true);assert.equal(p.appearanceUndo?.targetName,'丙');
  assert.equal(p.characters.length,3);
  assert.deepEqual(restoreAppearanceBinding(p,backup,backup.id),original);
  const second=bindWithUndo(p,{...input,characterId:'c1',newName:undefined});
  assert.equal(second.before.appearanceUndo,undefined);
  assert.throws(()=>restoreAppearanceBinding(p,backup,backup.id));
  const restored=restoreAppearanceBinding(p,second,second.id);
  assert.equal(restored.appearanceUndo,undefined);assert.equal(restored.characters.length,3);
  assert.deepEqual(restored.readingRuns,original.readingRuns);
});
test('后续编辑、阅读或用量变化阻止撤销，坏备份和旧入口不改数据；时间戳不使撤销失效',()=>{
  const p=fixture(),backup=bindWithUndo(p,{ids:[p.appearances![0].id],characterId:null,reason:'待核对'});
  p.updatedAt='new timestamp';invalidateAppearanceUndo(p);assert.equal(p.appearanceUndo?.available,true);
  assert.throws(()=>restoreAppearanceBinding(p,{...backup,before:{...backup.before,memory:'损坏'}},backup.id));
  const before=JSON.stringify(p);assert.throws(()=>restoreAppearanceBinding(p,backup,'wrong-id'));assert.equal(JSON.stringify(p),before);
  for(const changed of [{...p,name:'新名称'},{...p,processed:2},{...p,readingRuns:[...p.readingRuns!,{...p.readingRuns![0],id:'billed-retry'}]}]){
    const draft=structuredClone(changed);assert.throws(()=>restoreAppearanceBinding(draft,backup,backup.id));invalidateAppearanceUndo(draft);assert.equal(draft.appearanceUndo?.available,false);
  }
  const invalid=structuredClone(p);assert.throws(()=>bindWithUndo(invalid,{ids:['missing'],characterId:'c0',reason:'失败'}));assert.deepEqual(invalid,p);
  resetAnalysis(p);assert.equal(p.appearanceUndo,undefined);assert.equal(p.readingRuns?.length,1);
});
test('校正上下文按出场定位，保留人工依据及当前归属，排除未来与错位页面',()=>{
  const p=fixture();bindWithUndo(p,{ids:[p.appearances![0].id],characterId:'c1',reason:'检查耳饰'});
  const appearance=p.appearances![0];
  appearance.bindings.push({characterId:'c1',atPage:1,reason:'后续归并依据',method:'merge'});
  p.appearances!.push({...structuredClone(appearance),id:'future',page:2,pageId:'p2'},{...structuredClone(appearance),id:'wrong-page',pageId:'missing'});
  const before=JSON.stringify(p),hints=appearanceCorrections(p);
  assert.equal(hints.length,1);assert.equal(hints[0].characterName,'乙');assert.equal(hints[0].observedName,'甲');
  assert.equal(hints[0].manualReason,'检查耳饰');assert.equal(hints[0].reason,'后续归并依据');assert.deepEqual(hints[0].box,appearance.observed.box);
  assert.equal(JSON.stringify(p),before);
});
