import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeProject } from '../src/project-sync.js';
import type { Project } from '../shared/types.js';

test('错误或暂停状态也更新，恢复连接后清除同步错误，关闭后不再更新',async()=>{
  const target=new EventTarget();let calls=0;const states:string[]=[];const errors:string[]=[];
  const stop=subscribeProject({target,intervalMs:60000,load:async()=>{calls++;if(calls===1)throw new Error('暂时断线');return {status:calls===2?'paused':'running'} as Project;},onProject:p=>states.push(p.status),onError:e=>errors.push(e)});
  await new Promise(r=>setImmediate(r));assert.equal(errors[0],'暂时断线');
  target.dispatchEvent(new Event('focus'));await new Promise(r=>setImmediate(r));assert.deepEqual(states,['paused']);assert.equal(errors.at(-1),'');
  target.dispatchEvent(new Event('focus'));await new Promise(r=>setImmediate(r));assert.deepEqual(states,['paused','running']);
  stop();target.dispatchEvent(new Event('focus'));await new Promise(r=>setImmediate(r));assert.equal(calls,3);
});
