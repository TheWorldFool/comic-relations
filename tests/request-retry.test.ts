import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from '../server/request-retry.js';

test('临时 503 和限流按 Retry-After 有界重试，准确统计实际请求',async()=>{
  let requests=0,counted=0;const waits:number[]=[];
  const result=await fetchWithRetry('https://example.test',{},()=>counted++,{fetch:async()=>new Response('{}',{status:++requests===1?503:requests===2?429:200,headers:{'retry-after':requests===2?'0':'invalid'}}),wait:async ms=>{waits.push(ms);}});
  assert.equal(result.status,200);assert.equal(counted,3);assert.deepEqual(waits,[1000,0]);
});

test('永久错误、内容拒绝响应及过长服务等待不重试；临时错误最多三次',async()=>{
  for(const status of [400,401,402,403,200,503]){
    let calls=0;
    const result=await fetchWithRetry('https://example.test',{},undefined,{fetch:async()=>{calls++;return new Response('{"status":"blocked"}',{status});},wait:async()=>{}});
    assert.equal(result.status,status);assert.equal(calls,status===503?3:1);
  }
  let waited=false;
  const result=await fetchWithRetry('https://example.test',{},undefined,{fetch:async()=>new Response('{}',{status:429,headers:{'retry-after':'60'}}),wait:async()=>{waited=true;}});
  assert.equal(result.status,429);assert.equal(waited,false);
});

test('明确的网络中断可重试，取消退避立即结束且不会再发请求',async()=>{
  let calls=0;
  await fetchWithRetry('https://example.test',{},undefined,{fetch:async()=>{if(++calls===1)throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});return new Response('{}');},wait:async()=>{}});
  assert.equal(calls,2);
  const controller=new AbortController();calls=0;
  await assert.rejects(fetchWithRetry('https://example.test',{signal:controller.signal},undefined,{fetch:async()=>{calls++;return new Response('{}',{status:503});},wait:async(_ms,signal)=>{controller.abort();signal.throwIfAborted();}}),/abort/i);
  assert.equal(calls,1);
});
