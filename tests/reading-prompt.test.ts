import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { readingProtocol } from '../server/reading-prompt.js';

test('汇总和增量任务的示例、Schema 与校验一致，不再提供相反模式的模板',()=>{
  for(const mode of ['delta','checkpoint'] as const){
    const protocol=readingProtocol(mode);
    const exampleText=protocol.system.split('本次输出格式示例（占位文字不可作为剧情事实）：\n')[1].split('\n')[0];
    const example=JSON.parse(exampleText);
    assert.equal(example.memoryMode,mode);
    assert.equal(protocol.schema.safeParse(example).success,true);
    assert.match(protocol.task,new RegExp(`memoryMode 必须为 "${mode}"`));
    assert.ok(!protocol.system.includes(`"memoryMode":"${mode==='delta'?'checkpoint':'delta'}"`));
    const schema=z.toJSONSchema(protocol.schema);
    const modeSchema=schema.properties?.memoryMode;
    assert.ok(modeSchema&&typeof modeSchema==='object');
    assert.equal(modeSchema.const,mode);
    assert.ok(schema.required?.includes('memoryMode'));
    assert.ok(schema.required?.includes('threadChanges'));
    const mismatch=protocol.schema.safeParse({...example,memoryMode:mode==='delta'?'checkpoint':'delta'});
    assert.equal(mismatch.success,false,'不把短增量改标签后冒充完整汇总');
    if(!mismatch.success)assert.deepEqual(mismatch.error.issues[0].path,['memoryMode']);
  }
});

test('汇总指令要求旧摘要、全部待汇总事件和本页事件，保留未解线索及原有拒绝边界',()=>{
  const {task,system}=readingProtocol('checkpoint');
  for(const text of ['前文 memory','全部 memoryState.pending','本页事件','完整累计摘要','未解线索不因汇总消失'])assert.ok(task.includes(text));
  assert.match(system,/blocked/);
  assert.match(system,/不能因本页未提及而删除线索/);
  assert.match(system,/只使用已读信息/);
});
