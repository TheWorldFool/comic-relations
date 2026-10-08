import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderPages } from '../server/page-order.js';
import { changesReadOrder } from '../shared/page-order.js';
import type { Project } from '../shared/types.js';

test('仅调整未读页保留记忆、人物、阶段与计时；修改已读前缀才重置',()=>{
  const p:Project={id:'test',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'error',error:'原待读页出错',processed:1,memory:'前文',characters:[],relations:[],stages:[],pages:Array.from({length:3},(_,i)=>({id:`p${i}`,name:'page',image:'',thumbnail:'',width:100,height:100,override:'story'})),readingMemory:{version:1,checkpointPage:1,pending:[],threads:[{id:'clue',text:'线索',sincePage:1}]}};
  p.pages[0].timing={elapsedMs:10,attempts:1};const memory=structuredClone(p.readingMemory);
  assert.equal(changesReadOrder(p,['p0','p2','p1']),false);
  reorderPages(p,['p0','p2','p1']);assert.equal(p.processed,1);assert.equal(p.memory,'前文');assert.deepEqual(p.readingMemory,memory);assert.equal(p.pages[0].timing?.elapsedMs,10);assert.equal(p.error,undefined);
  const before=JSON.stringify(p);assert.throws(()=>reorderPages(p,['p0','p2','p2']));assert.equal(JSON.stringify(p),before);
  assert.equal(changesReadOrder(p,['p2','p0','p1']),true);reorderPages(p,['p2','p0','p1']);assert.equal(p.processed,0);assert.equal(p.memory,'');assert.equal(p.readingMemory,undefined);
});
