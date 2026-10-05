import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReading, type Reading } from '../server/analysis.js';
import { mergeCharacters, resolveIdentities } from '../server/identity.js';
import { needsPageReview, reviewAcceptable } from '../server/page-review.js';
import type { Project } from '../shared/types.js';

const person=(id:string,name=id)=>({id,name,aliases:[],description:'人物',appearance:'左眼下有痣',avatarBox:null});
const reading=(input:Partial<Reading>={}):Reading=>({kind:'story',confidence:.95,reason:'正文',summary:'剧情',storyTime:'',memory:'记忆',turningPoint:null,characters:[],relationChanges:[],...input});
const project=():Project=>({id:'test',name:'测试',direction:'ltr',createdAt:'',updatedAt:'',processed:0,status:'idle',pages:Array.from({length:10},(_,i)=>({id:`p${i}`,name:`${i}.jpg`,image:'',thumbnail:'',width:100,height:100,override:'auto'})),characters:[],relations:[],stages:[],memory:''});
const relation=(source:string,target:string)=>({action:'upsert' as const,source,target,kind:'companion',label:'同伴',directed:false,evidence:'共同出发'});

test('无名角色获真名沿用原 ID，关系/态度引用同步归一；不另建图',()=>{
  const p=project();applyReading(p,reading({characters:[{...person('a','短发女子'),nameType:'descriptive'},person('b')],relationChanges:[relation('a','b')]}));
  applyReading(p,reading({characters:[{...person('new','小甲'),nameType:'named',sameAs:{id:'a',confidence:.96,evidence:'左眼痣和场景连续，对方直接称呼'},statusChanges:[{action:'upsert',key:'trust',label:'信任',value:'信任',target:'b',certainty:'confirmed',evidence:'交付钥匙'}]}],relationChanges:[relation('new','b')]}));
  assert.equal(p.characters.length,2);assert.equal(p.characters[0].id,'a');assert.equal(p.characters[0].name,'小甲');assert.ok(p.characters[0].aliases.includes('短发女子'));assert.equal(p.characters[0].firstPage,1);
  assert.equal(p.relations.length,1);assert.equal(p.stages.length,1);assert.equal(p.identityRedirects!.new,'a');
  applyReading(p,reading({characters:[{...person('new','短发女子'),nameType:'descriptive'}]}));assert.equal(p.characters[0].name,'小甲');
});
test('低把握视觉候选及已有重复档案不自动合并；仅提及的名字不生成图节点',()=>{
  const p=project();applyReading(p,reading({characters:[person('a'),person('b')]}));
  applyReading(p,reading({characters:[{...person('c'),sameAs:{id:'a',confidence:.7,evidence:'相似但不确定'}},{...person('nameOnly','旁白提及的人'),presence:'mentioned'}],mentions:[{name:'对白中的第三人',evidence:'仅名字出现在对白'}]}));
  assert.equal(p.characters.length,3);assert.equal(p.identitySuggestions!.length,1);assert.equal(p.mentions!.length,2);
  applyReading(p,reading({characters:[{...person('b'),sameAs:{id:'a',confidence:.99,evidence:'需要人工核对已存在的档案'}}]}));assert.equal(p.characters.length,3);assert.equal(p.identitySuggestions!.length,2);
});
test('失败页不提交候选或跳转映射，封面不污染身份档案',()=>{
  const p=project();applyReading(p,reading({characters:[person('a')]}));const before=JSON.stringify(p);
  assert.throws(()=>applyReading(p,reading({characters:[{...person('new'),sameAs:{id:'a',confidence:.99,evidence:'连续出现'}}],relationChanges:[relation('new','unknown')]})));
  assert.equal(JSON.stringify(p),before);
  applyReading(p,reading({kind:'cover',characters:[person('new')],mentions:[{name:'封面名字',evidence:'封面标题'}]}));assert.equal(p.characters.length,1);assert.equal(p.mentions?.length||0,0);
});
test('合并重写所有图端点、状态目标、阶段基线，去掉自身关系且不把后期真名写入早期',()=>{
  const p=project();applyReading(p,reading({characters:[person('a','无名人物'),person('other')],relationChanges:[relation('a','other')]}));
  const early=structuredClone(p.stages[0]);
  applyReading(p,reading({characters:[person('b','后期真名')],relationChanges:[relation('b','other')],turningPoint:{title:'转折',reason:'测试持久变化',confidence:.99}}));
  p.stages[0]=early;
  p.identityRedirects={old:'a'};mergeCharacters(p,'a','b');
  assert.equal(p.characters.length,2);assert.equal(p.characters.find(c=>c.id==='b')!.firstPage,1);assert.equal(p.relations.length,1);assert.equal(p.relations[0].source,'b');
  assert.equal(p.stages[0].characters.find(c=>c.id==='b')!.name,'无名人物');assert.equal(p.stages[0].relations[0].source,'b');assert.equal(p.identityRedirects.old,'b');
  assert.ok(!JSON.stringify(p.stages.map(s=>s.baselineRelations)).includes('"a"'));
});
test('同页不同临时 ID 指向同一人时合为一份增量，已确认映射不会受特殊键干扰',()=>{
  const p=project();applyReading(p,reading({characters:[person('a')]}));
  const result=resolveIdentities(p,reading({characters:[person('a'),{...person('new','真名'),nameType:'named',sameAs:{id:'a',confidence:.95,evidence:'对应同一张脸'}},person('constructor')]}));
  assert.equal(result.reading.characters.length,2);assert.equal(result.reading.characters[0].name,'真名');assert.equal(result.reading.characters[1].id,'constructor');
});
test('存疑页面先复核，两次一致的正文可继续，分歧或模糊非正文仍待人工确认',()=>{
  const story=reading({confidence:.65}),uncertain=reading({kind:'uncertain',confidence:.4});
  assert.equal(needsPageReview(story),true);assert.equal(reviewAcceptable(story,story),true);
  assert.equal(reviewAcceptable(uncertain,reading()),true);assert.equal(reviewAcceptable(uncertain,uncertain),false);
  assert.equal(reviewAcceptable(story,reading({kind:'cover',confidence:.65})),false);
  assert.equal(needsPageReview(reading({kind:'ad',confidence:.85})),true);
  assert.equal(reviewAcceptable(reading({kind:'ad',confidence:.85}),reading({kind:'ad',confidence:.85})),true);
});
