import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import type { Project } from '../shared/types.js';

test('真实 HTTP：导入排序、视觉请求、过滤、阶段去重、头像、断点恢复和重排失效', {timeout:60000}, async t => {
  let calls=0, failOnce=true;
  let searchMode: 'valid'|'repair'|'badRepair'='valid',searchCalls=0;
  let mode: 'normal' | 'uncertain' | 'slow' | 'repair' | 'invalid' | 'badJson' | 'emptyProperty' | 'emptyAlways' | 'syntaxAlways' | 'refused' | 'textRefused' | 'filterRefused' | 'truncated' | 'truncatedAlways' | 'truncatedRefusal' | 'review' = 'normal';
  const mock=createServer(async (req,res)=>{
    let body='';for await (const chunk of req)body+=chunk;
    const data=JSON.parse(body);
    if(req.url?.includes('/anthropic/')){
      assert.equal(data.tools[0].name,'web_search');assert.equal(data.tools[0].max_uses,3);
      searchCalls++;
      const fields={originalWork:'测试原作',confidence:.95,background:'检索得到的背景',characterGuide:'小甲：短发；来源 1'};
      if(data.messages.length>1){
        assert.deepEqual(data.tool_choice,{type:'none'});
        const previous=data.messages.at(-2).content;
        assert.equal(previous[1].content[0].encrypted_content,'test-encrypted-content');
        const correction=JSON.parse(data.messages.at(-1).content);
        assert.deepEqual(correction.sources,[{id:'S1',title:'作品资料',url:'https://example.com/work'}]);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({...fields,sourceIds:[searchMode==='badRepair'?'S999':'S1']})}]}));return;
      }
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({stop_reason:'end_turn',content:[{type:'server_tool_use',name:'web_search'},{type:'web_search_tool_result',content:[{type:'web_search_result',title:'作品资料',url:'https://example.com/work',encrypted_content:'test-encrypted-content'}]},{type:'text',text:JSON.stringify({...fields,sourceUrls:[searchMode==='valid'?'https://example.com/work':'https://invented.example/work']})}]}));return;
    }
    if(data.messages[0]?.content?.includes?.('你负责识别漫画对应的原作')){
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({originalWork:'测试原作',confidence:.95,evidence:['封面标题'],visibleNames:['小甲']})},finish_reason:'stop'}]}));return;
    }
    const blocks=data.messages.find((m:any)=>m.role==='user'&&Array.isArray(m.content)).content;
    assert.ok(blocks.some((b:any)=>b.type==='image_url'&&b.image_url.url.startsWith('data:image/jpeg;base64,')));
    assert.equal(data.response_format.type,'json_object');
    const context=JSON.parse(blocks[0].text.split('前文上下文：')[1]);const n=context.page;calls++;
    if(['refused','textRefused','filterRefused'].includes(mode)){
      const content=mode==='textRefused'?'抱歉，无法处理此请求。':JSON.stringify({status:'blocked',reason:'无法安全处理'});
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content},finish_reason:mode==='filterRefused'?'content_filter':'stop'}]}));return;
    }
    if(mode==='review'){
      const reviewing=blocks.some((b:any)=>b.type==='text'&&b.text.includes('这是一次页面分类复核'));
      if(reviewing&&n>1)assert.ok(blocks.some((b:any)=>b.type==='text'&&b.text.includes('已读正文参考')));
      const output={kind:reviewing?'story':'uncertain',confidence:reviewing?.95:.5,reason:'分类复核测试',summary:'本页事实',storyTime:'',memory:'累计事实',turningPoint:null,characters:[],relationChanges:[]};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}));return;
    }
    if(['truncated','truncatedAlways','truncatedRefusal'].includes(mode)){
      const recovering=data.messages.some((m:any)=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('上一轮因输出长度限制'));
      const valid={kind:'story',confidence:.95,reason:'正文',summary:'完整页面',storyTime:'',memory:'完整新记忆',turningPoint:null,characters:[],relationChanges:[]};
      if(recovering){assert.deepEqual(data.thinking,{type:'disabled'});assert.ok(!data.messages.some((m:any)=>m.role==='assistant'));}
      else{assert.equal(data.reasoning_effort,'low');}
      const truncated=!recovering||mode==='truncatedAlways'||mode==='truncatedRefusal';
      const content=mode==='truncatedRefusal'?JSON.stringify({status:'blocked',reason:'无法处理'}):truncated?'partial-json-secret':JSON.stringify(valid);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content},finish_reason:truncated?'length':'stop'}],usage:{prompt_tokens:1500,completion_tokens:32768,completion_tokens_details:{reasoning_tokens:32760}}}));return;
    }
    if(['emptyProperty','emptyAlways','syntaxAlways'].includes(mode)){
      const valid={kind:'story',confidence:.95,reason:'正文',summary:'甲到达车站',storyTime:'',memory:'甲到达车站',turningPoint:null,characters:[],relationChanges:[]};
      const content=mode==='emptyAlways'?'':mode==='syntaxAlways'?'{"summary":}':JSON.stringify(valid).slice(0,-1)+',""}';
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));return;
    }
    if(['repair','invalid','badJson'].includes(mode)){
      const corrected=data.messages.some((m:any)=>m.role==='assistant');
      let content=JSON.stringify({kind:'story',confidence:.95,reason:'正文',summary:'剧情',storyTime:null,turningPoint:null,...(corrected&&mode!=='invalid'?{memory:'完整剧情记忆'}:{}),characters:[],relationChanges:[]});
      if(mode==='badJson'&&!corrected)content='not JSON';
      if(corrected){assert.match(data.messages.at(-1).content,/未通过校验/);assert.ok(data.messages[0].content.includes('JSON Schema'));}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));return;
    }
    if(mode==='normal'&&n>=3){assert.equal(context.characters[0].statuses[0].target,'b');assert.equal(context.currentPhase.baselineStatuses[0].statuses[0].target,'b');}
    if(mode==='slow'){await new Promise(r=>setTimeout(r,1000));}
    if(n===4&&failOnce){failOnce=false;res.writeHead(503);res.end('{}');return;}
    const people=[{id:'a',name:'小甲',aliases:[],description:'短发',profileUpdates:[{action:'upsert',key:'occupation',label:'职业',value:'调查员',certainty:'confirmed',evidence:'自我介绍'}],statusChanges:[{action:'upsert',key:'trust',label:'信任',value:'信任对方',certainty:'confirmed',evidence:'将任务交给对方',target:'b'}],avatarBox:{x:.1,y:.1,width:.3,height:.3}},{id:'b',name:'小乙',aliases:[],description:'长发',avatarBox:null}];
    const reading={kind:mode==='uncertain'?'uncertain':n===1?'cover':n===3?'ad':'story',confidence:mode==='uncertain'?.4:.96,reason:'测试分类',summary:'测试剧情',storyTime:'',memory:'已知人物相遇',turningPoint:mode==='normal'&&n===5?{title:'同盟破裂',reason:'正式结束合作并转为对立',confidence:.95}:null,characters:mode==='normal'&&n===2?people:mode==='normal'&&n===4?[{...people[0],id:'named-a',name:'阿甲',nameType:'named',sameAs:{id:'a',confidence:.96,evidence:'相同脸部与场景延续'}}]:[],relationChanges:mode==='normal'&&(n===2||n===5)?[{action:'upsert',source:'a',target:'b',kind:'affiliation',label:n===5?'敌对':'同伴',directed:false,evidence:'漫画对白确认'}]:[]};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(reading)},finish_reason:'stop'}]}));
  });
  await new Promise<void>(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const mockPort=(mock.address() as {port:number}).port;
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'comic-test-'));
  const portProbe=createServer();await new Promise<void>(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const port=(portProbe.address() as {port:number}).port;await new Promise<void>(resolve=>portProbe.close(()=>resolve()));
  const server=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DATA_DIR:dataDir,PORT:String(port),DEEPSEEK_API_KEY:'test-only-key',DEEPSEEK_BASE_URL:`http://127.0.0.1:${mockPort}`,DEEPSEEK_MODEL:'deepseek-flash',DEEPSEEK_REASONING_EFFORT:'low',DEEPSEEK_MAX_TOKENS:'32768'},stdio:'pipe'});
  t.after(()=>{server.kill();mock.close();});
  let serverLog='';server.stderr.on('data',b=>{serverLog+=b;});
  const base=`http://127.0.0.1:${port}/api`;
  for(let i=0;i<100;i++){try{if((await fetch(`${base}/settings`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const call=async (url:string,method='GET',body?:unknown)=>{const res=await fetch(base+url,{method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});assert.equal(res.ok,true,await res.clone().text()+serverLog);return res.json();};
  const created=await call('/projects','POST',{name:'测试漫画'});const root=`/projects/${created.id}`;
  const bytes=await sharp({create:{width:320,height:480,channels:3,background:'#fafafa'}}).png().toBuffer();
  const form=new FormData();for(const n of [10,2,1,4,3])form.append('files',new Blob([new Uint8Array(bytes)],{type:'image/png'}),`漫画第${n}页.png`);
  let p:Project=await call(root+'/pages','POST',form);
  assert.deepEqual(p.pages.map(p=>p.name),['漫画第1页.png','漫画第2页.png','漫画第3页.png','漫画第4页.png','漫画第10页.png']);
  const unclassifiedRead=await fetch(base+root+'/read',{method:'POST'});assert.equal(unclassifiedRead.status,400);assert.equal(calls,0);
  const unclassifiedSearch=await fetch(base+root+'/background/research',{method:'POST'});assert.equal(unclassifiedSearch.status,400);
  p=await call(root+'/page-selection','PUT',{pages:p.pages.map((page,i)=>({id:page.id,purpose:i===0?'cover':i===2?'ad':'story'}))});
  assert.equal(p.pages[0].override,'skip');assert.equal(p.pages[1].override,'story');
  p=await call(root+'/background/research','POST');assert.equal(p.backgroundResearch!.status,'ready');assert.equal(p.workContext,undefined);assert.equal(p.processed,0);assert.equal(p.characters.length,0);
  p=await call(root+'/background/apply','POST',{researchId:p.backgroundResearch!.id});assert.equal(p.workContext!.sources![0].url,'https://example.com/work');assert.equal(p.backgroundResearch!.accepted,true);
  searchMode='repair';const beforeSearch=searchCalls;
  p=await call(root+'/background/research','POST');assert.equal(searchCalls-beforeSearch,2);
  assert.equal(p.backgroundResearch!.sources[0].url,'https://example.com/work');
  const sourcesDiagnostic=path.join(dataDir,'projects',p.id,'diagnostics','background-sources.json');
  assert.equal(JSON.parse(await readFile(sourcesDiagnostic,'utf8')).resolved,true);
  const beforeSearchFailure=structuredClone(p);searchMode='badRepair';const beforeBadSearch=searchCalls;
  const badSearch=await fetch(base+root+'/background/research',{method:'POST'});
  assert.equal(badSearch.status,400);assert.match(await badSearch.text(),/来源/);assert.equal(searchCalls-beforeBadSearch,2);
  p=await call(root);assert.deepEqual(p,beforeSearchFailure);
  const failureMetadata=await readFile(sourcesDiagnostic,'utf8');assert.equal(JSON.parse(failureMetadata).resolved,false);
  assert.ok(!failureMetadata.includes('test-only-key'));assert.ok(!failureMetadata.includes('检索得到的背景'));
  searchMode='valid';
  const poll=async()=>{let result:Project;for(let i=0;i<100;i++){result=await call(root);if(result.status!=='running')return result;await new Promise(r=>setTimeout(r,50));}throw new Error('job timeout');};
  const workContext={originalWork:'测试原作',background:'仅用于身份对照',characterGuide:'阿甲又称小甲'};await call(root,'PATCH',{workContext});
  await call(root+'/read','POST');p=await poll();assert.equal(p.status,'error');assert.equal(p.processed,3);assert.equal(p.stages.length,1);assert.equal(p.stages[0].fromPage,2);assert.equal(p.stages[0].toPage,3);
  assert.equal(p.characters[0].profile![0].value,'调查员');assert.equal(p.characters[0].statuses![0].target,'b');assert.ok(p.characters[0].avatar);assert.equal((await fetch(`http://127.0.0.1:${port}${p.characters[0].avatar}`)).status,200);
  await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed');assert.equal(p.processed,5);assert.equal(calls,4);assert.equal(p.stages.length,2);assert.equal(p.stages[0].toPage,4);assert.equal(p.stages[1].fromPage,5);assert.equal(p.pages[2].analysis?.kind,'ad');
  assert.equal(p.characters.length,2);assert.equal(p.characters[0].name,'阿甲');assert.equal(p.identityRedirects!['named-a'],'a');
  const exported:Project=await call(root+'/export');assert.equal(exported.stages[1].relations[0].label,'敌对');
  const disk:Project=JSON.parse(await readFile(path.join(dataDir,'projects',p.id,'project.json'),'utf8'));assert.equal(disk.processed,5);assert.equal(disk.stages[0].characters[0].statuses![0].target,'b');assert.equal(exported.characters[0].records!.length,2);
  const beforeMerge=structuredClone(p);
  p=await call(root+'/characters/merge','POST',{source:'b',target:'a'});assert.equal(p.characters.length,1);assert.equal(p.relations.length,0);assert.equal(p.canUndoMerge,true);
  p=await call(root+'/characters/merge/undo','POST');assert.deepEqual(p.characters,beforeMerge.characters);assert.deepEqual(p.stages,beforeMerge.stages);assert.deepEqual(p.relations,beforeMerge.relations);
  p=await call(root+'/characters/merge','POST',{source:'b',target:'a'});p=await call(root,'PATCH',{workContext:{...workContext,background:'新的说明'}});
  const staleUndo=await fetch(base+root+'/characters/merge/undo',{method:'POST'});assert.equal(staleUndo.status,400);
  p=await call(root+'/order','PUT',{ids:p.pages.map(pg=>pg.id).reverse()});assert.equal(p.processed,0);assert.equal(p.stages.length,0);assert.equal(p.characters.length,0);
  const invalid=await fetch(base+root+'/order',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[p.pages[0].id,p.pages[0].id]})});assert.equal(invalid.status,400);
  const privateConfig=await fetch(`http://127.0.0.1:${port}/media/${p.id}/../settings.json`);assert.notEqual(privateConfig.status,200);
  const config=await call('/settings');assert.equal(config.hasKey,true);assert.equal(config.apiKey,undefined);
  mode='uncertain';await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed');assert.equal(p.processed,5);assert.equal(p.pages[0].analysis?.kind,'story','用户指定正文不会再次因分类存疑暂停');
  p=await call(root+'/reset','POST');p=await call(root+'/page-selection','PUT',{pages:p.pages.map((page,i)=>({id:page.id,purpose:i<2?'extra':'story'}))});
  mode='slow';await call(root+'/read','POST');
  for(let i=0;i<50;i++){p=await call(root);if(p.processed===2)break;await new Promise(r=>setTimeout(r,10));}
  const concurrent=await fetch(base+root+'/order',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:p.pages.map(pg=>pg.id)})});assert.equal(concurrent.status,400);
  await call(root+'/pause','POST');p=await poll();assert.equal(p.status,'paused');assert.equal(p.processed,2);
  mode='invalid';const beforeFailure=calls;await call(root+'/read','POST');p=await poll();assert.equal(p.status,'error');assert.equal(p.processed,2);assert.equal(calls-beforeFailure,2,'格式失败只自动纠错一次');assert.match(p.error||'',/memory/);
  const diagnosticPath=path.join(dataDir,'projects',p.id,'diagnostics',`${p.pages[2].id}.json`);
  const failedDiagnostic=JSON.parse(await readFile(diagnosticPath,'utf8'));assert.equal(failedDiagnostic.resolved,false);assert.equal(failedDiagnostic.attempts.length,2);
  mode='repair';await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed');assert.equal(p.processed,5);
  const diagnostic=JSON.parse(await readFile(diagnosticPath,'utf8'));assert.equal(diagnostic.resolved,true);assert.equal(diagnostic.attempts.length,2);
  p=await call(root+'/reset','POST');mode='badJson';await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed');assert.equal(p.processed,5);
  p=await call(root+'/reset','POST');mode='emptyProperty';const beforeLocalRepair=calls;
  await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed');
  assert.equal(calls-beforeLocalRepair,p.pages.filter(page=>page.override!=='skip').length,'明确的空字段格式修复无需再请求模型');
  const localRepairDiagnostic=JSON.parse(await readFile(diagnosticPath,'utf8'));assert.equal(localRepairDiagnostic.resolved,true);
  assert.ok(localRepairDiagnostic.attempts[0].adjustments.some((a:string)=>a.includes('空字段')));
  for(const failureMode of ['emptyAlways','syntaxAlways'] as const){
    p=await call(root+'/reset','POST');mode=failureMode;const beforeSyntaxFailure:number=calls;
    await call(root+'/read','POST');p=await poll();assert.equal(p.status,'error');assert.equal(p.processed,p.pages.findIndex(page=>page.override!=='skip'));
    assert.equal(calls-beforeSyntaxFailure,2);assert.equal(p.characters.length,0);assert.equal(p.stages.length,0);
    assert.match(p.error||'',failureMode==='emptyAlways'?/未返回正文/:/语法错误/);
    const failure=JSON.parse(await readFile(path.join(dataDir,'projects',p.id,'diagnostics',`${p.pages[p.processed].id}.json`),'utf8'));
    assert.equal(failure.attempts[1].failure,failureMode==='emptyAlways'?'empty':'syntax');assert.equal(failure.attempts[1].finishReason,'stop');
  }

  p=await call(root+'/reset','POST');p=await call(root+'/page-selection','PUT',{pages:p.pages.map(page=>({id:page.id,purpose:'story'}))});
  for(const refusalMode of ['refused','textRefused','filterRefused'] as const){
    p=await call(root+'/reset','POST');mode=refusalMode;const before:number=calls;
    await call(root+'/read','POST');p=await poll();assert.equal(p.status,'paused');assert.equal(p.processed,0);assert.equal(p.pages[0].analysis?.kind,'blocked');assert.equal(calls-before,1,'内容拒绝不得作为格式错误重试');assert.equal(p.memory,'');assert.equal(p.stages.length,0);
  }
  p=await call(root+'/reset','POST');mode='truncatedAlways';const truncationStart=calls;
  const savedMemory=p.memory;await call(root+'/read','POST');p=await poll();
  assert.equal(p.status,'error');assert.equal(p.processed,0);assert.equal(p.memory,savedMemory);assert.equal(p.characters.length,0);assert.equal(calls-truncationStart,2);
  const lengthPath=path.join(dataDir,'projects',p.id,'diagnostics',`${p.pages[0].id}.json`);
  const lengthRaw=await readFile(lengthPath,'utf8'),lengthLog=JSON.parse(lengthRaw);
  assert.equal(lengthLog.resolved,false);assert.equal(lengthLog.attempts[0].finishReason,'length');assert.equal(lengthLog.attempts[0].reasoningTokens,32760);
  assert.equal(lengthLog.attempts[1].request.thinking.type,'disabled');assert.ok(!lengthRaw.includes('partial-json-secret'));
  mode='truncated';await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed');assert.equal(p.processed,5);
  assert.equal(JSON.parse(await readFile(lengthPath,'utf8')).resolved,true);
  p=await call(root+'/reset','POST');mode='truncatedRefusal';const refusalCalls=calls;
  await call(root+'/read','POST');p=await poll();assert.equal(p.status,'paused');assert.equal(p.processed,0);assert.equal(p.pages[0].analysis?.kind,'blocked');assert.equal(calls-refusalCalls,1);
  p=await call(root+'/reset','POST');p=await call(root+`/pages/${p.pages[0].id}`,'PATCH',{override:'auto'});
  const invalidated=await fetch(base+root+'/read',{method:'POST'});assert.equal(invalidated.status,400);
  p=await call(root+'/page-selection','PUT',{pages:p.pages.map(page=>({id:page.id,purpose:'story'}))});
  mode='review';const reviewCalls=calls;await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed');assert.equal(p.processed,5);assert.equal(calls-reviewCalls,5,'用户划分优先，不重复发送分类复核');
  await call('/settings','PUT',{baseUrl:`http://localhost:${mockPort}`,model:'test-vision',apiKey:''});const changed=await call('/settings');assert.equal(changed.hasKey,false,'更换地址后不能回退到环境密钥');
});
