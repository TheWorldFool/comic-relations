import test from 'node:test';
import assert from 'node:assert/strict';
import { recordReadingRun } from '../server/reading-timing.js';
import { readingTotals } from '../shared/reading-totals.js';
import { resetAnalysis } from '../server/analysis.js';
import type { Project } from '../shared/types.js';

test('迁移旧计时后累计失败、重试与取消，重置或删除页面不会抹掉已发生用量',()=>{
  const p:Project={id:'p',name:'test',createdAt:'',updatedAt:'old',direction:'ltr',status:'idle',processed:0,memory:'',characters:[],relations:[],stages:[],pages:[{id:'page',name:'page',image:'',thumbnail:'',width:1,height:1,override:'story',timing:{elapsedMs:100,attempts:1,promptTokens:10}}]};
  const legacy=structuredClone(p);resetAnalysis(legacy);assert.equal(readingTotals(legacy).attempts,1);assert.equal(legacy.readingRuns?.[0].outcome,'legacy');
  recordReadingRun(p,p.pages[0],{elapsedMs:200,attempts:3,promptTokens:20,model:'test',promptHash:'hash'},'error');
  recordReadingRun(p,p.pages[0],{elapsedMs:50,attempts:1},'cancelled');
  assert.equal(p.readingRuns?.length,3);assert.equal(p.readingRuns?.[1].model,'test');assert.equal(p.readingRuns?.[1].promptHash,'hash');
  assert.deepEqual(readingTotals(p),{elapsedMs:350,attempts:5,promptTokens:30,completionTokens:0});
  resetAnalysis(p);p.pages=[];assert.equal(readingTotals(p).attempts,5);
});
