import test from 'node:test';
import assert from 'node:assert/strict';
import { readingOptions, readingContext } from '../server/reading-request.js';
import type { Project } from '../shared/types.js';

test('截断恢复保持明确 token 上限，关闭受支持模型的思考；自定义模型不注入专用字段',()=>{
  const oldTokens=process.env.DEEPSEEK_MAX_TOKENS,oldEffort=process.env.DEEPSEEK_REASONING_EFFORT;
  try{
    delete process.env.DEEPSEEK_MAX_TOKENS;delete process.env.DEEPSEEK_REASONING_EFFORT;
    assert.deepEqual(readingOptions('deepseek-flash'),{max_tokens:32768,thinking:{type:'enabled'},reasoning_effort:'low'});
    assert.deepEqual(readingOptions('deepseek-flash',true),{max_tokens:32768,thinking:{type:'disabled'}});
    process.env.DEEPSEEK_MAX_TOKENS='4096';process.env.DEEPSEEK_REASONING_EFFORT='high';
    assert.equal(readingOptions('deepseek-flash',true).max_tokens,4096);
    assert.deepEqual(readingOptions('custom-vision',true),{max_tokens:4096});
    process.env.DEEPSEEK_MAX_TOKENS='NaN';assert.throws(()=>readingOptions('deepseek-flash'));
  }finally{
    if(oldTokens===undefined)delete process.env.DEEPSEEK_MAX_TOKENS;else process.env.DEEPSEEK_MAX_TOKENS=oldTokens;
    if(oldEffort===undefined)delete process.env.DEEPSEEK_REASONING_EFFORT;else process.env.DEEPSEEK_REASONING_EFFORT=oldEffort;
  }
});

test('压缩重复历史但保留当前人物、状态、关系、记忆和阶段基线；不修改项目',()=>{
  const fact={key:'health',label:'健康',value:'受伤',certainty:'confirmed' as const,evidence:'对白确认',sincePage:2};
  const person={id:'a',name:'甲',aliases:[],description:'角色',firstPage:1,statuses:[fact],records:Array.from({length:30},(_,i)=>({...fact,section:'status' as const,action:'upsert' as const,sincePage:i+1}))};
  const p:Project={id:'p',name:'测试',createdAt:'',updatedAt:'',direction:'ltr',status:'error',processed:0,pages:[{id:'p1',name:'1.jpg',image:'',thumbnail:'',width:100,height:100,override:'auto'}],memory:'既有剧情',characters:[person],relations:[],stages:[{id:'s1',fromPage:1,toPage:2,title:'当前阶段',storyTime:'',characters:[person],relations:[],changes:[],baselineStatuses:[{id:'a',statuses:[fact]}]}]};
  const before=JSON.stringify(p),context=readingContext(p);
  assert.equal(context.characters[0].records?.length,0);assert.deepEqual(context.characters[0].statuses,[fact]);
  assert.equal(context.currentPhase?.baselineStatuses[0].statuses?.[0].value,'受伤');assert.equal(context.memory,'既有剧情');
  assert.equal(JSON.stringify(p),before);
});
