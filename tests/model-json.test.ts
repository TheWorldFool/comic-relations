import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelJsonError, parseModelJson } from '../server/model-json.js';
import { parseReadingOutput, isModelRefusal } from '../server/reading-output.js';

test('仅修复对象末尾无值的空字段，保留嵌套档案及全部原字段',()=>{
  const expected={kind:'story',confidence:.9,reason:'正文',summary:'甲到达车站',storyTime:'',memory:'甲到达车站',turningPoint:null,characters:[{id:'a',name:'甲',aliases:[],description:'短发',avatarBox:null,profileUpdates:[{action:'upsert',key:'job',label:'职业',value:'调查员',certainty:'confirmed',evidence:'自我介绍'}]}],relationChanges:[]};
  const malformed=JSON.stringify(expected).replace('"evidence":"自我介绍"}', '"evidence":"自我介绍",""}');
  const result=parseModelJson(malformed);
  assert.deepEqual(result.output,expected);assert.equal(result.adjustments.length,1);
  assert.equal(parseReadingOutput(result.output).parsed.success,true);
});

test('字符串内的标点、转义引号及空键的实际值不能被修改',()=>{
  const expected={text:'片段 ,""} 与 \\ 及 "引号"',nested:{'':'实际的值'},list:['','值']};
  assert.deepEqual(parseModelJson(JSON.stringify(expected)),{output:expected,adjustments:[]});
  const malformed=JSON.stringify(expected).slice(0,-1)+', "" }';
  assert.deepEqual(parseModelJson(malformed).output,expected);
});

test('不能推测有名字段的缺值，不能补齐截断、丢字段或截取半段 JSON',()=>{
  for(const content of ['{"summary":}', '{"summary":"车站","memory"}', '{"summary":"车站",', '{"summary":"车站",""}', '{"summary":"车站","", "memory":""}', '说明 {"summary":"车站"}']){
    if(content==='{"summary":"车站",""}'){
      assert.equal(parseReadingOutput(parseModelJson(content).output).parsed.success,false);
    }else assert.throws(()=>parseModelJson(content),ModelJsonError);
  }
});

test('空响应、语法错误及非对象有明确独立的错误和诊断元数据',()=>{
  for(const content of ['', '  ',undefined])assert.throws(()=>parseModelJson(content),e=>e instanceof ModelJsonError&&e.metadata.failure==='empty'&&/未返回正文/.test(e.message));
  for(const content of ['[]','null','"hello"','3'])assert.throws(()=>parseModelJson(content),e=>e instanceof ModelJsonError&&e.metadata.failure==='non_object');
  assert.throws(()=>parseModelJson('{\n"field"}',{finishReason:'stop'}),e=>e instanceof ModelJsonError&&e.metadata.failure==='syntax'&&e.metadata.finishReason==='stop'&&/第 2 行/.test(e.message));
});

test('带代码围栏的 JSON 仍支持，格式修复不会解除 blocked 判定',()=>{
  assert.deepEqual(parseModelJson('```json\n{"ok":true}\n```').output,{ok:true});
  assert.equal(isModelRefusal(parseModelJson('{"status":"blocked","reason":"无法处理",""}').output),true);
});
