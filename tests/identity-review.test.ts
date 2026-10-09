import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyReading, type Reading } from '../server/analysis.js';
import { identityCandidates, identitySubjects, validateIdentityDecisions, reviewIdentities, identityReviewContext } from '../server/identity-review.js';
import { resolveIdentities } from '../server/identity.js';
import { addReference, confirmIdentity } from '../server/identity-state.js';
import { ReadingImages } from '../server/reading-images.js';
import { coverReferencePages, identityHistory } from '../server/identity-context.js';
import { parseIdentityReviewJson, parseModelJson, ModelJsonError } from '../server/model-json.js';
import { ModelRefusalError } from '../server/reading-output.js';
import PendingIdentities from '../src/PendingIdentities.js';
import type { Character, IdentityDecision, Project } from '../shared/types.js';

const person=(id:string,name=id)=>({id,name,aliases:[],description:'人物',appearance:'左眼痣，耳饰',avatarBox:null});
const pageReading=(input:Partial<Reading>={}):Reading=>({kind:'story',confidence:1,reason:'正文',summary:'连续动作',storyTime:'',memory:'本页事件',memoryMode:'delta',threadChanges:[],turningPoint:null,characters:[],relationChanges:[],...input});
const project=():Project=>({id:'00000000-0000-0000-0000-000000000001',name:'test',createdAt:'',updatedAt:'',status:'idle',direction:'ltr',processed:0,memory:'',characters:[],relations:[],stages:[],pages:Array.from({length:8},(_,i)=>({id:`p${i}`,name:`${i}`,width:100,height:100,image:'',thumbnail:'',override:'story'}))});
const decision=(id:string,state:IdentityDecision['decision'],target:string|null=null):IdentityDecision=>({id,decision:state,target,candidates:[],conflicts:[],evidence:state==='match'?[{kind:'visual',text:'左眼痣和耳饰对应'},{kind:'continuity',text:'推门动作接续'}]:state==='new'?[{kind:'distinct',text:'与已有角色面对面对话，面部特征不同'}]:[]});

test('复核共享历史场景可完整还原每人的历史；保留疑点、校正、旧人及变化，不带入未来页',()=>{
  const p=project(),subjects=Array.from({length:6},(_,i)=>({...person(`c${i}`),identityConcern:`核对人物 ${i}`,statusChanges:[{action:'upsert' as const,key:'appearance',label:'外观',value:'换装',certainty:'confirmed' as const,target:null,evidence:'换装但保留耳饰'}]}));
  for(let i=0;i<3;i++)applyReading(p,pageReading({summary:`已读场景${i}：${'多个角色交换线索并核对不同身份。'.repeat(60)}`,characters:subjects}));
  p.pages[6].analysis={kind:'story',summary:'不应读取的未来情节',confidence:1,reason:'',storyTime:''};
  p.workContext={originalWork:'测试作品',background:'身份背景',characterGuide:'人物设定'};
  p.corrections=[{id:'fixed',page:2,kind:'character',personId:'c0',name:'人工确认姓名',aliases:[],appearance:'耳饰',description:'已核对',nameType:'named'}];
  const before=JSON.stringify(p),context=identityReviewContext(p,subjects,'reading');
  assert.equal(context.cast.length,6);assert.equal(context.scenes.length,3);
  for(const subject of context.subjects){
    assert.deepEqual({storyAppearances:subject.storyAppearances,recentAppearances:subject.recentAppearances.map(a=>({...a,summary:context.scenes.find(s=>s.page===a.page)?.summary}))},identityHistory(p,subject.id));
    assert.deepEqual(subject.statusChanges,subjects[0].statusChanges);
  }
  assert.deepEqual(context.manualCorrections,p.corrections);assert.deepEqual(context.workContext,p.workContext);
  assert.deepEqual(context.recentScenePages,[1,2,3]);assert.ok(!JSON.stringify(context).includes('不应读取的未来情节'));
  const {scenes,recentScenePages,...rest}=context;
  const repeated={...rest,subjects:subjects.map(s=>({...s,...identityHistory(p,s.id)})),recentScenes:scenes.filter(s=>recentScenePages.includes(s.page))};
  assert.ok(JSON.stringify(context).length<JSON.stringify(repeated).length*.65,'共享场景应显著减少多人重复的相同梗概');
  assert.equal(JSON.stringify(p),before);
});

test('同页人物复核保留全部档案标签，但重复的初登场参考图只发送一次',async()=>{
  const p=project();applyReading(p,pageReading({characters:[person('a'),person('b')]}));
  const images=new ReadingImages(p.id,new AbortController().signal,async(file,variant)=>`data:image/jpeg;base64,${Buffer.from(file+variant).toString('base64')}`);
  try{
    let content:{type:string;text?:string}[]=[];
    await reviewIdentities(p,pageReading({characters:[{...person('a'),identityConcern:'外貌存疑'}]}),images,new AbortController().signal,async messages=>{
      content=(messages[1] as {content:typeof content}).content;
      return {decisions:[decision('a','pending')]};
    });
    assert.equal(content.filter(c=>c.type==='image_url').length,2,'当前页和上一页，两个人物的首次出场页复用上一页');
    const text=content.map(c=>c.text||'').join('\n');
    assert.match(text,/a 初次出场/);assert.match(text,/b 初次出场/);assert.match(text,/复用该图/);
  }finally{images.close();}
});

test('换装和新名字经复核沿用身份；单一相似依据、反证与循环匹配不会强行归并',()=>{
  const p=project();applyReading(p,pageReading({characters:[person('a')]}));
  const subjects=[person('new')];
  const accepted=validateIdentityDecisions(p,subjects,{decisions:[decision('new','match','a')]});
  applyReading(p,pageReading({characters:subjects,identityReview:accepted}));
  assert.equal(p.characters.length,1);assert.equal(p.identityRedirects?.new,'a');assert.equal(p.pages[1].analysis?.identityObservations?.[0].personId,'a');
  const weak=decision('candidate','match','a');weak.evidence=[{kind:'visual',text:'同色头发'}];
  assert.equal(validateIdentityDecisions(p,[person('candidate')],{decisions:[weak]})[0].decision,'pending');
  const conflict=decision('new','match','a');conflict.conflicts=['两个人在同一画格独立互动'];
  assert.equal(validateIdentityDecisions(p,subjects,{decisions:[conflict]})[0].decision,'pending');
  const pair=[person('x'),person('y')];
  assert.ok(validateIdentityDecisions(p,pair,{decisions:[decision('x','match','y'),decision('y','match','x')]}).every(d=>d.decision==='pending'));
  assert.equal(validateIdentityDecisions(p,subjects,{decisions:[decision('new','match','absent')]})[0].decision,'pending');
});

test('待定人物继续阅读且不进入正式图，身份确认后承接旧关系、状态和出场证据；失败页原子保留',()=>{
  const p=project();applyReading(p,pageReading({characters:[person('a'),person('b')]}));
  const relation={action:'upsert' as const,source:'unknown',target:'b',kind:'team',label:'同伴',directed:false,evidence:'交接任务'};
  applyReading(p,pageReading({characters:[{...person('unknown'),statusChanges:[{action:'upsert',key:'health',label:'健康',value:'受伤',target:null,certainty:'confirmed',evidence:'绑着绷带'}]}],relationChanges:[relation],identityReview:[{...decision('unknown','pending'),candidates:['a']}]}),{unknown:'/avatars/profile.jpg'});
  assert.equal(p.processed,2);assert.equal(p.characters.length,2);assert.equal(p.pendingIdentities?.length,1);assert.equal(p.stages[0].characters.length,2);assert.equal(p.stages[0].relations.length,0);
  assert.equal(p.relations[0].source,'unknown');assert.equal(p.pendingIdentities?.[0].statuses?.[0].value,'受伤');
  const before=JSON.stringify(p);
  assert.throws(()=>applyReading(p,pageReading({characters:[person('unknown')],identityReview:[decision('unknown','match','a')],relationChanges:[{...relation,target:'nonexistent'}]})));
  assert.equal(JSON.stringify(p),before);
  const resolving=pageReading({characters:[person('unknown')],identityReview:[decision('unknown','match','a')]});
  assert.equal(resolveIdentities(p,resolving).reading.characters[0].id,'a','提交前裁图也应使用归属后的身份');
  applyReading(p,resolving,{a:'/avatars/latest.jpg'});
  assert.equal(p.characters.length,2);assert.equal(p.characters[0].statuses?.[0].value,'受伤');assert.equal(p.characters[0].references?.[0].page,3);assert.ok(p.appearances?.some(a=>a.page===2&&a.observed.crop));assert.ok(p.characters[0].references?.some(r=>r.page===3));
  assert.equal(p.relations[0].source,'a');assert.equal(p.relations[0].sincePage,2);assert.equal(p.stages[0].relations.length,1);
  assert.equal(p.pages[1].analysis?.identityObservations?.[0].personId,'a');
});

test('明确新人可确认，同页别名可共用身份；本页归属纠正不合并历史档案',()=>{
  const p=project(),subjects=[person('a'),person('alias')];
  const decisions=validateIdentityDecisions(p,subjects,{decisions:[decision('a','new'),decision('alias','match','a')]});
  applyReading(p,pageReading({characters:subjects,identityReview:decisions}));assert.equal(p.characters.length,1);
  applyReading(p,pageReading({characters:[person('b')],identityReview:[decision('b','pending')]}));
  confirmIdentity(p,'b');assert.equal(p.stages[0].characters.length,2);
  applyReading(p,pageReading({characters:[person('b')],identityReview:[decision('b','match','a')]}));
  assert.equal(p.characters.length,2);assert.equal(p.identitySuggestions?.length||0,0);assert.equal(p.identityRedirects?.b,undefined);assert.deepEqual(p.pages[2].analysis?.characterIds,['a']);assert.deepEqual(p.pages[1].analysis?.characterIds,['b']);
});

test('全部旧人物参与候选检索，多图参考有界、按角度更新且保留初次样貌',()=>{
  const p=project();p.characters=Array.from({length:20},(_,i)=>({...person(`c${i}`),name:`角色${i}`,appearance:i===0?'独有的三角耳饰和左眼痣':'戴帽子',firstPage:1}));
  assert.equal(identityCandidates(p,[{...person('query'),name:'陌生人',appearance:'独有的三角耳饰和左眼痣'}],3)[0].id,'c0');
  const c:Character={...person('a'),firstPage:1};
  for(let i=1;i<=12;i++)addReference(c,{url:`/${i}.jpg`,page:i,view:['front','profile','body','other'][i%4]});
  assert.ok(c.references!.length<=4);assert.equal(c.references![0].page,1);assert.ok(c.references!.some(r=>r.page===12));
});

test('沿用旧 ID 仍核对本次出场；无人页不调用复核，拒绝和取消不能被降级绕过',async()=>{
  const p=project();applyReading(p,pageReading({characters:[person('a')]}));
  assert.equal(identitySubjects(p,pageReading({characters:[person('a')]})).length,1);
  const controller=new AbortController(),images=new ReadingImages(p.id,controller.signal,async()=> 'data:image/jpeg;base64,eA==');
  const reading=pageReading({characters:[person('new')]});let calls=0;
  try{
    assert.deepEqual(await reviewIdentities(p,pageReading(),images,controller.signal,async()=>{calls++;return {};}),[]);assert.equal(calls,0);
    const invalid=await reviewIdentities(p,reading,images,controller.signal,async()=>({decisions:[]}));assert.equal(invalid[0].decision,'pending');
    const failed=await reviewIdentities(p,reading,images,controller.signal,async()=>{throw new Error('503');});assert.equal(failed[0].decision,'pending');
    await assert.rejects(reviewIdentities(p,reading,images,controller.signal,async()=>({status:'blocked',reason:'无法安全处理'})),ModelRefusalError);
    controller.abort();await assert.rejects(reviewIdentities(p,reading,images,controller.signal,async()=>({})),/abort/i);
  }finally{images.close();}
});

test('待定界面展示证据、参考图及人工确认入口；人物固定项阻止自动归并',()=>{
  const p=project();applyReading(p,pageReading({characters:[person('a'),person('b')],identityReview:[decision('a','new'),{...decision('b','pending'),candidates:['a']}]}));
  p.corrections=[{kind:'character',id:'manual',page:1,personId:'b',name:'乙',aliases:[],description:'',appearance:'',nameType:'named'}];
  assert.equal(validateIdentityDecisions(p,[person('b')],{decisions:[decision('b','match','a')]})[0].decision,'pending');
  const html=renderToStaticMarkup(createElement(PendingIdentities,{project:p,locked:false,onPage:()=>{},onChoose:()=>{},onConfirm:()=>{},onReview:()=>{}}));
  for(const text of ['暂不进入正式关系图','确认是独立人物','选择对应人物','核对是否为 a'])assert.ok(html.includes(text));
});

test('不同明确姓名不能仅凭视觉相似归并；本次误用旧 ID 可独立建档而不改旧人物',()=>{
  const p=project();applyReading(p,pageReading({characters:[{...person('old','旧人物'),nameType:'named'},person('friend')]}));
  const newcomer={...person('new','另一人物'),nameType:'named' as const};
  const rejected=validateIdentityDecisions(p,[newcomer],{decisions:[decision('new','match','old')]});
  assert.equal(rejected[0].decision,'pending');assert.match(rejected[0].conflicts.join(''),/明确姓名不同/);
  const linked={...decision('new','match','old'),nameLink:'正文明确说明另一人物是旧人物使用的化名'};
  assert.equal(validateIdentityDecisions(p,[newcomer],{decisions:[linked]})[0].decision,'match');
  const mistaken={...person('old','旧人物'),nameType:'named' as const};
  const separate:IdentityDecision={...decision('old','new'),decision:'separate',identity:{name:'另一人物',aliases:[],description:'正文独立出场',appearance:'与旧人物不同的耳饰和发型',nameType:'named'}};
  const checked=validateIdentityDecisions(p,[mistaken],{decisions:[separate]});
  const newId=checked[0].appearanceId!;assert.ok(newId);
  applyReading(p,pageReading({characters:[mistaken],identityReview:checked,relationChanges:[{action:'upsert',source:'old',target:'friend',kind:'team',label:'合作',directed:false,evidence:'本页两人协商'}],turningPoint:{title:'开始合作',reason:'正式确立合作',confidence:1}}),{[newId]:'/new.jpg'});
  assert.equal(p.characters.find(c=>c.id==='old')?.name,'旧人物');assert.equal(p.characters.find(c=>c.id===newId)?.name,'另一人物');
  assert.equal(p.characters.find(c=>c.id===newId)?.identityState,'confirmed');assert.equal(p.relations[0].source,newId);
  assert.equal(p.identityRedirects?.old,undefined);assert.deepEqual(p.pages[0].analysis?.characterIds,['old','friend']);
  assert.deepEqual(p.pages[1].analysis?.characterIds,[newId]);assert.ok(!p.stages[0].characters.some(c=>c.id===newId));
  const correction=validateIdentityDecisions(p,[mistaken],{decisions:[decision('old','match',newId)]});
  assert.equal(correction[0].decision,'match','本页叫错人不等于两个历史姓名是别名');
  applyReading(p,pageReading({characters:[mistaken],identityReview:correction}));
  assert.equal(p.characters.find(c=>c.id==='old')?.name,'旧人物');assert.equal(p.characters.find(c=>c.id===newId)?.name,'另一人物');
  assert.ok(!p.characters.find(c=>c.id===newId)?.aliases.includes('旧人物'));assert.equal(p.identityRedirects?.old,undefined);
  assert.deepEqual(p.pages[2].analysis?.characterIds,[newId]);
});

test('待定人物不与自己竞争；多次出场有历史证据，但次数不能强制确认；单项损坏不连带降级其他人物',()=>{
  const p=project();
  applyReading(p,pageReading({characters:[person('a')],identityReview:[decision('a','pending')]}));
  applyReading(p,pageReading({characters:[person('a')],identityReview:[decision('a','pending')]}));
  assert.equal(identityHistory(p,'a').storyAppearances,2);
  assert.equal(validateIdentityDecisions(p,[person('a')],{decisions:[decision('a','pending')]})[0].decision,'pending');
  const confirm={...decision('a','confirm'),evidence:[{kind:'visual' as const,text:'两页的稳定面部特征对应同一独立出场主体'}]};
  const confirmed=validateIdentityDecisions(p,[person('a')],{decisions:[confirm]});assert.equal(confirmed[0].decision,'confirm');
  applyReading(p,pageReading({characters:[person('a')],identityReview:confirmed}));assert.equal(p.stages[0].characters.length,1);
  const independent=decision('b','new');
  const partial=validateIdentityDecisions(p,[person('a'),person('b')],{decisions:[{id:'a',decision:'broken'},independent]});
  assert.equal(partial[0].decision,'pending');assert.equal(partial[1].decision,'new');
});

test('缺省空候选及单对象包装可兼容；复核接口失败保留可辨别的诊断',async()=>{
  const p=project(),subject=person('a'),controller=new AbortController();
  const accepted=validateIdentityDecisions(p,[subject],{id:'a',decision:'confirm',evidence:[{kind:'visual',text:'清楚的独立出场主体'}]});
  assert.equal(accepted[0].decision,'new');assert.deepEqual(accepted[0].candidates,[]);
  const images=new ReadingImages(p.id,controller.signal,async()=> 'data:image/jpeg;base64,eA==');
  let report:any;
  try{
    const pending=await reviewIdentities(p,pageReading({characters:[subject]}),images,controller.signal,async()=>{throw new Error('DeepSeek 429：请求限流');},'reading',result=>{report=result;});
    assert.equal(report.status,'failed');assert.match(report.issue,/429/);assert.match(pending[0].conflicts.join(''),/429/);
  }finally{images.close();}
});

test('只用已划分且在阅读范围内的封面辅助辨认，不把封面当正文或丢掉实际出场历史',async()=>{
  const p=project();p.pages[0].override='skip';p.pages[0].purpose='cover';
  applyReading(p,pageReading({kind:'cover',characters:[person('coverOnly')]}));assert.equal(p.characters.length,0);
  p.pages[1].override='skip';p.pages[1].purpose='ad';applyReading(p,pageReading({kind:'ad'}));
  applyReading(p,pageReading({characters:[person('a')],identityReview:[decision('a','pending')]}));
  p.pages[6].purpose='cover';p.pages[6].override='skip';
  assert.deepEqual(coverReferencePages(p).map(c=>c.number),[1]);assert.equal(identityHistory(p,'a').storyAppearances,1);
  const controller=new AbortController(),loaded:string[]=[];
  const images=new ReadingImages(p.id,controller.signal,async file=>{loaded.push(file);return 'data:image/jpeg;base64,eA==';});
  try{
    const result=await reviewIdentities(p,pageReading({characters:[{...person('a'),identityConcern:'核对封面参考'}]}),images,controller.signal,async messages=>{
      const content=(messages[1] as {content:any[]}).content;
      assert.ok(content.some(c=>c.text?.includes('封面人物参考 P.1')));
      assert.ok(content.some(c=>c.text?.includes('不提取封面剧情')));
      assert.equal(JSON.parse(content[0].text).subjects[0].storyAppearances,1);
      return {decisions:[{...decision('a','confirm'),evidence:[{kind:'visual',text:'正文中的人脸与既有参考图对应'}]}]};
    });
    assert.equal(result[0].decision,'confirm');assert.ok(!loaded.some(f=>f.endsWith('p1.jpg')||f.endsWith('p6.jpg')));
  }finally{images.close();}
});


test('连续稳定页复用已确认身份；重新登场、姓名疑点与周期检查仍复核旧 ID，待定复核有间隔',()=>{
  const p=project();
  applyReading(p,pageReading({characters:[person('a')],identityReview:[decision('a','new')]}));
  const stable=pageReading({characters:[person('a')]});
  assert.equal(identitySubjects(p,stable).length,0);
  assert.equal(identitySubjects(p,stable,'archive').length,1);
  assert.equal(identitySubjects(p,pageReading({characters:[{...person('a'),identityConcern:'耳饰与旧参考不同'}]})).length,1);
  assert.equal(identitySubjects(p,pageReading({characters:[{...person('a','新姓名'),nameType:'named'}]})).length,1);
  for(let i=0;i<5;i++)applyReading(p,{...stable,...(i===4?{memoryMode:'checkpoint' as const}:{})});
  assert.equal(identitySubjects(p,stable).length,1,'定期复查旧 ID，不能永远跳过');
  const q=project();applyReading(q,pageReading({characters:[person('a')],identityReview:[decision('a','pending')]}));
  assert.equal(identitySubjects(q,stable).length,0);
  applyReading(q,stable);assert.equal(identitySubjects(q,stable).length,0);
  applyReading(q,stable);assert.equal(identitySubjects(q,stable).length,1);
  const r=project();applyReading(r,pageReading({characters:[person('a')],identityReview:[decision('a','new')]}));
  applyReading(r,pageReading());assert.equal(identitySubjects(r,stable).length,1,'重新进入场景的旧人要检查');
});


test('仅身份复核兼容顶层决策数组，不放宽正文 JSON 或猜测损坏内容',()=>{
  const value=JSON.stringify([decision('a','new')]);
  assert.deepEqual(parseIdentityReviewJson(value).output,{decisions:[decision('a','new')]});
  assert.throws(()=>parseModelJson(value),ModelJsonError);
  for(const content of ['', 'null', '"text"', '{"decisions":['])assert.throws(()=>parseIdentityReviewJson(content),ModelJsonError);
});

test('技术失败保留旧人物，不凭空拆出重复档案；新人物仍待定，诊断保留失败类别',async()=>{
  const p=project();applyReading(p,pageReading({characters:[person('a')]}));
  const controller=new AbortController(),images=new ReadingImages(p.id,controller.signal,async()=> 'data:image/jpeg;base64,eA==');
  let report:any;
  try{
    const r=pageReading({characters:[person('a'),person('new')]});
    r.identityReview=await reviewIdentities(p,r,images,controller.signal,async()=>{throw new ModelJsonError('','empty',{failure:'empty',contentCharacters:0});},'reading',value=>{report=value;});
    assert.equal(report.status,'failed');assert.match(report.issue,/empty/);
    assert.deepEqual(r.identityReview.map(d=>d.id),['new']);
    applyReading(p,r);assert.equal(p.characters.length,1);assert.equal(p.characters[0].identityState,undefined);assert.equal(p.pendingIdentities?.[0].identityState,'pending');
    p.pages[1].timing={elapsedMs:1,attempts:1,identityReviewResult:report};
    assert.equal(identitySubjects(p,pageReading({characters:[person('a')]})).length,0);
  }finally{images.close();}
});
