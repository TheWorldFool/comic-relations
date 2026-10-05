import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchResearch, cleanSourceUrl, resolveSearchResearch } from '../server/background-research.js';
const result=(url='https://example.com/work')=>({stop_reason:'end_turn',content:[{type:'server_tool_use',name:'web_search'},{type:'web_search_tool_result',content:[{type:'web_search_result',title:'作品资料',url:'https://example.com/work'}]},{type:'text',text:JSON.stringify({originalWork:'原作',confidence:.9,background:'背景资料',characterGuide:'角色对照',sourceUrls:[url]})}]});
test('只采用实际搜索返回的来源；没有搜索或伪造网址不能伪装成检索结果',()=>{
  const parsed=parseSearchResearch(result());assert.equal(parsed.sources[0].title,'作品资料');
  assert.throws(()=>parseSearchResearch(result('https://invented.example/')),/来源/);
  assert.throws(()=>parseSearchResearch({...result(),content:result().content.slice(1)}),/没有执行联网搜索/);
  assert.throws(()=>parseSearchResearch({...result(),stop_reason:'max_tokens'}),/截断/);
});
test('来源链接过滤脚本和带凭据的地址，规范化锚点',()=>{
  assert.equal(cleanSourceUrl('javascript:alert(1)'),null);assert.equal(cleanSourceUrl('https://name:password@example.com'),null);
  assert.equal(cleanSourceUrl('https://example.com/work#characters'),'https://example.com/work');
});

test('跟踪参数、锚点、参数排列和编码差异不会误拒，保存实际搜索网址',()=>{
  const data=result('https://example.com/%77ork?lang=zh&id=42#people');
  const actual='https://example.com/work?utm_source=search&id=42&lang=zh&fbclid=tracking';
  (data.content[1].content![0]).url=actual;
  assert.equal(parseSearchResearch(data).sources[0].url,actual);
});

test('有意义的参数、主机、路径及协议不同仍不匹配，混入无效引用不能悄悄丢弃',()=>{
  for(const url of ['https://example.com/work?id=42','https://example.com/other','https://www.example.com/work','http://example.com/work','https://example.com/work/','javascript:alert(1)']){
    assert.throws(()=>parseSearchResearch(result(url)),/来源/);
  }
  const data=result();const payload=JSON.parse(data.content[2].text!);
  payload.sourceUrls.push('javascript:alert(1)');data.content[2].text=JSON.stringify(payload);
  assert.throws(()=>parseSearchResearch(data),/来源/);
});

test('重复引用不改变正文的来源编号',()=>{
  const data=result();const payload=JSON.parse(data.content[2].text!);
  payload.sourceUrls.push(payload.sourceUrls[0]);data.content[2].text=JSON.stringify(payload);
  assert.equal(parseSearchResearch(data).sources.length,2);
});

const repairResult=(ids:string[])=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({originalWork:'原作',confidence:.9,background:'重新核对的背景 [1]',characterGuide:'重新核对的角色 [1]',sourceIds:ids})}]});
test('引用不匹配只自动校正一次，以实际来源 ID 还原网址和标题',async()=>{
  let calls=0;
  const parsed=await resolveSearchResearch(result('https://invented.example/'),async sources=>{
    calls++;assert.deepEqual(sources,[{id:'S1',title:'作品资料',url:'https://example.com/work'}]);
    return repairResult(['S1']);
  });
  assert.equal(calls,1);assert.equal(parsed.background,'重新核对的背景 [1]');assert.equal(parsed.sources[0].url,'https://example.com/work');
  await resolveSearchResearch(result(),async()=>{throw new Error('有效引用不应重试');});
});

test('校正仍含虚构编号或无来源时终止；拒绝和截断不会触发引用校正',async()=>{
  for(const ids of [['S99'],['S1','S99'],[]]){
    let calls=0;
    await assert.rejects(resolveSearchResearch(result('https://invented.example/'),async()=>{calls++;return repairResult(ids);}),/来源/);
    assert.equal(calls,1);
  }
  for(const stop_reason of ['refusal','max_tokens']){
    let calls=0;
    await assert.rejects(resolveSearchResearch({...result(),stop_reason},async()=>{calls++;return repairResult(['S1']);}));
    assert.equal(calls,0);
    await assert.rejects(resolveSearchResearch(result('https://invented.example/'),async()=>({...repairResult(['S1']),stop_reason})));
  }
});
