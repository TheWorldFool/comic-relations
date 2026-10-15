import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReading, type Reading } from '../server/analysis.js';
import { bindAppearances } from '../server/appearances.js';
import { correctProject } from '../server/corrections.js';
import { mergeCharacters } from '../server/identity.js';
import type { Project } from '../shared/types.js';

test('出场校正重建当前阶段记录，保留原文并标记范围；继续阅读不复活错误姓名',()=>{
  const p:Project={id:'test',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'paused',processed:0,memory:'',characters:[],relations:[],stages:[],pages:[1,2,3].map(n=>({id:`p${n}`,name:String(n),image:'',thumbnail:'',width:100,height:100,override:'story'}))};
  const r:Reading={kind:'story',confidence:1,reason:'正文',summary:'甲与乙合作',storyTime:'',memory:'甲与乙合作',memoryMode:'delta',threadChanges:[],turningPoint:null,characters:['甲','乙','丙'].map((name,i)=>({id:`c${i}`,name,aliases:[],description:'人物',avatarBox:null})),relationChanges:[{action:'upsert',source:'c0',target:'c1',kind:'team',label:'合作',directed:false,evidence:'一起行动'}]};
  applyReading(p,r);
  const original=[...p.stages[0].changes],memory=structuredClone(p.readingMemory);
  bindAppearances(p,[p.appearances![0].id],'c2','本页是丙');
  assert.ok(p.stages[0].changes.some(s=>s.includes('丙 ↔ 乙：合作')));
  assert.ok(p.stages[0].changes.every(s=>!s.includes('甲')));
  assert.deepEqual(p.stages[0].originalChanges,original);assert.equal(p.stages[0].recordsRebuilt,true);
  assert.equal(p.pages[0].analysis?.summary,'甲与乙合作');assert.deepEqual(p.readingMemory,memory);
  assert.equal(p.storyReviewFromPage,1);assert.equal(p.storyReviewThroughPage,1);
  applyReading(p,{...r,characters:[r.characters[1],r.characters[2]],relationChanges:[],memory:'后续事件',summary:'新的摘要'});
  assert.ok(p.stages[0].changes.every(s=>!s.includes('甲')));assert.equal(p.storyReviewThroughPage,1,'新读的第二页不误标为旧摘要');
  correctProject(p,{scope:'fixed',kind:'relation',action:'upsert',relation:{source:'c2',target:'c1',kind:'team',label:'竞争',directed:false,evidence:'人工核对',sincePage:1}});
  assert.ok(p.stages[0].changes.some(s=>s.includes('人工固定')&&s.includes('竞争')));
  assert.ok(p.stages[0].changes.every(s=>!s.includes('合作')));
  assert.deepEqual(p.stages[0].originalChanges,original);
});

test('跨阶段归并重建记录但不倒灌后期名字、固定事实或删除原文',()=>{
  const p:Project={id:'test',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'paused',processed:0,memory:'',characters:[],relations:[],stages:[],pages:[1,2,3].map(n=>({id:`p${n}`,name:String(n),image:'',thumbnail:'',width:100,height:100,override:'story'}))};
  const person=(id:string,name:string)=>({id,name,aliases:[],description:'人物',avatarBox:null});
  const r:Reading={kind:'story',confidence:1,reason:'正文',summary:'蒙面人和乙合作',storyTime:'',memory:'蒙面人和乙合作',turningPoint:null,characters:[person('a','蒙面人'),person('b','乙')],relationChanges:[{action:'upsert',source:'a',target:'b',kind:'team',label:'合作',directed:false,evidence:'一起行动'}]};
  applyReading(p,r);const early=structuredClone(p.stages[0]);
  applyReading(p,{...r,characters:[person('c','后期真名')],relationChanges:[{...r.relationChanges[0],source:'c',label:'竞争'}],turningPoint:{title:'竞争开始',reason:'长期目标冲突',confidence:1}});
  assert.equal(p.stages.length,2);
  correctProject(p,{kind:'relation',scope:'fixed',action:'upsert',relation:{source:'c',target:'b',kind:'team',label:'敌对',directed:false,evidence:'后期确认',sincePage:2}});
  mergeCharacters(p,'a','c');
  assert.equal(p.stages[0].characters.find(c=>c.id==='c')?.name,'蒙面人');
  assert.ok(p.stages[0].changes.some(s=>s.includes('蒙面人 ↔ 乙：合作')));
  assert.ok(p.stages[0].changes.every(s=>!s.includes('后期真名')&&!s.includes('敌对')));
  assert.ok(p.stages[1].changes.some(s=>s.includes('后期真名 ↔ 乙：敌对')));
  assert.ok(p.stages[1].changes.every(s=>!s.includes('蒙面人')&&!s.includes('竞争')));
  assert.deepEqual(p.stages[0].originalChanges,early.changes);
  assert.equal(p.stages[0].recordsIncomplete,false);
  assert.equal(p.storyReviewFromPage,1);assert.equal(p.storyReviewThroughPage,2);
  assert.equal(p.pages[0].analysis?.summary,r.summary);
});

test('旧项目归并不把缺失台账当作完整事件记录',()=>{
  const a={id:'a',name:'甲',aliases:[],description:'',firstPage:1},b={...a,id:'b',name:'乙'};
  const p:Project={id:'test',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'completed',processed:2,memory:'旧摘要',characters:[a,b],relations:[],pages:[],stages:[{id:'s',fromPage:1,toPage:2,title:'旧阶段',storyTime:'',characters:[a,b],relations:[],changes:['甲的旧记录']}]};
  mergeCharacters(p,'a','b');
  assert.equal(p.stages[0].recordsIncomplete,true);
  assert.deepEqual(p.stages[0].originalChanges,['甲的旧记录']);
  assert.deepEqual(p.stages[0].changes,[]);
  assert.equal(p.memory,'旧摘要');
});
