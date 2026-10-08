import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Project, IdentityDecision } from '../shared/types.js';
import { applyReading, resetAnalysis, type Reading } from '../server/analysis.js';
import { bindAppearances, rebuildAppearanceEvidence } from '../server/appearances.js';
import { mergeCharacters } from '../server/identity.js';
import { confirmIdentity } from '../server/identity-state.js';
import { correctProject, unlockCorrection } from '../server/corrections.js';
import { readingContext } from '../server/reading-request.js';
import { identitySubjects } from '../server/identity-review.js';
import { referenceCharacters } from '../server/reading-request.js';
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


test('人工固定期间完整保留模型状态、档案和关系证据；解除固定本地重算且保留其他固定项与历史阶段',()=>{
  const p=project();
  applyReading(p,reading({characters:[{...person('a'),statusChanges:[fact('原状态')]},person('b')],identityReview:[decision('a'),decision('b')],relationChanges:[relation('a','b')]}));
  correctProject(p,{kind:'fact',personId:'a',section:'status',action:'upsert',fact:{...fact('固定状态'),target:undefined,sincePage:1}});
  correctProject(p,{kind:'fact',personId:'a',section:'profile',action:'upsert',fact:{key:'job',label:'职业',value:'人工职业',certainty:'confirmed',evidence:'人工依据',sincePage:1}});
  correctProject(p,{kind:'relation',action:'upsert',relation:{...relation('a','b'),label:'固定关系',sincePage:1}});
  correctProject(p,{kind:'character',personId:'a',name:'人工姓名',aliases:[],appearance:'人工外观',description:'人工描述',nameType:'named'});
  const update=reading({characters:[{...person('a'),statusChanges:[fact('新的健康证据')],profileUpdates:[{...fact('新职业证据'),key:'job',label:'职业'}]},person('b')],identityReview:[],relationChanges:[relation('a','b','remove')]});
  applyReading(p,update);
  const observed=p.appearances!.find(a=>a.page===2&&a.trackId==='a')!;
  assert.equal(observed.observed.name,'a','人工显示姓名不覆盖本页模型观察');
  assert.equal(observed.statusChanges[0].value,'新的健康证据');assert.equal(observed.profileUpdates[0].value,'新职业证据');
  assert.equal(p.appearanceRelations!.at(-1)!.action,'remove');
  assert.equal(p.characters[0].statuses![0].value,'固定状态');assert.equal(p.characters[0].profile![0].value,'人工职业');assert.equal(p.relations[0].label,'固定关系');
  applyReading(p,reading({characters:[{...person('b'),statusChanges:[fact('重大状态')]}],turningPoint:{title:'变化',reason:'状态重大变化',confidence:1},identityReview:[]}));
  const history=JSON.stringify(p.stages[0]),evidence=JSON.stringify([p.appearances,p.appearanceRelations]);
  const health=p.corrections!.find(c=>c.kind==='fact'&&c.section==='status')!;
  unlockCorrection(p,health.id);
  assert.equal(p.characters[0].statuses![0].value,'新的健康证据');assert.equal(p.characters[0].profile![0].value,'人工职业');assert.equal(p.characters[0].name,'人工姓名');
  assert.equal(p.relations[0].label,'固定关系');assert.equal(JSON.stringify(p.stages[0]),history);assert.equal(p.processed,3);
  unlockCorrection(p,p.corrections!.find(c=>c.kind==='relation')!.id);assert.equal(p.relations.length,0);
  unlockCorrection(p,p.corrections!.find(c=>c.kind==='fact')!.id);assert.equal(p.characters[0].profile![0].value,'新职业证据');
  assert.equal(JSON.stringify([p.appearances,p.appearanceRelations]),evidence,'解锁不改原证据');
  const before=JSON.stringify(p);assert.throws(()=>unlockCorrection(p,'absent'));assert.equal(JSON.stringify(p),before);
});

test('撤走全部出场后隐藏当前节点但保留档案，初登场随归属前移、后移及恢复',()=>{
  const p=project();
  applyReading(p,reading({characters:[person('a')],identityReview:[decision('a')]}));
  applyReading(p,reading({characters:[person('b')],identityReview:[decision('b')]}));
  applyReading(p,reading({characters:[person('a')],identityReview:[]}));
  const first=p.appearances![0],last=p.appearances![2];
  bindAppearances(p,[first.id],'b','第一张其实是 b');
  assert.equal(p.characters.find(c=>c.id==='b')!.firstPage,1);assert.equal(p.characters.find(c=>c.id==='a')!.firstPage,3);
  bindAppearances(p,[last.id],'b','第三张也是 b');
  assert.equal(p.characters.length,2);assert.equal(p.characters.find(c=>c.id==='a')!.archived,true);
  assert.deepEqual(p.stages.at(-1)!.characters.map(c=>c.id),['b']);assert.ok(!referenceCharacters(p).some(c=>c.id==='a'));
  assert.equal(identitySubjects(p,reading({characters:[person('a')]})).length,1,'重新识别无依据档案必须复核');
  bindAppearances(p,[first.id],'a','恢复第一张判断');
  assert.equal(p.characters.find(c=>c.id==='a')!.archived,undefined);assert.equal(p.characters.find(c=>c.id==='a')!.firstPage,1);assert.equal(p.characters.find(c=>c.id==='b')!.firstPage,2);
  assert.equal(p.stages.at(-1)!.characters.length,2);
});

test('独立文本证据、人工固定与旧基线保护有依据档案，不以当前缺席或缺少新裁图隐藏人物',()=>{
  const p=project();
  applyReading(p,reading({characters:[person('a'),person('b')],identityReview:[decision('a'),decision('b')]}));
  applyReading(p,reading({characters:[{...person('a'),presence:'mentioned',statusChanges:[fact('独立文本证据')]}],identityReview:[]}));
  bindAppearances(p,[p.appearances![0].id],'b','只校正画面');assert.equal(p.characters.find(c=>c.id==='a')!.archived,undefined);
  const q=project();q.processed=1;q.characters=[{...person('old'),firstPage:1}];
  applyReading(q,reading({characters:[person('new')],identityReview:[decision('new')]}));
  bindAppearances(q,[q.appearances![0].id],'old','确认同一人');assert.equal(q.characters.find(c=>c.id==='old')!.firstPage,1);assert.equal(q.characters.find(c=>c.id==='old')!.archived,undefined);
  assert.equal(q.characters.find(c=>c.id==='new')!.archived,true);
  correctProject(q,{kind:'character',personId:'new',name:'人工确认独立',aliases:[],description:'另有明确证据',appearance:'标志',nameType:'named'});
  assert.equal(q.characters.find(c=>c.id==='new')!.archived,undefined);assert.ok(q.stages.at(-1)!.characters.some(c=>c.id==='new'));
  const r=project();applyReading(r,reading({characters:[person('a')],identityReview:[decision('a')]}));applyReading(r,reading());
  assert.equal(r.characters[0].archived,undefined,'普通缺席不撤销历史出场证据');
});

test('固定期间的新证据仍须校验，损坏引用不能藏在锁定项下写入账本',()=>{
  const p=project();applyReading(p,reading({characters:[person('a')],identityReview:[decision('a')]}));
  correctProject(p,{kind:'fact',personId:'a',section:'status',action:'upsert',fact:{...fact('固定状态'),target:undefined,sincePage:1}});
  const before=JSON.stringify(p);
  assert.throws(()=>applyReading(p,reading({characters:[{...person('a'),statusChanges:[fact('重复一'),fact('重复二')]}],identityReview:[]})),/重复/);
  assert.equal(JSON.stringify(p),before);
});
