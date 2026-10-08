import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Project, IdentityDecision } from '../shared/types.js';
import { applyReading, resetAnalysis, type Reading } from '../server/analysis.js';
import { bindAppearances, rebuildAppearanceEvidence } from '../server/appearances.js';
import { mergeCharacters } from '../server/identity.js';
import { confirmIdentity } from '../server/identity-state.js';
import { correctProject } from '../server/corrections.js';
import { readingContext } from '../server/reading-request.js';
import AppearanceManager from '../src/AppearanceManager.js';

const person=(id:string)=>({id,name:id,aliases:[],description:'已知人物',appearance:`${id} 的稳定标志`,nameType:'named' as const,avatarBox:{x:.1,y:.1,width:.2,height:.2}});
const decision=(id:string,pending=false):IdentityDecision=>({id,decision:pending?'pending':'new',target:null,candidates:[],evidence:pending?[]:[{kind:'distinct',text:'可区分的独立人物'}],conflicts:[]});
const reading=(r:Partial<Reading>={}):Reading=>({kind:'story',confidence:1,reason:'正文',summary:'本页事件',storyTime:'',memory:'事件',memoryMode:'delta',threadChanges:[],turningPoint:null,characters:[],relationChanges:[],...r});
const project=():Project=>({id:'test',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'idle',processed:0,memory:'',characters:[],relations:[],stages:[],pages:Array.from({length:5},(_,i)=>({id:`page-${i+1}`,name:`${i+1}`,image:'',thumbnail:'',width:100,height:100,override:'story'}))});
const fact=(value:string,target:string|null=null)=>({action:'upsert' as const,key:target?'attitude':'health',label:target?'态度':'健康',value,target,certainty:'confirmed' as const,evidence:'本页直接证据'});
const relation=(source:string,target:string,action:'upsert'|'remove'='upsert')=>({source,target,action,kind:'team',label:'同伴',directed:false,evidence:'本页协作证据'});

test('出场独立存档；待定不进入人物库和参考图库，换装记录不会覆盖稳定外貌',()=>{
  const p=project();
  applyReading(p,reading({characters:[person('a')],identityReview:[decision('a')]}),{a:'/a1.jpg'});
  applyReading(p,reading({characters:[{...person('a'),appearance:'错误的外貌描述',outfit:'新外套',hairStyle:'扎起头发'},person('u')],identityReview:[decision('u',true)]}),{a:'/a2.jpg',u:'/u2.jpg'});
  assert.equal(p.characters.length,1);assert.equal(p.pendingIdentities?.length,1);assert.equal(p.appearances?.length,3);
  assert.equal(p.appearances?.[2].characterId,null);assert.equal(p.appearances?.[2].observed.crop,'/u2.jpg');
  assert.equal(p.pendingIdentities?.[0].references,undefined);assert.equal(p.characters[0].references?.length,1);
  assert.equal(p.characters[0].appearance,'a 的稳定标志');assert.equal(p.appearances?.[1].observed.outfit,'新外套');
  const context=readingContext(p);assert.equal(context.characters.length,2);assert.ok(context.recentAppearances.some(a=>a.outfit==='新外套'&&!a.referenceApproved));
});

test('只纠正选中出场，关系与有向状态随证据移动，后续状态和旧阶段不被改写',()=>{
  const p=project();
  applyReading(p,reading({characters:[person('a'),person('b'),person('c')],identityReview:['a','b','c'].map(id=>decision(id))}));
  applyReading(p,reading({characters:[{...person('a'),statusChanges:[fact('受伤'),fact('信任','b')]},person('b')],identityReview:[],relationChanges:[relation('a','b')]}),{a:'/a2.jpg'});
  applyReading(p,reading({characters:[{...person('a'),statusChanges:[fact('康复')]}],identityReview:[],turningPoint:{title:'康复',reason:'恢复行动',confidence:1}}));
  const early=JSON.stringify(p.stages[0]),memory=p.memory,pageBefore=JSON.stringify(p.pages[1].analysis);
  const a=p.appearances!.find(a=>a.page===2&&a.trackId==='a')!;
  bindAppearances(p,[a.id],'c','本页应为 c，核对明确标志');
  assert.equal(p.appearances!.find(x=>x.id===a.id)!.characterId,'c');assert.equal(p.appearances!.find(x=>x.page===3)!.characterId,'a');
  assert.equal(p.characters.find(c=>c.id==='a')!.statuses?.find(f=>f.key==='health')?.value,'康复');
  assert.equal(p.characters.find(c=>c.id==='c')!.statuses?.find(f=>f.key==='health')?.value,'受伤');
  assert.equal(p.characters.find(c=>c.id==='c')!.statuses?.find(f=>f.target==='b')?.value,'信任');
  assert.equal(p.relations[0].source,'c');assert.equal(p.relations[0].sourceAppearanceId,a.id);
  assert.equal(JSON.stringify(p.stages[0]),early);assert.equal(p.memory,memory);assert.equal(JSON.stringify(p.pages[1].analysis),pageBefore);
  assert.equal(p.processed,3);assert.equal(p.identityRedirects?.a,undefined);assert.equal(readingContext(p).appearanceCorrections[0].characterId,'c');
  assert.equal(p.characters.find(c=>c.id==='c')!.avatar,'/a2.jpg');
  bindAppearances(p,[a.id],'a','撤回校正');assert.equal(p.relations[0].source,'a');assert.equal(p.characters.find(c=>c.id==='c')!.avatar,undefined);
});

test('单次出场可解除绑定或独立建档，不把其事实重新写回旧身份',()=>{
  const p=project();applyReading(p,reading({characters:[person('a'),person('b')],identityReview:['a','b'].map(id=>decision(id)),relationChanges:[relation('a','b')]}));
  const a=p.appearances![0];bindAppearances(p,[a.id],null,'暂无法判断身份');
  assert.equal(p.appearances![0].characterId,null);assert.ok(p.relations[0].source.startsWith('pending_'));assert.equal(p.stages[0].relations.length,0);
  assert.equal(p.characters.length,2);assert.equal(p.pendingIdentities?.length,1);
  bindAppearances(p,[a.id],null,'这是独立出场的人物','新人物');
  const newId=p.appearances![0].characterId!;
  assert.ok(newId.startsWith('person_'));assert.equal(p.relations[0].source,newId);assert.equal(p.stages[0].baselineRelations?.[0].source,newId);assert.equal(p.pendingIdentities?.length,0);assert.equal(p.characters.find(c=>c.id==='a')!.name,'a');
});

test('删除关系事件也随出场重新归属；同人端点消除，人工固定事实优先',()=>{
  const p=project();applyReading(p,reading({characters:['a','b','c'].map(person),identityReview:['a','b','c'].map(id=>decision(id)),relationChanges:[relation('a','b')]}));
  applyReading(p,reading({characters:[person('a'),person('b')],identityReview:[],relationChanges:[relation('a','b','remove')]}));
  const a=p.appearances!.find(a=>a.page===2&&a.trackId==='a')!;assert.equal(p.relations.length,0);
  bindAppearances(p,[a.id],'c','解除关系的其实是另一人');assert.equal(p.relations[0].source,'a');
  correctProject(p,{kind:'fact',personId:'c',section:'status',action:'upsert',fact:{...fact('固定健康状态'),target:undefined,sincePage:1}});
  rebuildAppearanceEvidence(p);assert.equal(p.characters.find(c=>c.id==='c')!.statuses?.[0].value,'固定健康状态');
  bindAppearances(p,[p.appearances![0].id],'b','第一条关系两端实际是同一人');assert.equal(p.relations.length,0);
});

test('旧项目以当前结果为基线，缺失的历史出场不捏造；错误输入原子拒绝',()=>{
  const p=project();p.processed=1;p.characters=[{...person('old'),firstPage:1,statuses:[{...fact('旧状态'),target:undefined,sincePage:1}]}];
  applyReading(p,reading({characters:[person('new')],identityReview:[decision('new')]}));
  assert.equal(p.identityBaseline?.throughPage,1);assert.equal(p.appearances?.length,1);assert.equal(p.appearances?.[0].page,2);
  const before=JSON.stringify(p);
  for(const [ids,target] of [[['missing'],'old'],[[p.appearances![0].id],'missing']] as [string[],string][]){assert.throws(()=>bindAppearances(p,ids,target,'校正'));assert.equal(JSON.stringify(p),before);}
  bindAppearances(p,[p.appearances![0].id],'old','后续确认同一人');assert.equal(p.characters.find(c=>c.id==='old')!.statuses?.[0].value,'旧状态');
  resetAnalysis(p);assert.equal(p.appearances,undefined);assert.equal(p.identityBaseline,undefined);assert.equal(p.pendingIdentities,undefined);
});

test('AI 确认整组待定不自动批准所有历史裁图；人工逐次核对才进入参考库',()=>{
  const p=project();applyReading(p,reading({characters:[person('u')],identityReview:[decision('u',true)]}),{u:'/uncertain.jpg'});
  confirmIdentity(p,'u','AI 确认独立身份','model');assert.equal(p.characters[0].references?.length||0,0);assert.equal(p.appearances![0].verification,'continuity');
  bindAppearances(p,[p.appearances![0].id],'u','人工确认这张裁图');assert.equal(p.characters[0].references?.[0].url,'/uncertain.jpg');
});

test('全局合并后再做逐次校正，不会从旧基线复活已合并身份',()=>{
  const p=project();p.processed=1;p.characters=['a','b','c'].map(id=>({...person(id),firstPage:1}));p.relations=[{...relation('a','c'),sincePage:1}];
  applyReading(p,reading({characters:[person('a'),person('b')],identityReview:[],relationChanges:[relation('a','b')]}));
  mergeCharacters(p,'a','b');assert.ok(!p.identityBaseline!.characters.some(c=>c.id==='a'));
  bindAppearances(p,[p.appearances![0].id],'c','仅这次出场另有归属');assert.ok(!p.characters.some(c=>c.id==='a'));assert.ok(p.relations.every(r=>r.source!=='a'&&r.target!=='a'));
});

test('出场校对界面展示定位、核对状态和独立归属入口，旧项目说明数据范围',()=>{
  const p=project();const props={project:p,locked:false,onPage:()=>{},onBind:async()=>{}};
  assert.match(renderToStaticMarkup(createElement(AppearanceManager,props)),/不会自动补造/);
  applyReading(p,reading({characters:[person('a')],identityReview:[decision('a',true)]}),{a:'/crop.jpg'});
  const html=renderToStaticMarkup(createElement(AppearanceManager,props));
  for(const value of ['初读称呼','身份待定','新建独立人物','暂时待定','保存所选出场归属','归属记录'])assert.ok(html.includes(value));
});


test('仅提及的已知人物状态保留为文本证据，出场重算不丢失也不虚构其出场',()=>{
  const p=project();applyReading(p,reading({characters:[person('a'),person('b')],identityReview:[decision('a'),decision('b')]}));
  applyReading(p,reading({characters:[person('a'),{...person('b'),presence:'mentioned',statusChanges:[fact('据报受伤')]}],identityReview:[]}));
  assert.equal(p.appearances!.filter(a=>a.page===2).length,1);assert.equal(p.appearanceFacts!.length,1);
  bindAppearances(p,[p.appearances!.find(a=>a.page===2)!.id],'b','纠正画面人物');
  assert.equal(p.characters.find(c=>c.id==='b')!.statuses?.[0].value,'据报受伤');
});


test('只移动画面出场，不会悄悄丢弃该临时身份另外被提及时留下的证据',()=>{
  const p=project();applyReading(p,reading({characters:[person('a'),person('u')],identityReview:[decision('a'),decision('u',true)]}));
  applyReading(p,reading({characters:[{...person('u'),presence:'mentioned',statusChanges:[fact('去向未明')]}],identityReview:[]}));
  bindAppearances(p,[p.appearances!.find(a=>a.trackId==='u')!.id],'a','只确认这次画面');
  assert.equal(p.pendingIdentities?.find(c=>c.id==='u')?.statuses?.[0].value,'去向未明');
});
