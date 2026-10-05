import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReviewNotice from '../src/ReviewNotice.js';
import { clearResolvedReviewError } from '../server/analysis.js';
import type { Project } from '../shared/types.js';

function project():Project {
  return {id:'test',name:'漫画',createdAt:'',updatedAt:'',direction:'ltr',processed:1,status:'paused',error:'第 2 页分类存疑。',memory:'已有剧情',characters:[],relations:[],stages:[],pages:[
    {id:'p1',name:'1.jpg',image:'',thumbnail:'',width:100,height:100,override:'auto'},
    {id:'p2',name:'2.jpg',image:'',thumbnail:'',width:100,height:100,override:'auto',analysis:{kind:'uncertain',confidence:.7,reason:'整页插图待确认',summary:'',storyTime:''}}
  ]};
}
const render=(p:Project,busy=false)=>renderToStaticMarkup(createElement(ReviewNotice,{project:p,busy,onView:()=>{},onConfirm:()=>{},onContinue:()=>{}}));
test('未校正时提供一键确认入口，正文/排除校正后均呈现可用继续按钮',()=>{
  const p=project();assert.match(render(p),/确认正文并继续/);assert.match(render(p),/排除此页并继续/);
  for(const override of ['story','skip'] as const){
    p.pages[1].override=override;
    const html=render(p);assert.match(html,/继续分析<\/button>/);assert.doesNotMatch(html,/disabled=""/);assert.match(html,/已完成的 1 页会保留/);
  }
  assert.match(render(p,true),/disabled=""/);
});
test('首张存疑页同样可以继续；运行和完成后不残留恢复操作',()=>{
  const p=project();p.pages.shift();p.processed=0;p.pages[0].override='story';assert.match(render(p),/继续分析/);
  p.status='running';assert.equal(render(p),'');p.status='completed';p.processed=1;assert.equal(render(p),'');
});
test('校正只清除当前分类暂停提示，保持分析进度和内容限制',()=>{
  const p=project();p.pages[1].override='story';assert.equal(clearResolvedReviewError(p),true);assert.equal(p.error,undefined);assert.equal(p.processed,1);assert.equal(p.memory,'已有剧情');assert.equal(p.status,'paused');
  p.pages[1].analysis!.kind='blocked';p.error='内容无法处理';assert.equal(clearResolvedReviewError(p),false);assert.equal(p.error,'内容无法处理');assert.equal(render(p),'');
  p.pages[1].analysis!.kind='uncertain';p.status='error';p.error='接口请求失败';assert.equal(clearResolvedReviewError(p),false);assert.match(render(p),/接口请求失败/);
});
