import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReading, resetAnalysis, type Reading } from '../server/analysis.js';
import { memoryPlan } from '../server/reading-memory.js';
import { readingContext } from '../server/reading-request.js';
import type { Project } from '../shared/types.js';

const project=():Project=>({id:'test',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'idle',processed:0,memory:'旧版累计记忆',characters:[],relations:[],stages:[],pages:Array.from({length:10},(_,i)=>({id:`p${i}`,name:`${i}.jpg`,image:'',thumbnail:'',width:100,height:100,override:'story'}))});
const reading=(overrides:Partial<Reading>={}):Reading=>({kind:'story',confidence:1,reason:'正文',summary:'本页事件',storyTime:'',memory:'增量事件',memoryMode:'delta',threadChanges:[],turningPoint:null,characters:[],relationChanges:[],...overrides});

test('空白汇总及旧格式空记忆不能清空已有剧情；无新增事件的增量仍允许为空',()=>{
  const p=project();applyReading(p,reading({memory:'重要事件'}));const before=JSON.stringify(p);
  for(const mode of ['checkpoint',undefined] as const)for(const memory of ['', ' \n\t ']){
    assert.throws(()=>applyReading(p,reading({memoryMode:mode,memory})),/汇总不能为空/);assert.equal(JSON.stringify(p),before);
  }
  applyReading(p,reading({memory:''}));assert.equal(p.memory,'旧版累计记忆');assert.equal(p.readingMemory?.pending[0].text,'重要事件');
});

test('旧记忆作为检查点继续；跨汇总保留未解线索，已读增量不丢失、不影响阶段',()=>{
  let p=project();
  for(let n=1;n<=5;n++){
    assert.equal(memoryPlan(p),'delta');
    applyReading(p,reading({memory:`增量${n}`,threadChanges:n===1?[{action:'upsert',id:'name',text:'匿名者身份待确认'}]:[]}));
    // Simulate persistence and restart between every page.
    p=JSON.parse(JSON.stringify(p));
  }
  const context=readingContext(p);
  assert.equal(context.memory,'旧版累计记忆');
  assert.deepEqual(context.memoryState.pending.map(e=>e.text),['增量1','增量2','增量3','增量4','增量5']);
  assert.equal(context.memoryInstruction,'checkpoint');
  applyReading(p,reading({memoryMode:'checkpoint',memory:'旧情节与1至6页的汇总'}));
  assert.deepEqual(p.readingMemory?.pending,[]);assert.equal(p.readingMemory?.checkpointPage,6);
  assert.equal(p.readingMemory?.threads[0].text,'匿名者身份待确认');assert.equal(p.stages.length,1);
  applyReading(p,reading({threadChanges:[{action:'resolve',id:'name',text:'本页明确自报姓名'}]}));
  assert.deepEqual(p.readingMemory?.threads,[]);assert.equal(p.readingMemory?.pending.length,1);
});

test('错误增量模式、未知/重复线索和无效人物引用均在任何页面提交之前拒绝',()=>{
  const p=project();for(let i=0;i<5;i++)applyReading(p,reading());
  const before=JSON.stringify(p);
  assert.throws(()=>applyReading(p,reading()),/checkpoint/);assert.equal(JSON.stringify(p),before);
  assert.throws(()=>applyReading(p,reading({memoryMode:'checkpoint',threadChanges:[{action:'resolve',id:'unknown',text:'推测解决'}]})),/未知线索/);
  assert.throws(()=>applyReading(p,reading({memoryMode:'checkpoint',threadChanges:[{action:'upsert',id:'x',text:'线索'},{action:'resolve',id:'x',text:'解决'}]})),/重复线索/);
  assert.throws(()=>applyReading(p,reading({memoryMode:'checkpoint',relationChanges:[{action:'upsert',source:'unknown',target:'other',kind:'team',label:'同伴',directed:false,evidence:'未知引用'}]})),/引用无效/);
  assert.equal(JSON.stringify(p),before);
});

test('跳过页不改变记忆计划；大增量提前触发汇总；重置清除所有新状态和计时',()=>{
  const p=project();applyReading(p,reading({memory:'字'.repeat(6000)}));
  assert.equal(memoryPlan(p),'checkpoint');
  p.pages[1].override='skip';const state=JSON.stringify(p.readingMemory);
  applyReading(p,reading({kind:'ad',memory:'广告不得入记忆',threadChanges:[{action:'upsert',id:'fake',text:'广告内容'}]}));
  assert.equal(JSON.stringify(p.readingMemory),state);assert.equal(memoryPlan(p),'checkpoint');
  p.pages[0].timing={elapsedMs:10,attempts:1};resetAnalysis(p);
  assert.equal(p.readingMemory,undefined);assert.equal(p.memory,'');assert.equal(p.pages[0].timing,undefined);assert.equal(p.pages[0].analysis,undefined);
});
