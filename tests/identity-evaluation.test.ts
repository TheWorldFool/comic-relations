import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIdentity, identitySuiteSchema } from '../server/identity-evaluation.js';
import type { Appearance, Project } from '../shared/types.js';

test('评测不依赖姓名，分别计入误拆分、误合并、待定和未命中，空分母不报满分',()=>{
  const region={x:0,y:0,width:.4,height:.4},other={...region,x:.5};
  const suite=identitySuiteSchema.parse({version:1,name:'测试计分器',scope:'identity-probes',annotationStatus:'draft',notes:'人工构造数据，仅验证计分器',pages:[
    {sha256:'1'.repeat(64),label:'1',subjects:[{identity:'a',regions:[region]},{identity:'b',regions:[other]}]},
    {sha256:'2'.repeat(64),label:'2',subjects:[{identity:'a',regions:[region]},{identity:'b',regions:[other]}]},
  ]});
  const occurrence=(page:number,id:string|null,x:number)=>({pageId:`p${page}`,page,characterId:id,observed:{box:{x,y:.1,width:.1,height:.1}},bindings:[]} as unknown as Appearance);
  const project={processed:2,pages:[{id:'p1'},{id:'p2'}],appearances:[occurrence(1,'x',.1),occurrence(1,'x',.6),occurrence(2,'y',.1),occurrence(2,null,.6)]} as Project;
  const before=JSON.stringify(project),r=evaluateIdentity(project,suite,[1,2]);
  assert.equal(r.metrics.expected,4);assert.equal(r.metrics.detected,4);assert.equal(r.metrics.confirmed,3);assert.equal(r.metrics.pending,1);
  assert.equal(r.metrics.splitPairs,1);assert.equal(r.metrics.mergedPairs,1);assert.equal(r.metrics.splitRate,1);assert.equal(r.metrics.mergeRate,.5);
  assert.equal(JSON.stringify(project),before);
  const empty=evaluateIdentity({...project,appearances:[]},suite,[1,2]);
  assert.equal(empty.status,'scored');assert.equal(empty.metrics.coverage,0);assert.equal(empty.metrics.mergeRate,null);assert.equal(empty.metrics.splitRate,null);
  assert.equal(evaluateIdentity({...project,appearances:undefined},suite,[1,2]).status,'missing-appearance-records');
  assert.throws(()=>evaluateIdentity(project,suite,[1,3]));
  assert.throws(()=>identitySuiteSchema.parse({...suite,pages:[suite.pages[0],suite.pages[0]]}));
});
