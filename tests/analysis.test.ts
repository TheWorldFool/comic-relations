import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReading, graphFingerprint, resetAnalysis, validateReferences, type Reading } from '../server/analysis.js';
import type { Project } from '../shared/types.js';
function project(): Project { return { id:'test', name:'测试', createdAt:'',updatedAt:'',direction:'rtl', pages:Array.from({length:8},(_,i)=>({id:`p${i}`,name:`${i}.jpg`,image:'',thumbnail:'',width:100,height:100,override:'auto'})), characters:[],relations:[],stages:[],memory:'',processed:0,status:'idle' }; }
const character = (id:string,name=id) => ({id,name,aliases:[],description:'人物',avatarBox:null});
const reading = (overrides: Partial<Reading> = {}): Reading => ({kind:'story',confidence:0.95,reason:'正文',summary:'本页剧情',storyTime:'',memory:'累计剧情',turningPoint:null,characters:[],relationChanges:[],...overrides});
const turningPoint = {title:'同盟正式破裂',reason:'双方明确终止共同目标，转而持续对立',confidence:.95};
const relation = (label='同伴') => ({ action:'upsert' as const, source:'a',target:'b',kind:'affiliation',label,directed:false,evidence:'双方确认同行' });
test('无关系变化只延长范围，双向端点反转也不重复；变化形成独立历史快照',()=>{
  const p=project();
  applyReading(p,reading({characters:[character('a','阿甲'),character('b','阿乙')],relationChanges:[relation()]}));
  applyReading(p,reading({relationChanges:[{...relation(),source:'b',target:'a',evidence:'再次同行'}]}));
  assert.equal(p.stages.length,1);assert.equal(p.stages[0].toPage,2);assert.equal(p.relations[0].sincePage,1);
  applyReading(p,reading({characters:[character('a','甲的新名字')],relationChanges:[relation('敌对')],turningPoint}));
  assert.equal(p.stages.length,2);assert.equal(p.stages[0].characters[0].name,'阿甲');assert.equal(p.stages[0].relations[0].label,'同伴');assert.equal(p.stages[1].fromPage,3);assert.equal(p.stages[1].relations[0].label,'敌对');
  assert.deepEqual(p.characters[0].aliases,['阿甲']);
});
test('封面广告不污染人物、记忆与关系，页码仍连续',()=>{
  const p=project();
  applyReading(p,reading({kind:'cover',characters:[character('fake')],memory:'错误剧情'}));
  assert.equal(p.characters.length,0);assert.equal(p.stages.length,0);assert.equal(p.memory,'');
  applyReading(p,reading({characters:[character('a')]}));
  applyReading(p,reading({kind:'ad',characters:[character('fake')],memory:'广告'}));
  assert.equal(p.stages[0].fromPage,2);assert.equal(p.stages[0].toPage,3);assert.equal(p.characters.length,1);assert.equal(p.memory,'累计剧情');
});
test('人物缺席不会删关系，关系解除创建新阶段，新人物不单独新增阶段',()=>{
  const p=project();applyReading(p,reading({characters:[character('a'),character('b')],relationChanges:[relation()]}));
  applyReading(p,reading({characters:[character('c')]}));assert.equal(p.stages.length,1);assert.equal(p.stages[0].characters.length,3);assert.equal(p.relations.length,1);
  applyReading(p,reading({relationChanges:[{...relation(),action:'remove'}],turningPoint}));assert.equal(p.stages.length,2);assert.equal(p.relations.length,0);assert.equal(p.stages[0].relations.length,1);
});
test('小变化持续更新当前图，重大转折才分段；结束的阶段不被后文覆盖',()=>{
  const p=project();applyReading(p,reading({characters:[character('a'),character('b')],relationChanges:[relation()]}));
  applyReading(p,reading({relationChanges:[relation('同行并互相照应')]}));
  applyReading(p,reading({relationChanges:[{...relation('暂时意见不合'),kind:'attitude'}]}));
  assert.equal(p.stages.length,1);assert.equal(p.stages[0].toPage,3);assert.equal(p.stages[0].relations.length,2);assert.equal(p.stages[0].relations[0].label,'同行并互相照应');assert.equal(p.stages[0].baselineRelations![0].label,'同伴');
  applyReading(p,reading({relationChanges:[relation('敌对')],turningPoint}));
  assert.equal(p.stages.length,2);assert.equal(p.stages[1].fromPage,4);assert.equal(p.stages[0].toPage,3);assert.equal(p.stages[0].relations[0].label,'同行并互相照应');
  applyReading(p,reading({turningPoint}));assert.equal(p.stages.length,2,'重复宣称转折但无实际变化不新增');
  applyReading(p,reading({relationChanges:[relation('暂时停战')],turningPoint:{...turningPoint,confidence:.5}}));assert.equal(p.stages.length,2,'低置信度转折不新增');assert.equal(p.stages[1].relations[0].label,'暂时停战');
});
test('多个关系维度并存，单向关系保留方向',()=>{
  const p=project();applyReading(p,reading({characters:[character('a'),character('b')],relationChanges:[relation(),{...relation('兄妹'),kind:'kinship'}]}));assert.equal(p.relations.length,2);
  assert.notEqual(graphFingerprint([{...p.relations[0],directed:true}]),graphFingerprint([{...p.relations[0],source:'b',target:'a',directed:true}]));
});
test('未知人物引用拒绝；重置保留原图和人工页面标记',()=>{
  const p=project();assert.throws(()=>validateReferences(p,reading({relationChanges:[relation()]})),/引用无效/);
  p.pages[0].override='skip';p.memory='old';p.processed=2;resetAnalysis(p);assert.equal(p.pages.length,8);assert.equal(p.pages[0].override,'skip');assert.equal(p.processed,0);assert.equal(p.memory,'');
});
