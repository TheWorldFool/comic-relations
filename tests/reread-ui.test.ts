import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RereadPanel } from '../src/RereadPanel.js';
import ReviewNotice from '../src/ReviewNotice.js';
import type { Project } from '../shared/types.js';

test('重读面板区分待到达与可核对项，不能把完成标记伪装为自动应用；待校正时隐藏普通恢复入口',()=>{
  const p:Project={id:'test',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'paused',processed:1,memory:'',characters:[],relations:[],stages:[],pages:[1,2].map(n=>({id:`p${n}`,name:String(n),image:'',thumbnail:'',width:100,height:100,override:'story'})),reread:{id:'s',backupHash:'hash',createdAt:'',fromPage:1,previousProcessed:2,items:[{id:'now',page:1,kind:'持续固定',title:'甲 · 健康：受伤',detail:'画面证据',data:{}},{id:'later',page:2,kind:'独立身份',title:'乙',detail:'用户确认',data:{}}]}};
  const props={project:p,locked:false,onAction:async()=>{},onPage:()=>{},onReview:()=>{}};
  const html=renderToStaticMarkup(createElement(RereadPanel,props));
  for(const label of ['下载重读前结果','恢复原结果','2 项保留校正待核对','其中 1 项已到达证据页','不自动修改人物或事实','等待读到此页'])assert.ok(html.includes(label));
  assert.equal(html.match(/>已核对此项</g)?.length,1);assert.match(html,/disabled="">完成重读核对/);
  assert.equal(renderToStaticMarkup(createElement(ReviewNotice,{project:p,busy:false,onView:()=>{},onContinue:()=>{}})),'');
  p.processed=2;p.reread!.items.forEach(i=>i.resolved=true);
  assert.doesNotMatch(renderToStaticMarkup(createElement(RereadPanel,props)),/disabled="">完成重读核对/);
});
