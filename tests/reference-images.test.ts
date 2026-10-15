import test from 'node:test';
import assert from 'node:assert/strict';
import { readingReferences, readingPortrait } from '../shared/reference-images.js';
import { addReference } from '../server/identity-state.js';
import type { Project, Character } from '../shared/types.js';

test('模型参考仅使用已读来源，未来头像与来源不明头像不能进入请求',()=>{
  const project={processed:2,pages:[{},{},{}]} as Project;
  const person:Character={id:'a',name:'甲',aliases:[],description:'',firstPage:1,avatar:'/future.jpg',references:[{url:'/first.jpg',page:1,view:'front'},{url:'/future.jpg',page:3,view:'manual'},{url:'/bad.jpg',page:0,view:'other'}]};
  const before=JSON.stringify(person);
  assert.deepEqual(readingReferences(project,person).map(r=>r.url),['/first.jpg']);
  assert.equal(readingPortrait(project,person),'/first.jpg');assert.equal(JSON.stringify(person),before);
  assert.equal(readingPortrait(project,{...person,references:[]}),undefined);
  assert.equal(readingPortrait({...project,processed:3},person),'/future.jpg');
});
test('同页重新手工截取头像会更新参考，不继续发送旧裁图',()=>{
  const person:Character={id:'a',name:'甲',aliases:[],description:'',firstPage:1};
  addReference(person,{url:'/old.jpg',page:1,view:'manual'});
  addReference(person,{url:'/new.jpg',page:1,view:'manual'});
  assert.deepEqual(person.references?.map(r=>r.url),['/new.jpg']);
});
