import test from 'node:test';
import assert from 'node:assert/strict';
import { correctProject } from '../server/corrections.js';
import { applyReading, type Reading } from '../server/analysis.js';
import { mergeCharacters } from '../server/identity.js';
import type { Project } from '../shared/types.js';
import { readingContext } from '../server/reading-request.js';

test('人工姓名、状态、关系校正持久生效，模型不能改维度相同的固定项；解锁后允许剧情更新',()=>{
  const health={key:'health',label:'健康',value:'受伤',certainty:'confirmed' as const,evidence:'画面',sincePage:1};
  const people=[{id:'a',name:'临时名',aliases:[],description:'短发',firstPage:1,statuses:[health]},{id:'b',name:'乙',aliases:[],description:'长发',firstPage:1}];
  const relation={source:'a',target:'b',kind:'team',label:'同伴',directed:false,evidence:'对白',sincePage:1};
  const p:Project={id:'p',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'paused',processed:1,memory:'前文',characters:people,relations:[relation],stages:[],pages:Array.from({length:4},(_,i)=>({id:`p${i}`,name:'page',image:'',thumbnail:'',width:1,height:1,override:'story'}))};
  correctProject(p,{kind:'character',personId:'a',name:'甲',aliases:['临时名'],description:'短发',appearance:'短发',nameType:'named'});
  correctProject(p,{kind:'fact',personId:'a',section:'status',action:'upsert',fact:{...health,value:'生死不明',certainty:'uncertain',evidence:'伤势尚不明确'}});
  correctProject(p,{kind:'relation',action:'remove',relation});
  assert.equal(p.characters[0].statuses?.[0].value,'生死不明');assert.equal(p.characters[0].statuses?.[0].certainty,'uncertain');assert.equal(p.relations.length,0);
  const model:Reading={kind:'story',confidence:1,reason:'正文',summary:'新事件',memory:'新增',memoryMode:'delta',threadChanges:[],storyTime:'',turningPoint:null,characters:[{id:'a',name:'错误姓名',aliases:[],description:'错误外貌',avatarBox:null,statusChanges:[{...health,action:'upsert',value:'死亡',target:null}]}],relationChanges:[{...relation,action:'upsert'}]};
  applyReading(p,model);assert.equal(p.characters[0].name,'甲');assert.equal(p.characters[0].statuses?.[0].value,'生死不明');assert.equal(p.relations.length,0);
  assert.equal(readingContext(p).manualCorrections.length,3);
  p.corrections=[];applyReading(p,model);assert.equal(p.characters[0].statuses?.[0].value,'死亡');assert.equal(p.relations.length,1);
});

test('未知目标和未来证据页拒绝；有固定项的来源人物不能被静默合并',()=>{
  const p:Project={id:'p',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'paused',processed:1,memory:'',pages:[],characters:[{id:'a',name:'甲',aliases:[],description:'',firstPage:1},{id:'b',name:'乙',aliases:[],description:'',firstPage:1}],relations:[],stages:[]};
  const before=JSON.stringify(p);
  assert.throws(()=>correctProject(p,{kind:'character',personId:'none',name:'人',aliases:[],description:'',appearance:'',nameType:'named'}));assert.equal(JSON.stringify(p),before);
  assert.throws(()=>correctProject(p,{kind:'fact',personId:'a',section:'status',action:'upsert',fact:{key:'health',label:'健康',value:'受伤',certainty:'confirmed',evidence:'未来页',sincePage:2}}),/证据页/);assert.equal(JSON.stringify(p),before);
  correctProject(p,{kind:'character',personId:'a',name:'甲',aliases:[],description:'',appearance:'',nameType:'named'});
  const fixed=JSON.stringify(p);assert.throws(()=>mergeCharacters(p,'a','b'),/解除/);assert.equal(JSON.stringify(p),fixed);
});
