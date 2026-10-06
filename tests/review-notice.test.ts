import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReviewNotice from '../src/ReviewNotice.js';
import type { Project } from '../shared/types.js';

function project():Project {
  return {id:'test',name:'漫画',createdAt:'',updatedAt:'',direction:'ltr',processed:1,status:'paused',error:'接口请求失败。',memory:'已有剧情',characters:[],relations:[],stages:[],pages:[
    {id:'p1',name:'1.jpg',image:'',thumbnail:'',width:100,height:100,override:'story'},
    {id:'p2',name:'2.jpg',image:'',thumbnail:'',width:100,height:100,override:'story'}
  ]};
}
const render=(p:Project,busy=false)=>renderToStaticMarkup(createElement(ReviewNotice,{project:p,busy,onView:()=>{},onContinue:()=>{}}));
test('暂停或中断时提供继续入口，展示已完成页数',()=>{
  const p=project();
  let html=render(p);
  assert.match(html,/分析已暂停/);assert.match(html,/继续分析/);assert.match(html,/查看第 2 页/);assert.match(html,/已完成的 1 页会保留/);
  assert.doesNotMatch(html,/disabled=""/);
  p.status='error';html=render(p);
  assert.match(html,/分析已中断/);assert.match(html,/接口请求失败。/);
  assert.match(render(p,true),/disabled=""/);
});
test('内容拒绝页排除前不提供继续入口，排除后恢复；运行和完成后不残留操作',()=>{
  const p=project();
  p.pages[1].analysis={kind:'blocked',confidence:1,reason:'无法处理',summary:'',storyTime:''};
  p.error='模型无法按非露骨方式处理本页。';assert.equal(render(p),'');
  p.pages[1].override='skip';assert.match(render(p),/继续分析/);
  p.status='running';assert.equal(render(p),'');
  p.status='completed';p.processed=2;assert.equal(render(p),'');
});
test('首张待处理页同样可以继续',()=>{
  const p=project();p.pages.shift();p.processed=0;assert.match(render(p),/从第 1 页继续/);
});
