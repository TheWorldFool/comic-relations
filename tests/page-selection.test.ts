import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPages } from '../server/page-selection.js';
import { pagesClassified } from '../shared/page-selection.js';
import type { Project } from '../shared/types.js';
const project=():Project=>({id:'p',name:'测试',direction:'ltr',createdAt:'',updatedAt:'',status:'idle',processed:0,pages:[{id:'p1',name:'1.jpg',image:'',thumbnail:'',width:100,height:100,override:'auto'},{id:'p2',name:'2.jpg',image:'',thumbnail:'',width:100,height:100,override:'auto'}],characters:[],relations:[],stages:[],memory:''});
test('完整用户划分才可开始，残缺和过期列表不修改项目',()=>{
  const p=project(),before=JSON.stringify(p);assert.equal(pagesClassified(p.pages),false);
  assert.throws(()=>classifyPages(p,[{id:'p1',purpose:'cover'}]));assert.equal(JSON.stringify(p),before);
  assert.throws(()=>classifyPages(p,[{id:'p2',purpose:'cover'},{id:'p1',purpose:'story'}]));
  classifyPages(p,[{id:'p1',purpose:'cover'},{id:'p2',purpose:'story'}]);assert.equal(pagesClassified(p.pages),true);assert.equal(p.pages[0].override,'skip');assert.equal(p.pages[1].override,'story');
  p.pages.push({...p.pages[1],id:'p3',purpose:undefined,override:'auto'});assert.equal(pagesClassified(p.pages),false);
});
test('确认既有划分保留进度，改变已读用途必须明确选择重置',()=>{
  const p=project();p.processed=1;p.memory='原记忆';p.pages[0].analysis={kind:'story',confidence:.95,reason:'正文',summary:'剧情',storyTime:''};
  classifyPages(p,[{id:'p1',purpose:'story'},{id:'p2',purpose:'extra'}]);assert.equal(p.processed,1);assert.equal(p.memory,'原记忆');
  assert.throws(()=>classifyPages(p,[{id:'p1',purpose:'cover'},{id:'p2',purpose:'story'}]),/清除旧分析/);
  classifyPages(p,[{id:'p1',purpose:'cover'},{id:'p2',purpose:'story'}],true);assert.equal(p.processed,0);assert.equal(p.memory,'');assert.equal(p.pages[0].purpose,'cover');
});
