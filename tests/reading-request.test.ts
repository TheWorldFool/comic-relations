import test from 'node:test';
import assert from 'node:assert/strict';
import { readingOptions, readingContext, referenceCharacters } from '../server/reading-request.js';
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

test('头像优先最近出场角色，保留全部身份及状态索引；隔着附页仍有前文，绝不引用未来页',()=>{
  const fact={key:'identity',label:'身份',value:'调查员',certainty:'confirmed' as const,evidence:'很长的历史证据'.repeat(60),sincePage:1};
  const people=Array.from({length:24},(_,i)=>({id:`c${i}`,name:`角色${i}`,aliases:[`别名${i}`],description:'稳定外貌',appearance:'辨认特征',firstPage:i+1,profile:[fact],avatar:`/avatars/${i}.jpg`}));
  const p:Project={id:'p',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'running',processed:3,pages:[
    {id:'p1',name:'1',image:'',thumbnail:'',width:100,height:100,override:'story',analysis:{kind:'story',confidence:1,reason:'',summary:'已读故事',storyTime:'',characterIds:['old-alias']}},
    ...Array.from({length:2},(_,i)=>({id:`ad${i}`,name:'ad',image:'',thumbnail:'',width:100,height:100,override:'skip' as const,analysis:{kind:'ad' as const,confidence:1,reason:'',summary:'广告',storyTime:''}})),
    {id:'future',name:'future',image:'',thumbnail:'',width:100,height:100,override:'story',analysis:{kind:'story',confidence:1,reason:'',summary:'未来剧透',storyTime:'',characterIds:['c23']}},
  ],memory:'前文',characters:people,relations:[{source:'c0',target:'c23',kind:'team',label:'同伴',directed:false,evidence:fact.evidence,sincePage:1}],stages:[],identityRedirects:{'old-alias':'c0'}};
  // Real projects cannot contain future-created characters, but recency should
  // rank explicit appearances above imported/legacy firstPage values as well.
  p.characters.forEach(c=>c.firstPage=1);
  const before=JSON.stringify(p),context=readingContext(p);
  assert.equal(referenceCharacters(p)[0].id,'c0');assert.equal(referenceCharacters(p).length,8);
  assert.equal(context.characters.length,24);assert.equal(context.characters.find(c=>c.id==='c23')?.profile?.[0].value,'调查员');
  assert.equal(context.relations[0].label,'同伴');assert.equal(context.relations[0].target,'c23');
  assert.deepEqual(context.recentPages.map(page=>page.summary),['已读故事']);
  assert.ok(!JSON.stringify(context).includes('未来剧透'));assert.equal(JSON.stringify(p),before);
  const legacy={...context,characters:people,relations:p.relations};
  assert.ok(JSON.stringify(context).length<JSON.stringify(legacy).length,'只压缩重复证据，保留身份与当前事实');
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
