import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceFile } from '../server/atomic-file.js';

test('Windows 临时文件占用有限退避后原子替换，不删除旧快照',async()=>{
  let calls=0;const waits:number[]=[];
  await replaceFile('project.json.tmp','project.json',{platform:'win32',wait:async ms=>{waits.push(ms);},rename:async(source,target)=>{
    assert.equal(source,'project.json.tmp');assert.equal(target,'project.json');
    if(++calls<3)throw Object.assign(new Error('busy'),{code:'EPERM'});
  }});
  assert.equal(calls,3);assert.deepEqual(waits,[20,40]);
});

test('永久占用达到上限后保留错误，非临时/非 Windows 错误不重试',async()=>{
  for(const [platform,code,expected] of [['win32','EBUSY',6],['win32','ENOSPC',1],['linux','EACCES',1]] as const){
    let calls=0;const error=Object.assign(new Error(code),{code});
    await assert.rejects(replaceFile('temp','target',{platform,wait:async()=>{},rename:async()=>{calls++;throw error;}}),e=>e===error);
    assert.equal(calls,expected);
  }
});
