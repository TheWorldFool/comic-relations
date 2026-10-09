import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReading, type Reading } from '../server/analysis.js';
import { parseReadingOutput } from '../server/reading-output.js';
import { readingProtocol } from '../server/reading-prompt.js';
import { identitySubjects, identityReviewContext } from '../server/identity-review.js';
import type { Project } from '../shared/types.js';

const output=(characters:unknown[])=>({kind:'story',confidence:1,reason:'正文',summary:'本页事件',memory:'本页新增事件',memoryMode:'delta',threadChanges:[],storyTime:'',turningPoint:null,characters,relationChanges:[]});
function project():Project{
  const p:Project={id:'test',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'idle',processed:0,memory:'',characters:[],relations:[],stages:[],pages:Array.from({length:10},(_,i)=>({id:`p${i}`,name:`${i}`,image:'',thumbnail:'',width:100,height:100,override:'story'}))};
  applyReading(p,{...output([{id:'a',name:'阿甲',aliases:['小甲'],description:'调查员',nameType:'named',appearance:'左眼痣',avatarBox:null},{id:'b',name:'阿乙',aliases:[],description:'图书管理员',avatarBox:null}]),identityReview:['a','b'].map(id=>({id,decision:'new',target:null,candidates:[],conflicts:[],evidence:[{kind:'distinct',text:'同框独立说话'}]}))} as Reading);
  return p;
}
function parse(p:Project,characters:unknown[],extra:Record<string,unknown>={}):Reading{
  const result=parseReadingOutput({...output(characters),...extra},p);
  assert.ok(result.parsed.success);
  assert.ok(readingProtocol('delta').schema.safeParse(result.parsed.data).success);
  return {...result.parsed.data,inheritedCharacterFields:result.inheritedCharacterFields};
}

test('旧人简写补全档案但不复制当前页观察，保留全部出场、关系与状态增量',()=>{
  const p=project(),before=JSON.stringify(p);
  const input=[{id:'a',presence:'visible',avatarBox:{x:.1,y:.1,width:.3,height:.3},outfit:'雨衣',statusChanges:[{action:'upsert',key:'health',label:'健康',value:'受伤',target:null,certainty:'confirmed',evidence:'手臂有伤口'}]},{id:'b',presence:'visible',avatarBox:null}];
  const original=structuredClone(input);
  const reading=parse(p,input,{relationChanges:[{action:'upsert',source:'a',target:'b',kind:'trust',label:'信任',directed:true,evidence:'交付保管钥匙'}]});
  assert.equal(reading.characters[0].name,'阿甲');assert.deepEqual(reading.characters[0].aliases,['小甲']);
  assert.equal(reading.characters[0].appearance,undefined,'旧外貌不冒充本页观察');
  assert.equal(reading.characters[0].outfit,'雨衣');assert.equal(reading.characters[0].nameType,'named');
  assert.deepEqual(reading.inheritedCharacterFields?.a,['name','aliases','description','nameType']);
  assert.deepEqual(input,original);assert.equal(JSON.stringify(p),before);
  const review=identityReviewContext(p,reading.characters,'reading',reading.inheritedCharacterFields);
  assert.deepEqual(review.subjects[0].inheritedFields,reading.inheritedCharacterFields!.a);
  reading.identityReview=[];applyReading(p,reading);
  assert.equal(p.processed,2);assert.equal(p.characters.length,2);assert.deepEqual(p.pages[1].analysis?.characterIds,['a','b']);
  assert.equal(p.characters[0].statuses?.[0].value,'受伤');assert.equal(p.relations[0].label,'信任');assert.equal(p.characters[0].appearance,'左眼痣');
  assert.equal(p.appearances?.find(a=>a.page===2&&a.characterId==='a')?.observed.appearance,'');
});

test('简写只按已确认的 ID 映射补全；不从同名、sameAs、新同伴或未来档案猜新人资料',()=>{
  const p=project();p.identityRedirects={'approved-old-id':'a'};
  assert.equal(parse(p,[{id:'approved-old-id'}]).characters[0].name,'阿甲');
  const before=JSON.stringify(p);
  for(const people of [[{id:'unknown'}],[{id:'unknown',name:'阿甲'}],[{id:'unknown',sameAs:{id:'a',confidence:1,evidence:'外貌相似'}}],[{id:'unknown',name:'新人物',description:'戴帽子',aliases:[],avatarBox:null},{id:'unknown-2',sameAs:{id:'unknown',confidence:1,evidence:'疑似同一人'}}]]){
    assert.equal(parseReadingOutput(output(people),p).parsed.success,false);
  }
  p.characters.push({id:'future',name:'未来人物',aliases:[],description:'未来档案',firstPage:9});
  assert.equal(parseReadingOutput(output([{id:'future'}]),p).parsed.success,false);
  p.characters.pop();assert.equal(JSON.stringify(p),before);
  assert.equal(parseReadingOutput(output([{id:'a',name:null}]),p).parsed.success,false);
  assert.equal(parseReadingOutput(output([{id:'a',description:45}]),p).parsed.success,false);
  assert.equal(parseReadingOutput({...output([{id:'a'}]),memory:undefined},p).parsed.success,false);
});

test('待定身份仍是待定，模型不能伪造字段来源；显式变化不会被旧档案覆盖',()=>{
  const p=project();p.pendingIdentities=[{id:'pending',name:'戴帽人物',aliases:[],description:'未确认',firstPage:1,identityState:'pending'}];
  const r=parseReadingOutput({...output([{id:'pending'},{id:'a',name:'新名字',aliases:['新别名'],description:'新线索',appearance:'另一外貌'}]),inheritedCharacterFields:{a:['name']}},p);
  assert.ok(r.parsed.success);assert.equal(r.parsed.data.characters[1].name,'新名字');assert.equal(r.parsed.data.characters[1].description,'新线索');
  assert.equal(r.inheritedCharacterFields.a,undefined);assert.equal(p.pendingIdentities[0].identityState,'pending');
  assert.ok(identitySubjects(p,{...r.parsed.data,inheritedCharacterFields:r.inheritedCharacterFields}).some(s=>s.id==='a'));
});

test('纯关系转折不触发稳定旧人全员复核；新人、身份变化、状态转折和周期检查仍检查',()=>{
  const p=project(),turn={turningPoint:{title:'重新合作',reason:'重新建立合作关系',confidence:1},relationChanges:[{action:'upsert',source:'a',target:'b',kind:'team',label:'合作',directed:false,evidence:'双方同意'}]};
  const stable=parse(p,[{id:'a'},{id:'b'}],turn);
  assert.equal(identitySubjects(p,stable).length,0);
  for(const change of [{identityConcern:'侧脸不同'},{name:'另一个名字'},{aliases:['陌生别名']},{description:'身份发生变化'},{appearance:'右眼痣'},{sameAs:{id:'b',confidence:.8,evidence:'外貌接近'}},{statusChanges:[{action:'upsert',key:'health',label:'状态',value:'复活',certainty:'confirmed',evidence:'重新行动',target:null}]}]){
    const reading=parse(p,[{id:'a',...change},{id:'b'}],turn);
    assert.deepEqual(identitySubjects(p,reading).map(s=>s.id),['a']);
  }
  const fresh=parse(p,[{id:'a'},{id:'new',name:'新人',aliases:[],description:'戴眼镜',avatarBox:null}],turn);
  assert.deepEqual(identitySubjects(p,fresh).map(s=>s.id),['new']);
  for(let i=0;i<5;i++)applyReading(p,{...parse(p,[{id:'a'},{id:'b'}]),...(i===4?{memoryMode:'checkpoint' as const}:{}),identityReview:[]});
  assert.equal(identitySubjects(p,parse(p,[{id:'a'},{id:'b'}],turn)).length,2);
});

test('人工核对具体出场可接续短期复核间隔；文本固定不是视觉确认，也不会永久跳过',()=>{
  const p=project();p.pages[0].analysis!.identityObservations=[];
  const a=p.appearances!.find(a=>a.characterId==='a')!;a.verification='manual';
  p.pages[0].analysis!.characterIds=['b']; // stale summary, the occurrence is authoritative
  assert.equal(identitySubjects(p,parse(p,[{id:'a'}])).length,0);
  a.verification='continuity';
  p.corrections=[{id:'fixed',kind:'character',page:1,personId:'a',name:'阿甲',aliases:[],description:'调查员',appearance:'左眼痣',nameType:'named'}];
  assert.equal(identitySubjects(p,parse(p,[{id:'a'}])).length,1);
  a.verification='manual';
  assert.equal(identitySubjects(p,parse(p,[{id:'a',identityConcern:'这次脸部不同'}])).length,1);
  assert.equal(identitySubjects(p,parse(p,[{id:'a'}]),'archive').length,1);
  applyReading(p,parse(p,[]));
  assert.equal(identitySubjects(p,parse(p,[{id:'a'}])).length,1,'重新登场仍复核');
});
