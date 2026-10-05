import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CARD_HEIGHT, CARD_WIDTH, groupRelations, layoutGraph } from '../src/graph-layout.js';
import RelationshipExplorer from '../src/RelationshipExplorer.js';
import type { Character, Relation, Stage } from '../shared/types.js';

const characters:Character[]=Array.from({length:12},(_,i)=>({id:`c${i}`,name:`人物${i}`,firstPage:i+1,description:'人物简介',aliases:[]}));
const relation=(source:number,target:number,extra:Partial<Relation>={}):Relation=>({source:`c${source}`,target:`c${target}`,label:'同伴',kind:'companion',directed:false,evidence:'共同完成调查',sincePage:3,...extra});
const overlaps=(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number})=>a.x<b.x+b.w-.1&&a.x+a.w>b.x+.1&&a.y<b.y+b.h-.1&&a.y+a.h>b.y+.1;

test('双向、多重关系合用路线，但保留每条关系的方向、页码和证据',()=>{
  const records=[relation(0,1),relation(1,0,{label:'信任',directed:true,sincePage:8}),relation(0,1,{label:'协助',directed:true,sincePage:9})];
  const original=JSON.stringify(records);
  const groups=groupRelations(records);
  assert.equal(groups.length,1);assert.deepEqual(groups[0].relations,records);
  layoutGraph(characters,groups);
  assert.equal(JSON.stringify(records),original);
});

test('分支、环路和孤立人物有确定位置，人物卡片和关系标签互不遮挡',()=>{
  const groups=groupRelations([relation(0,1),relation(0,2),relation(0,3),relation(1,4),relation(2,4),relation(3,5),relation(5,0),relation(6,7),relation(7,8)]);
  const layout=layoutGraph(characters,groups);
  assert.deepEqual(layout,layoutGraph(characters,groups));
  assert.equal(layout.positions.size,12);assert.equal(layout.routes.size,groups.length);
  const boxes=[...layout.positions.values()].map(p=>({...p,w:CARD_WIDTH,h:CARD_HEIGHT}));
  for(const route of layout.routes.values()){
    assert.ok(route.points.length>=2);
    assert.ok(route.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    boxes.push({x:route.label.x-68,y:route.label.y-16,w:136,h:32});
  }
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.equal(overlaps(boxes[i],boxes[j]),false,`布局元素 ${i} 与 ${j} 不应重叠`);
});

test('空图、单个人物、自身关系和失效引用不会产生虚构人物或非法坐标',()=>{
  assert.equal(layoutGraph([],[]).positions.size,0);
  const groups=groupRelations([relation(0,0),relation(0,99)]);
  const layout=layoutGraph(characters.slice(0,1),groups);
  assert.equal(layout.positions.size,1);assert.equal(layout.routes.size,1);
  assert.ok([...layout.routes.values()].every(r=>Number.isFinite(r.label.x)&&Number.isFinite(r.label.y)));
});

test('关系详情明确呈现人物双方、方向、完整证据和来源；阶段可按标题及范围查找',()=>{
  const stage:Stage={id:'s1',fromPage:2,toPage:9,title:'开始合作',storyTime:'次日',characters:characters.slice(0,2),relations:[relation(0,1,{label:'信任',directed:true,sincePage:8})],changes:[]};
  const html=renderToStaticMarkup(createElement(RelationshipExplorer,{stage,stages:[stage],selectedPerson:null,following:true,onSelectPerson:()=>{},onClearPerson:()=>{},onStage:()=>{},onPage:()=>{},onCrop:()=>{},canCrop:true}));
  for(const text of ['开始合作','第 2–9 页','次日','人物0','人物1','信任','共同完成调查','P.8','关系证据','阶段说明','整理布局'])assert.ok(html.includes(text),`缺少 ${text}`);
  assert.match(html,/aria-label="指向"/);
  assert.match(html,/aria-current="step"/);
});
