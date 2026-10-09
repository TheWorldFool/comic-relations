import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import type { Project } from '../shared/types.js';

test('真实 HTTP：导入排序、视觉请求、过滤、阶段去重、头像、断点恢复和重排失效', {timeout:60000}, async t => {
  let calls=0, failOnce=true, incrementalFailure=true, transientCalls=0;
  const deltaReviewPages:number[]=[];
  let releaseSlow!:()=>void,markSlowStarted!:()=>void,markSlowFinished!:()=>void;
  const slowGate=new Promise<void>(resolve=>{releaseSlow=resolve;});
  const slowStarted=new Promise<void>(resolve=>{markSlowStarted=resolve;});
  const slowFinished=new Promise<void>(resolve=>{markSlowFinished=resolve;});
  let identityMode:'normal'|'pending'|'match'|'confirm'|'blocked'='normal';
  let searchMode: 'valid'|'repair'|'badRepair'='valid',searchCalls=0;
  let mode: 'characterDelta' | 'normal' | 'uncertain' | 'slow' | 'repair' | 'invalid' | 'badJson' | 'emptyProperty' | 'emptyAlways' | 'syntaxAlways' | 'refused' | 'textRefused' | 'filterRefused' | 'truncated' | 'truncatedAlways' | 'truncatedRefusal' | 'noMessage' | 'incremental' | 'missingMemoryMode' | 'checkpointMismatch' | 'emptyCheckpoint' | 'transient' = 'normal';
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
    if(data.messages[0]?.content?.startsWith('你负责漫画人物身份复核')){
      const context=JSON.parse(data.messages[1].content[0].text);
      if(mode==='characterDelta'){deltaReviewPages.push(context.page);if(context.page===4)assert.ok(context.subjects[0].inheritedFields.includes('name'));}
      if(identityMode==='blocked'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({status:'blocked',reason:'无法安全处理'})},finish_reason:'stop'}]}));return;}
      const decisions=context.subjects.map((person:any)=>({id:person.id,decision:person.sameAs?'match':'new',target:person.sameAs?.id||null,candidates:[],evidence:person.sameAs?[{kind:'visual',text:'左眼痣一致'},{kind:'continuity',text:'上一页开门动作连续'}]:[{kind:'distinct',text:'本页两人独立对话且外貌不同'}],conflicts:[]}));
      if(identityMode==='pending')for(const d of decisions){d.decision='pending';d.target=null;d.evidence=[];}
      if(identityMode==='confirm')for(const d of decisions){d.decision='confirm';d.target=null;d.evidence=[{kind:'distinct',text:'与其他档案的脸部特征明确不同'}];}
      if(identityMode==='match')for(const d of decisions){d.decision='match';d.target='a';d.evidence=[{kind:'visual',text:'相同耳饰和脸部特征'},{kind:'continuity',text:'翻页前后的动作接续'}];}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({decisions})},finish_reason:'stop'}]}));return;
    }
    const blocks=data.messages.find((m:any)=>m.role==='user'&&Array.isArray(m.content)).content;
    assert.ok(blocks.some((b:any)=>b.type==='image_url'&&b.image_url.url.startsWith('data:image/jpeg;base64,')));
    assert.equal(data.response_format.type,'json_object');
    const context=JSON.parse(blocks[0].text.split('前文上下文：')[1]);const n=context.page;calls++;
    if(mode==='incremental'||mode==='checkpointMismatch'||mode==='emptyCheckpoint'){
      assert.equal(context.memoryInstruction,n===6?'checkpoint':'delta');
      const prompt=data.messages[0].content as string;
      const example=JSON.parse(prompt.split('本次输出格式示例（占位文字不可作为剧情事实）：\n')[1].split('\n')[0]);
      const schema=JSON.parse(prompt.split('只返回前述 blocked 对象）：')[1]);
      assert.equal(example.memoryMode,context.memoryInstruction);
      assert.equal(schema.properties.memoryMode.const,context.memoryInstruction);
      assert.match(blocks.at(-1).text,new RegExp(`memoryMode 必须为 "${context.memoryInstruction}"`));
      assert.deepEqual(context.memoryState.pending.map((entry:any)=>entry.page),n<=6?Array.from({length:n-1},(_,i)=>i+1):[]);
      assert.equal(context.memory,n<=6?'':'汇总到第6页');
      assert.ok(!context.recentPages.some((page:any)=>page.page>=n),'不把未来页作为已读上下文');
      if(n===3&&incrementalFailure){incrementalFailure=false;res.writeHead(400);res.end('{}');return;}
      if(n>1)assert.equal(context.memoryState.threads[0].id,'promise');
      const output={kind:'story',confidence:1,reason:'正文',summary:`第${n}页事件`,storyTime:'',memory:n===6?(mode==='emptyCheckpoint'?'   ':'汇总到第6页'):`增量${n}`,memoryMode:mode==='checkpointMismatch'&&n===6?'delta':context.memoryInstruction,threadChanges:n===1?[{action:'upsert',id:'promise',text:'尚未兑现的承诺'}]:n===7?[{action:'resolve',id:'promise',text:'本页明确兑现承诺'}]:[],turningPoint:null,characters:[],relationChanges:[]};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}));return;
    }
    if(mode==='characterDelta'){
      const characters=n===1?[{id:'delta-a',name:'甲',aliases:['小甲'],description:'短发调查员',nameType:'named',avatarBox:null},{id:'delta-b',name:'乙',aliases:[],description:'长发记录员',avatarBox:null}]:[{id:'delta-a',presence:'visible',avatarBox:null,...(n===4?{identityConcern:'耳饰与前页不同，需要复核'}:{})},{id:'delta-b',presence:'visible',avatarBox:null}];
      const output={kind:'story',confidence:1,reason:'正文',summary:`第${n}页事件`,storyTime:'',memory:`本页事件${n}`,memoryMode:context.memoryInstruction,threadChanges:[],characters,
        turningPoint:n===3?{title:'正式结盟',reason:'双方明确约定长期合作',confidence:1}:null,
        relationChanges:n===3?[{action:'upsert',source:'delta-a',target:'delta-b',kind:'team',label:'同盟',directed:false,evidence:'双方约定'}]:[]};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}));return;
    }
    if(mode==='transient'&&++transientCalls<=2){res.writeHead(transientCalls===1?503:429,{'retry-after':'0'});res.end('{}');return;}
    if(mode==='missingMemoryMode'){
      const output={kind:'story',confidence:1,reason:'正文',summary:'事件',storyTime:'',memory:'不能判断是增量还是全文',threadChanges:[],turningPoint:null,characters:[],relationChanges:[]};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}));return;
    }
    if(['refused','textRefused','filterRefused'].includes(mode)){
      const content=mode==='textRefused'?'抱歉，无法处理此请求。':JSON.stringify({status:'blocked',reason:'无法安全处理'});
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content},finish_reason:mode==='filterRefused'?'content_filter':'stop'}]}));return;
    }
    if(mode==='noMessage'){
      // Compatible providers can answer 200 with a choice that has no message.
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop'}]}));return;
    }
    if(['truncated','truncatedAlways','truncatedRefusal'].includes(mode)){
      const recovering=data.messages.some((m:any)=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('上一轮因输出长度限制'));
      const valid={kind:'story',confidence:.95,reason:'正文',summary:'完整页面',storyTime:'',memory:'完整新记忆',memoryMode:context.memoryInstruction,threadChanges:[],turningPoint:null,characters:[],relationChanges:[]};
      if(recovering){assert.deepEqual(data.thinking,{type:'disabled'});assert.ok(!data.messages.some((m:any)=>m.role==='assistant'));}
      else{assert.equal(data.reasoning_effort,'low');}
      const truncated=!recovering||mode==='truncatedAlways'||mode==='truncatedRefusal';
      const content=mode==='truncatedRefusal'?JSON.stringify({status:'blocked',reason:'无法处理'}):truncated?'partial-json-secret':JSON.stringify(valid);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content},finish_reason:truncated?'length':'stop'}],usage:{prompt_tokens:1500,completion_tokens:32768,completion_tokens_details:{reasoning_tokens:32760}}}));return;
    }
    if(['emptyProperty','emptyAlways','syntaxAlways'].includes(mode)){
      const valid={kind:'story',confidence:.95,reason:'正文',summary:'甲到达车站',storyTime:'',memory:'甲到达车站',memoryMode:context.memoryInstruction,threadChanges:[],turningPoint:null,characters:[],relationChanges:[]};
      const content=mode==='emptyAlways'?'':mode==='syntaxAlways'?'{"summary":}':JSON.stringify(valid).slice(0,-1)+',""}';
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));return;
    }
    if(['repair','invalid','badJson'].includes(mode)){
      const corrected=data.messages.some((m:any)=>m.role==='assistant');
      let content=JSON.stringify({kind:'story',confidence:.95,reason:'正文',summary:'剧情',storyTime:null,memoryMode:context.memoryInstruction,threadChanges:[],turningPoint:null,...(corrected&&mode!=='invalid'?{memory:'完整剧情记忆'}:{}),characters:[],relationChanges:[]});
      if(mode==='badJson'&&!corrected)content='not JSON';
      if(corrected){assert.match(data.messages.at(-1).content,/未通过校验/);assert.ok(data.messages[0].content.includes('JSON Schema'));}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));return;
    }
    if(mode==='normal'&&n>=3){assert.equal(context.characters[0].statuses[0].target,'b');assert.equal(context.currentPhase.baselineStatuses[0].statuses[0].target,'b');}
    if(mode==='slow'){
      markSlowStarted();await slowGate;
      const output={kind:'story',confidence:.95,reason:'正文',summary:'延迟请求',storyTime:'',memory:'延迟请求',memoryMode:context.memoryInstruction,threadChanges:[],turningPoint:null,characters:[],relationChanges:[]};
      if(!res.destroyed){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}));}
      markSlowFinished();return;
    }
    if(n===4&&failOnce){failOnce=false;res.writeHead(400);res.end('{}');return;}
    const people=[{id:'a',name:'小甲',aliases:[],description:'短发',profileUpdates:[{action:'upsert',key:'occupation',label:'职业',value:'调查员',certainty:'confirmed',evidence:'自我介绍'}],statusChanges:[{action:'upsert',key:'trust',label:'信任',value:'信任对方',certainty:'confirmed',evidence:'将任务交给对方',target:'b'}],avatarBox:{x:.1,y:.1,width:.3,height:.3}},{id:'b',name:'小乙',aliases:[],description:'长发',avatarBox:null}];
    const reading={kind:mode==='uncertain'?'uncertain':n===1?'cover':n===3?'ad':'story',confidence:mode==='uncertain'?.4:.96,reason:'测试分类',summary:'测试剧情',storyTime:'',memory:'已知人物相遇',memoryMode:context.memoryInstruction,threadChanges:[],turningPoint:mode==='normal'&&n===5?{title:'同盟破裂',reason:'正式结束合作并转为对立',confidence:.95}:null,characters:mode==='normal'&&n===2?people:mode==='normal'&&n===4?[{...people[0],id:'named-a',name:'阿甲',nameType:'named',sameAs:{id:'a',confidence:.96,evidence:'相同脸部与场景延续'}}]:[],relationChanges:mode==='normal'&&(n===2||n===5)?[{action:'upsert',source:'a',target:'b',kind:'affiliation',label:n===5?'敌对':'同伴',directed:false,evidence:'漫画对白确认'}]:[]};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(reading)},finish_reason:'stop'}]}));
  });
  await new Promise<void>(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const mockPort=(mock.address() as {port:number}).port;
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'comic-test-'));
  const portProbe=createServer();await new Promise<void>(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const port=(portProbe.address() as {port:number}).port;await new Promise<void>(resolve=>portProbe.close(()=>resolve()));
  const server=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DATA_DIR:dataDir,PORT:String(port),DEEPSEEK_API_KEY:'test-only-key',DEEPSEEK_BASE_URL:`http://127.0.0.1:${mockPort}`,DEEPSEEK_MODEL:'deepseek-flash',DEEPSEEK_REASONING_EFFORT:'low',DEEPSEEK_MAX_TOKENS:'32768'},stdio:'pipe'});
  t.after(()=>{releaseSlow();server.kill();mock.close();});
  let serverLog='';server.stderr.on('data',b=>{serverLog+=b;});
  const base=`http://127.0.0.1:${port}/api`;
  for(let i=0;i<100;i++){try{if((await fetch(`${base}/settings`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const call=async (url:string,method='GET',body?:unknown)=>{const res=await fetch(base+url,{method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});assert.equal(res.ok,true,await res.clone().text()+serverLog);return res.json();};
  const created=await call('/projects','POST',{name:'测试漫画'});const root=`/projects/${created.id}`;
  const bytes=await sharp({create:{width:320,height:480,channels:3,background:'#fafafa'}}).png().toBuffer();
  const form=new FormData();for(const n of [10,2,1,4,3])form.append('files',new Blob([new Uint8Array(bytes)],{type:'image/png'}),`漫画第${n}页.png`);
  let p:Project=await call(root+'/pages','POST',form);
  assert.deepEqual(p.pages.map(p=>p.name),['漫画第1页.png','漫画第2页.png','漫画第3页.png','漫画第4页.png','漫画第10页.png']);
  const unsupported=new FormData();unsupported.append('files',new Blob([new Uint8Array(bytes)],{type:'image/png'}),'说明.txt');
  const unsupportedRes=await fetch(base+root+'/pages',{method:'POST',body:unsupported});
  assert.equal(unsupportedRes.status,400);assert.match(await unsupportedRes.text(),/不支持的文件/);
  assert.equal((await call(root)).pages.length,5,'被拒绝的文件不得改变页面数量');
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
  const poll=async(id:string=created.id)=>{let result:Project|undefined;const deadline=Date.now()+15000;while(Date.now()<deadline){result=await call(`/projects/${id}`);if(result!.status!=='running')return result!;await new Promise(r=>setTimeout(r,100));}throw new Error(`job timeout: ${JSON.stringify({status:result?.status,processed:result?.processed,error:result?.error})} ${serverLog}`);};
  const workContext={originalWork:'测试原作',background:'仅用于身份对照',characterGuide:'阿甲又称小甲'};await call(root,'PATCH',{workContext});
  await call(root+'/read','POST');p=await poll();assert.equal(p.status,'error');assert.equal(p.processed,3);assert.equal(p.stages.length,1);assert.equal(p.stages[0].fromPage,2);assert.equal(p.stages[0].toPage,3);
  assert.equal(p.characters[0].profile![0].value,'调查员');assert.equal(p.characters[0].statuses![0].target,'b');assert.ok(p.characters[0].avatar);assert.equal((await fetch(`http://127.0.0.1:${port}${p.characters[0].avatar}`)).status,200);
  assert.equal(p.pages[1].timing?.attempts,2,'新增人物页累计初读与身份复核的请求');assert.ok((p.pages[1].timing?.elapsedMs||0)>=0);
  assert.ok(p.pages[1].timing!.modelMs!>=0);assert.ok(p.pages[1].timing!.preparationMs!>=0);assert.ok(p.pages[1].timing!.contextCharacters!>0);assert.equal(p.pages[1].timing!.imageCount,2);
  assert.equal(p.pages[2].timing,undefined,'跳过的页面不计入模型耗时');
  const orderedBefore=structuredClone(p),originalOrder=p.pages.map(page=>page.id),unreadOrder=[...originalOrder];
  [unreadOrder[3],unreadOrder[4]]=[unreadOrder[4],unreadOrder[3]];
  p=await call(root+'/order','PUT',{ids:unreadOrder});
  assert.equal(p.processed,orderedBefore.processed);assert.deepEqual(p.characters,orderedBefore.characters);assert.deepEqual(p.readingMemory,orderedBefore.readingMemory);assert.deepEqual(p.stages,orderedBefore.stages);
  await call(root+'/order','PUT',{ids:originalOrder});
  await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed',p.error||serverLog);assert.equal(p.processed,5);assert.equal(calls,4);assert.equal(p.stages.length,2);assert.equal(p.stages[0].toPage,4);assert.equal(p.stages[1].fromPage,5);assert.equal(p.pages[2].analysis?.kind,'ad');
  assert.equal(p.characters.length,2);assert.equal(p.characters[0].name,'阿甲');assert.equal(p.identityRedirects!['named-a'],'a');
  const exported:Project=await call(root+'/export');assert.equal(exported.stages[1].relations[0].label,'敌对');
  const disk:Project=JSON.parse(await readFile(path.join(dataDir,'projects',p.id,'project.json'),'utf8'));assert.equal(disk.processed,5);assert.equal(disk.stages[0].characters[0].statuses![0].target,'b');assert.equal(exported.characters[0].records!.length,2);
  const correction=await call(root+'/corrections','POST',{kind:'character',personId:'a',name:'人工确认甲',aliases:['阿甲'],description:'已校对',appearance:'短发',nameType:'named'});
  assert.equal(correction.characters[0].name,'人工确认甲');assert.equal(correction.corrections.length,1);
  await call(root+'/corrections/'+correction.corrections[0].id,'DELETE');
  const restoreName=await call(root+'/corrections','POST',{kind:'character',personId:'a',name:p.characters[0].name,aliases:p.characters[0].aliases,description:p.characters[0].description,appearance:p.characters[0].appearance||'',nameType:p.characters[0].nameType||'named'});
  p=await call(root+'/corrections/'+restoreName.corrections[0].id,'DELETE');
  const beforeMerge=structuredClone(p);
  p=await call(root+'/characters/merge','POST',{source:'b',target:'a'});assert.equal(p.characters.length,1);assert.equal(p.relations.length,0);assert.equal(p.canUndoMerge,true);
  p=await call(root+'/characters/merge/undo','POST');assert.deepEqual(p.characters,beforeMerge.characters);assert.deepEqual(p.stages,beforeMerge.stages);assert.deepEqual(p.relations,beforeMerge.relations);
  p=await call(root+'/characters/merge','POST',{source:'b',target:'a'});p=await call(root,'PATCH',{workContext:{...workContext,background:'新的说明'}});
  assert.equal(p.canUndoMerge,false);assert.equal(p.canRewindMerge,true);
  const staleUndo=await fetch(base+root+'/characters/merge/undo',{method:'POST'});assert.equal(staleUndo.status,400);
  const continuationUpload=new FormData();continuationUpload.append('files',new Blob([new Uint8Array(bytes)],{type:'image/png'}),'后续页.png');
  p=await call(root+'/pages','POST',continuationUpload);
  p=await call(root+'/page-selection','PUT',{pages:p.pages.map(page=>({id:page.id,purpose:page.purpose||'story'}))});
  mode='repair';await call(root+'/read','POST');p=await poll();mode='normal';
  assert.equal(p.processed,6);assert.equal(p.status,'completed');
  const runsAfterContinuation=structuredClone(p.readingRuns);
  p=await call(root+'/characters/merge/rewind','POST',{confirm:true});
  assert.equal(p.characters.length,2);assert.equal(p.workContext?.background,'新的说明');assert.equal(p.canRewindMerge,false);
  assert.equal(p.processed,5);assert.equal(p.pages.length,6);assert.equal(p.pages[5].analysis,undefined);assert.equal(p.status,'paused');
  assert.deepEqual(p.readingRuns,runsAfterContinuation);assert.deepEqual(p.stages,beforeMerge.stages);
  p=await call(root+'/pages/'+p.pages[5].id,'DELETE');assert.deepEqual(p.readingRuns,runsAfterContinuation);
  // The review is part of page submission; unresolved identities do not stop reading.
  const identityProject=await call('/projects','POST',{name:'身份待定测试'}),identityRoot=`/projects/${identityProject.id}`;
  const identityUpload=new FormData();for(let i=1;i<=2;i++)identityUpload.append('files',new Blob([new Uint8Array(bytes)],{type:'image/png'}),`${i}.png`);
  let identityState:Project=await call(identityRoot+'/pages','POST',identityUpload);
  await call(identityRoot+'/page-selection','PUT',{pages:identityState.pages.map(pg=>({id:pg.id,purpose:'story'}))});
  identityMode='pending';await call(identityRoot+'/read','POST');identityState=await poll(identityProject.id);
  assert.equal(identityState.processed,2);assert.equal(identityState.status,'completed');assert.equal(identityState.pendingIdentities?.length,2);assert.equal(identityState.stages[0].characters.length,0);assert.equal(identityState.relations.length,1);
  assert.equal(identityState.pages[1].timing?.attempts,2);assert.equal(identityState.pages[1].timing?.identityReviewRequests,1);
  assert.equal(identityState.characters.length,0);assert.ok(identityState.appearances?.some(a=>a.observed.crop));assert.ok(identityState.pendingIdentities?.every(c=>!c.references?.length));
  identityState=await call(identityRoot+'/characters/a/confirm','POST');assert.equal(identityState.stages[0].characters.length,1);assert.equal(identityState.stages[0].relations.length,0);
  const lastReadingTiming=structuredClone(identityState.pages[1].timing),beforeAuditRuns=identityState.readingRuns!.length;
  identityMode='match';identityState=await call(identityRoot+'/characters/b/review','POST');
  assert.equal(identityState.processed,2);assert.equal(identityState.characters.length,1);assert.equal(identityState.pendingIdentities?.length,1);assert.equal(identityState.identitySuggestions?.[0].target,'a');assert.equal(identityState.readingRuns!.length,beforeAuditRuns+1);assert.equal(identityState.readingRuns!.at(-1)?.task,'identity-review');assert.deepEqual(identityState.pages[1].timing,lastReadingTiming);
  identityMode='confirm';identityState=await call(identityRoot+'/characters/b/review','POST');assert.equal(identityState.characters.find(c=>c.id==='b')?.identityState,'confirmed');assert.equal(identityState.stages[0].characters.length,2);assert.equal(identityState.stages[0].relations.length,1);assert.equal(identityState.processed,2);
  const appearance=identityState.appearances!.find(a=>a.characterId==='b')!,beforeBindingCalls=calls;
  identityState=await call(identityRoot+'/appearances/bind','POST',{ids:[appearance.id],characterId:null,newName:'第三人',reason:'本次出场具有不同的稳定外貌'});
  assert.equal(calls,beforeBindingCalls,'人工出场校正不调用模型');
  assert.equal(identityState.processed,2);assert.equal(identityState.characters.length,3);
  assert.notEqual(identityState.appearances!.find(a=>a.id===appearance.id)!.characterId,'b');
  identityState=await call(identityRoot+'/appearances/bind','POST',{ids:[appearance.id],characterId:'b',reason:'撤回本次判断，恢复乙'});
  identityState=await call(identityRoot+'/characters/merge','POST',{source:'b',target:'a'});assert.equal(identityState.characters.length,2);assert.equal(identityState.stages[0].characters.length,1);assert.equal(identityState.characters.filter(c=>c.archived).length,1);
  const beforeManualCalls=calls;
  identityState=await call(identityRoot+'/appearances','POST',{pageId:identityState.pages[0].id,characterId:null,name:'补录人物',nameType:'descriptive',appearance:'方形帽子',reason:'框内独立人物',box:{x:.1,y:.1,width:.3,height:.4}});
  const manualAppearance=identityState.appearances!.at(-1)!;
  assert.equal(manualAppearance.verification,'manual');assert.ok(manualAppearance.observed.crop);
  assert.equal((await fetch(`http://127.0.0.1:${port}${manualAppearance.observed.crop}`)).status,200);
  const manualRelation={source:manualAppearance.characterId!,target:'a',kind:'cooperation',label:'同伴',directed:false,evidence:'人工补充关系证据',sincePage:1};
  identityState=await call(identityRoot+'/corrections','POST',{scope:'once',kind:'relation',action:'upsert',relation:manualRelation});
  assert.ok(identityState.relations.some(r=>r.source===manualRelation.source&&r.target==='a'));assert.equal(identityState.corrections?.length||0,0);
  identityState=await call(identityRoot+'/appearances/bind','POST',{ids:[manualAppearance.id],characterId:manualAppearance.characterId,reason:'再次核对，仍为该人物'});
  assert.ok(identityState.relations.some(r=>r.source===manualRelation.source&&r.target==='a'),'再次重算不会丢失一次性补录');
  assert.equal(calls,beforeManualCalls,'补录裁图与一次性校正均不请求模型');
  await call(identityRoot+'/reset','POST');identityMode='blocked';await call(identityRoot+'/read','POST');identityState=await poll(identityProject.id);
  assert.equal(identityState.status,'paused');assert.equal(identityState.processed,1);assert.equal(identityState.characters.length,0);assert.equal(identityState.pages[1].analysis?.kind,'blocked');
  identityMode='normal';
  p=await call(root+'/order','PUT',{ids:p.pages.map(pg=>pg.id).reverse()});assert.equal(p.processed,0);assert.equal(p.stages.length,0);assert.equal(p.characters.length,0);
  const invalid=await fetch(base+root+'/order',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[p.pages[0].id,p.pages[0].id]})});assert.equal(invalid.status,400);
  const privateConfig=await fetch(`http://127.0.0.1:${port}/media/${p.id}/../settings.json`);assert.notEqual(privateConfig.status,200);
  for(const origin of ['http://evil.example','not a url']){
    const foreignOrigin=await fetch(base+'/settings',{headers:{Origin:origin}});
    assert.equal(foreignOrigin.status,403,`非本地或畸形 Origin 必须拒绝：${origin}`);
  }
  const config=await call('/settings');assert.equal(config.hasKey,true);assert.equal(config.apiKey,undefined);
  mode='uncertain';await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed',p.error||serverLog);assert.equal(p.processed,5);assert.equal(p.pages[0].analysis?.kind,'story','用户指定正文时模型分类存疑也不暂停');
  p=await call(root+'/reset','POST');p=await call(root+'/page-selection','PUT',{pages:p.pages.map((page,i)=>({id:page.id,purpose:i<2?'extra':'story'}))});
  mode='slow';await call(root+'/read','POST');
  await Promise.race([slowStarted,new Promise<never>((_,reject)=>{setTimeout(()=>reject(new Error(`mock reading did not start: ${serverLog}`)),15000).unref();})]);
  p=await call(root);assert.equal(p.processed,2,p.error||serverLog);assert.equal(p.readingActivity?.phase,'reading');assert.equal(p.readingActivity?.page,3);
  const concurrent=await fetch(base+root+'/order',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:p.pages.map(pg=>pg.id)})});assert.equal(concurrent.status,400);
  await call(root+'/pause','POST');p=await poll();assert.equal(p.status,'paused');assert.equal(p.processed,2);assert.equal(p.readingActivity,undefined);
  releaseSlow();await slowFinished;
  mode='invalid';const beforeFailure=calls;await call(root+'/read','POST');p=await poll();assert.equal(p.status,'error');assert.equal(p.processed,2);assert.equal(calls-beforeFailure,2,'格式失败只自动纠错一次');assert.match(p.error||'',/memory/);
  const diagnosticPath=path.join(dataDir,'projects',p.id,'diagnostics',`${p.pages[2].id}.json`);
  const failedDiagnostic=JSON.parse(await readFile(diagnosticPath,'utf8'));assert.equal(failedDiagnostic.resolved,false);assert.equal(failedDiagnostic.attempts.length,2);
  mode='repair';await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed',p.error||serverLog);assert.equal(p.processed,5);
  const diagnostic=JSON.parse(await readFile(diagnosticPath,'utf8'));assert.equal(diagnostic.resolved,true);assert.equal(diagnostic.attempts.length,2);
  p=await call(root+'/reset','POST');mode='badJson';await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed',p.error||serverLog);assert.equal(p.processed,5);
  p=await call(root+'/reset','POST');mode='emptyProperty';const beforeLocalRepair=calls;
  await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed',p.error||serverLog);
  assert.equal(calls-beforeLocalRepair,p.pages.filter(page=>page.override!=='skip').length,'明确的空字段格式修复无需再请求模型');
  const localRepairDiagnostic=JSON.parse(await readFile(diagnosticPath,'utf8'));assert.equal(localRepairDiagnostic.resolved,true);
  assert.ok(localRepairDiagnostic.attempts[0].adjustments.some((a:string)=>a.includes('空字段')));
  for(const failureMode of ['emptyAlways','syntaxAlways'] as const){
    p=await call(root+'/reset','POST');mode=failureMode;const beforeSyntaxFailure:number=calls;
    await call(root+'/read','POST');p=await poll();assert.equal(p.status,'error');assert.equal(p.processed,p.pages.findIndex(page=>page.override!=='skip'),p.error||serverLog);
    assert.equal(calls-beforeSyntaxFailure,2);assert.equal(p.characters.length,0);assert.equal(p.stages.length,0);
    assert.equal(p.pages[p.processed].timing?.attempts,2,'失败页也记录尝试次数');
    assert.match(p.error||'',failureMode==='emptyAlways'?/未返回正文/:/语法错误/);
    const failure=JSON.parse(await readFile(path.join(dataDir,'projects',p.id,'diagnostics',`${p.pages[p.processed].id}.json`),'utf8'));
    assert.equal(failure.attempts[1].failure,failureMode==='emptyAlways'?'empty':'syntax');assert.equal(failure.attempts[1].finishReason,'stop');
  }
  p=await call(root+'/reset','POST');mode='noMessage';const beforeNoMessage=calls;
  await call(root+'/read','POST');p=await poll();
  assert.equal(p.status,'error');assert.equal(calls-beforeNoMessage,2,'缺少 message 的响应按格式错误处理并重试一次');
  assert.match(p.error||'',/未返回正文/);assert.doesNotMatch(p.error||'',/refusal|undefined/,'不得把内部异常文本当作错误信息');

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
  mode='truncated';await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed',p.error||serverLog);assert.equal(p.processed,5);
  assert.equal(JSON.parse(await readFile(lengthPath,'utf8')).resolved,true);
  p=await call(root+'/reset','POST');mode='truncatedRefusal';const refusalCalls=calls;
  await call(root+'/read','POST');p=await poll();assert.equal(p.status,'paused');assert.equal(p.processed,0);assert.equal(p.pages[0].analysis?.kind,'blocked');assert.equal(calls-refusalCalls,1);
  p=await call(root+'/reset','POST');p=await call(root+`/pages/${p.pages[0].id}`,'PATCH',{override:'auto'});
  const invalidated=await fetch(base+root+'/read',{method:'POST'});assert.equal(invalidated.status,400);
  p=await call(root+'/page-selection','PUT',{pages:p.pages.map(page=>({id:page.id,purpose:'story'}))});
  mode='uncertain';const uncertainCalls=calls;await call(root+'/read','POST');p=await poll();assert.equal(p.status,'completed',p.error||serverLog);assert.equal(p.processed,5);assert.equal(calls-uncertainCalls,5,'用户已确定页面用途，模型分类存疑也不暂停、不重复请求');
  const appended=await call(root+'/pages','POST',(()=>{const f=new FormData();f.append('files',new Blob([new Uint8Array(bytes)],{type:'image/png'}),'附页.png');return f;})());
  assert.equal(appended.pages.length,6);assert.equal(appended.processed,5);assert.equal(appended.status,'paused');
  const beforeAppend=structuredClone(p);
  const kept=await call(root+`/pages/${appended.pages[5].id}`,'DELETE');
  assert.equal(kept.processed,5,'移除未读页必须保留已读进度');
  assert.deepEqual(kept.characters,beforeAppend.characters);assert.deepEqual(kept.stages,beforeAppend.stages);assert.equal(kept.memory,beforeAppend.memory);
  assert.equal(kept.status,'completed','移除未读的追加页后回到已完成');
  const wiped=await call(root+`/pages/${kept.pages[0].id}`,'DELETE');
  assert.equal(wiped.processed,0,'移除已读页清除分析重新阅读');assert.equal(wiped.stages.length,0);assert.equal(wiped.memory,'');
  const second=await call('/projects','POST',{name:'错误信息'});const secondRoot=`/projects/${second.id}`;
  const secondForm=new FormData();for(const n of [1,2])secondForm.append('files',new Blob([new Uint8Array(bytes)],{type:'image/png'}),`诊断第${n}页.png`);
  let bs:Project=await call(secondRoot+'/pages','POST',secondForm);
  bs=await call(secondRoot+'/page-selection','PUT',{pages:bs.pages.map(page=>({id:page.id,purpose:'story'}))});
  await writeFile(path.join(dataDir,'projects',bs.id,'diagnostics'),'诊断目录被文件占用');
  mode='emptyProperty';await call(secondRoot+'/read','POST');bs=await poll(bs.id);
  assert.equal(bs.status,'completed',bs.error||serverLog);assert.equal(bs.processed,2,'诊断写入失败不得使有效页面失败');
  await call(secondRoot+'/reset','POST');
  await rm(path.join(dataDir,'projects',bs.id,'images',`${bs.pages[0].id}.jpg`));
  await call(secondRoot+'/read','POST');bs=await poll(bs.id);
  assert.equal(bs.status,'error');assert.match(bs.error||'',/图片/,'缺失图片给出可读提示');
  assert.ok(!(bs.error||'').includes(dataDir),'错误信息不得包含本机数据目录');
  const incremental=await call('/projects','POST',{name:'增量记忆连续性'});const incrementalRoot=`/projects/${incremental.id}`;
  const incrementalForm=new FormData();for(let i=1;i<=7;i++)incrementalForm.append('files',new Blob([new Uint8Array(bytes)],{type:'image/png'}),`${i}.png`);
  let ip:Project=await call(incrementalRoot+'/pages','POST',incrementalForm);
  await call(incrementalRoot+'/page-selection','PUT',{pages:ip.pages.map(page=>({id:page.id,purpose:'story'}))});
  mode='incremental';await call(incrementalRoot+'/read','POST');ip=await poll(ip.id);
  assert.equal(ip.status,'error');assert.equal(ip.processed,2);assert.equal(ip.readingMemory?.pending.length,2);
  await call(incrementalRoot+'/read','POST');ip=await poll(ip.id);
  assert.equal(ip.status,'completed',ip.error||serverLog);assert.equal(ip.memory,'汇总到第6页');
  assert.deepEqual(ip.readingMemory?.pending,[{page:7,text:'增量7'}]);assert.deepEqual(ip.readingMemory?.threads,[]);
  assert.equal(ip.stages.length,1,'记忆汇总不是剧情转折');
  assert.equal(ip.pages[5].timing?.attempts,1,'明确汇总任务一次请求即可提交');
  const incDisk:Project=JSON.parse(await readFile(path.join(dataDir,'projects',ip.id,'project.json'),'utf8'));
  assert.deepEqual(incDisk.readingMemory,ip.readingMemory);
  for(const badCheckpoint of ['checkpointMismatch','emptyCheckpoint'] as const){
  await call(incrementalRoot+'/reset','POST');mode=badCheckpoint;
  await call(incrementalRoot+'/read','POST');ip=await poll(ip.id);
  assert.equal(ip.status,'error');assert.equal(ip.processed,5);assert.equal(ip.memory,'');
  assert.deepEqual(ip.readingMemory?.pending.map(entry=>entry.page),[1,2,3,4,5]);
  assert.equal(ip.readingMemory?.threads[0].id,'promise');assert.equal(ip.pages[5].analysis,undefined);
  assert.equal(ip.pages[5].timing?.attempts,2);assert.match(ip.error||'',/memory/);
  mode='incremental';await call(incrementalRoot+'/read','POST');ip=await poll(ip.id);
  assert.equal(ip.status,'completed',ip.error||serverLog);assert.equal(ip.memory,'汇总到第6页');
  assert.equal(ip.pages[5].timing?.attempts,1);assert.deepEqual(ip.readingMemory?.threads,[]);
  }
  await call(incrementalRoot+'/reset','POST');mode='missingMemoryMode';const missingModeCalls=calls;
  await call(incrementalRoot+'/read','POST');ip=await poll(ip.id);
  assert.equal(ip.status,'error');assert.equal(ip.processed,0);assert.equal(ip.memory,'');assert.equal(ip.readingMemory,undefined);assert.equal(calls-missingModeCalls,2);assert.match(ip.error||'',/memoryMode/);
  const resilient=await call('/projects','POST',{name:'恢复与用量'}),resilientRoot=`/projects/${resilient.id}`;
  const onePage=new FormData();onePage.append('files',new Blob([new Uint8Array(bytes)],{type:'image/png'}),'1.png');
  let rp:Project=await call(resilientRoot+'/pages','POST',onePage);
  await call(resilientRoot+'/page-selection','PUT',{pages:rp.pages.map(page=>({id:page.id,purpose:'story'}))});
  mode='transient';await call(resilientRoot+'/read','POST');rp=await poll(rp.id);
  assert.equal(rp.status,'completed',rp.error||serverLog);assert.equal(rp.pages[0].timing?.attempts,3);assert.equal(rp.readingRuns?.[0].attempts,3);
  assert.equal(rp.readingRuns?.[0].model,'deepseek-flash');assert.match(rp.readingRuns?.[0].promptHash||'',/^[a-f0-9]{64}$/);
  const brokenFile=path.join(dataDir,'projects',rp.id,'project.json');await writeFile(brokenFile,'{broken');
  const book=(await call('/projects')).find((entry:any)=>entry.id===rp.id);assert.equal(book.unreadable,true);assert.equal(book.recoverable,true);
  assert.equal((await fetch(base+resilientRoot)).status,400);
  assert.equal((await fetch(base+resilientRoot+'/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
  rp=await call(resilientRoot+'/restore','POST',{confirm:true});assert.equal(rp.processed,1);assert.equal(rp.status,'completed');assert.equal(rp.readingRuns?.[0].attempts,3);
  const deltaProject=await call('/projects','POST',{name:'系统补全人物档案'}),deltaRoot=`/projects/${deltaProject.id}`;
  const deltaForm=new FormData();for(let i=1;i<=4;i++)deltaForm.append('files',new Blob([new Uint8Array(bytes)],{type:'image/png'}),`${i}.png`);
  let dp:Project=await call(deltaRoot+'/pages','POST',deltaForm);
  await call(deltaRoot+'/page-selection','PUT',{pages:dp.pages.map(page=>({id:page.id,purpose:'story'}))});
  mode='characterDelta';identityMode='normal';await call(deltaRoot+'/read','POST');dp=await poll(dp.id);
  assert.equal(dp.status,'completed',dp.error||serverLog);assert.equal(dp.processed,4);assert.equal(dp.characters.length,2);
  assert.deepEqual(dp.pages.map(page=>page.timing?.attempts),[2,1,1,2],'连续页和纯关系转折只调用主阅读，有疑点时恢复身份复核');
  assert.deepEqual(deltaReviewPages,[1,4]);assert.deepEqual(dp.pages[2].analysis?.characterIds,['delta-a','delta-b']);
  assert.equal(dp.characters[0].name,'甲');assert.deepEqual(dp.characters[0].aliases,['小甲']);assert.equal(dp.relations[0].label,'同盟');assert.equal(dp.stages.length,2);
  const deltaDisk:Project=JSON.parse(await readFile(path.join(dataDir,'projects',dp.id,'project.json'),'utf8'));
  assert.deepEqual(deltaDisk.characters,dp.characters);assert.equal(deltaDisk.appearances?.length,8);
  await call('/settings','PUT',{baseUrl:`http://localhost:${mockPort}`,model:'test-vision',apiKey:''});const changed=await call('/settings');assert.equal(changed.hasKey,false,'更换地址后不能回退到环境密钥');
});
