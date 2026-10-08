import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Project, ManualAppearanceInput } from '../shared/types.js';
import { applyReading, type Reading } from '../server/analysis.js';
import { correctProject, unlockCorrection } from '../server/corrections.js';
import { rebuildAppearanceEvidence, bindAppearances } from '../server/appearances.js';
import { addManualAppearance } from '../server/manual-appearance.js';
import { mergeCharacters } from '../server/identity.js';
import { reviewSummary, recentReadingSpeed } from '../shared/review-summary.js';
import ReviewSummary from '../src/ReviewSummary.js';
import ManualAppearanceEditor from '../src/ManualAppearanceEditor.js';

const person=(id:string)=>({id,name:id,aliases:[],description:'测试人物',avatarBox:null});
const reading=(extra:Partial<Reading>={}):Reading=>({kind:'story',confidence:1,reason:'正文',summary:'测试事件',storyTime:'',memory:'本页事件',memoryMode:'delta',threadChanges:[],turningPoint:null,characters:[person('a'),person('b')],relationChanges:[],...extra});
const fact=(value:string)=>({key:'health',label:'健康',value,certainty:'confirmed' as const,evidence:'明确证据',sincePage:1});
const relation={source:'a',target:'b',kind:'team',label:'合作',directed:true,evidence:'对白证据',sincePage:1};
const project=():Project=>({id:'test',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'paused',processed:0,memory:'',characters:[],relations:[],stages:[],pages:Array.from({length:5},(_,i)=>({id:`p${i+1}`,name:`${i+1}`,image:'',thumbnail:'',width:100,height:100,override:'story'}))});
const manual=(pageId='p1'):ManualAppearanceInput=>({pageId,characterId:null,name:'戴帽人物',nameType:'descriptive',appearance:'星形帽徽',reason:'左侧框内确有独立人物',box:{x:.1,y:.1,width:.3,height:.4}});

test('一次性状态与关系校正立即生效，重算不丢失，后续剧情能更新且历史阶段不改写',()=>{
  const p=project();applyReading(p,reading({characters:[{...person('a'),statusChanges:[{...fact('误判'),action:'upsert',target:null}]},person('b')],relationChanges:[{...relation,action:'upsert'}]}));
  applyReading(p,reading({characters:[{...person('b'),statusChanges:[{...fact('变化'),action:'upsert',target:null}]}],turningPoint:{title:'转折',reason:'重要变化',confidence:1}}));
  const history=JSON.stringify(p.stages[0]);
  correctProject(p,{scope:'once',kind:'fact',personId:'a',section:'status',action:'upsert',fact:{...fact('伤势未明'),certainty:'uncertain'}});
  correctProject(p,{scope:'once',kind:'relation',action:'remove',relation});
  assert.equal(p.corrections?.length||0,0);assert.equal(p.characters[0].statuses![0].value,'伤势未明');assert.equal(p.relations.length,0);
  rebuildAppearanceEvidence(p);assert.equal(p.characters[0].statuses![0].value,'伤势未明');assert.equal(p.characters[0].statuses![0].sincePage,1);assert.equal(p.relations.length,0);
  applyReading(p,reading({characters:[{...person('a'),statusChanges:[{...fact('康复'),action:'upsert',target:null}]},person('b')],relationChanges:[{...relation,label:'重新合作',action:'upsert'}]}));
  rebuildAppearanceEvidence(p);assert.equal(p.characters[0].statuses![0].value,'康复');assert.equal(p.relations[0].label,'重新合作');assert.equal(JSON.stringify(p.stages[0]),history);
  correctProject(p,{scope:'once',kind:'fact',personId:'a',section:'status',action:'remove',fact:{...fact('撤销误判'),certainty:'uncertain'}});
  rebuildAppearanceEvidence(p);assert.equal(p.characters[0].statuses!.length,0,'人工明确撤销不能被旧结论的确定程度阻止');
});

test('持续固定须显式解除，一次性校正不能偷偷解除锁，旧项目和合并后仍可重算补充证据',()=>{
  const p=project();applyReading(p,reading());delete p.appearances;delete p.identityBaseline;
  correctProject(p,{scope:'once',kind:'fact',personId:'a',section:'profile',action:'upsert',fact:{...fact('记录员'),key:'job'}});
  correctProject(p,{kind:'fact',personId:'a',section:'profile',action:'upsert',fact:{...fact('固定职业'),key:'job'}});
  const before=JSON.stringify(p);
  assert.throws(()=>correctProject(p,{scope:'once',kind:'fact',personId:'a',section:'profile',action:'upsert',fact:{...fact('新职业'),key:'job'}}),/先解除/);assert.equal(JSON.stringify(p),before);
  unlockCorrection(p,p.corrections![0].id);assert.equal(p.characters[0].profile![0].value,'记录员');
  mergeCharacters(p,'a','b');rebuildAppearanceEvidence(p);assert.equal(p.characters[0].profile![0].value,'记录员');
});

test('完全漏识别时可补录人物；重复、未读、附页、无效框原子拒绝，解绑不删除证据',()=>{
  const p=project();applyReading(p,reading({characters:[]}));
  const id=addManualAppearance(p,manual()),added=p.appearances!.find(a=>a.id===id)!;
  assert.equal(p.characters.length,1);assert.equal(p.stages[0].characters.length,1);assert.equal(added.verification,'manual');assert.equal(p.characters[0].firstPage,1);
  const before=JSON.stringify(p);
  for(const bad of [{...manual(),characterId:p.characters[0].id},{...manual('p2')},{...manual(),box:{x:.9,y:0,width:.5,height:.5}}]){assert.throws(()=>addManualAppearance(p,bad));assert.equal(JSON.stringify(p),before);}
  p.pages[0].analysis!.kind='cover';assert.throws(()=>addManualAppearance(p,manual()),/正文/);p.pages[0].analysis!.kind='story';
  bindAppearances(p,[id],null,'暂无法确认独立身份');assert.equal(p.stages[0].characters.length,0);assert.equal(p.appearances!.length,1);assert.equal(p.pendingIdentities!.length,1);
});

test('较早页人工补录不改已结束阶段，能归到已有身份并参与初登场和状态重算',()=>{
  const p=project();applyReading(p,reading({characters:[]}));applyReading(p,reading());
  applyReading(p,reading({characters:[{...person('a'),statusChanges:[{...fact('变化'),action:'upsert',target:null}]}],turningPoint:{title:'转折',reason:'重要变化',confidence:1}}));
  const history=JSON.stringify(p.stages[0]);addManualAppearance(p,{...manual(),characterId:'a'});
  assert.equal(p.characters[0].firstPage,1);assert.equal(JSON.stringify(p.stages[0]),history);
  const newcomer=addManualAppearance(p,manual('p2'));
  const added=p.appearances!.find(a=>a.id===newcomer)!;
  correctProject(p,{scope:'once',kind:'relation',action:'upsert',relation:{...relation,source:added.characterId!,target:'a',sincePage:2}});
  rebuildAppearanceEvidence(p);assert.ok(p.relations.some(r=>r.source===added.characterId&&r.target==='a'));assert.equal(JSON.stringify(p.stages[0]),history);
});

test('主页校对概况兼容新旧待定结构，排除归档头像，耗时仅统计最近十张正文',()=>{
  const p=project();p.processed=2;p.status='completed';p.characters=[{...person('old'),firstPage:1,identityState:'pending'},{...person('archived'),firstPage:1,archived:true}];p.pendingIdentities=[p.characters[0],{...person('new'),firstPage:2,identityState:'pending'}];
  p.pages[0].timing={elapsedMs:1000,attempts:1,identityReviewResult:{status:'failed',checked:0,pending:1}};
  const summary=reviewSummary(p);assert.equal(summary.pending,2);assert.equal(summary.missingPortraits,0);assert.deepEqual(summary.failedPages,[1]);
  const html=renderToStaticMarkup(createElement(ReviewSummary,{project:p,onReview:()=>{},onPage:()=>{}}));assert.match(html,/分析完成/);assert.match(html,/2 位待定人物/);assert.match(html,/P.1/);
  p.pages=Array.from({length:13},(_,i)=>({...p.pages[0],id:String(i),analysis:{kind:i===12?'cover' as const:'story' as const,confidence:1,reason:'',summary:'',storyTime:''},timing:{elapsedMs:i===0||i===12?999999:1000,attempts:1}}));
  assert.equal(recentReadingSpeed(p).samples,10);assert.equal(recentReadingSpeed(p).averageMs,1000);
  assert.match(renderToStaticMarkup(createElement(ManualAppearanceEditor,{project:project(),locked:false,onSave:async()=>{}})),/尚无已读正文页/);
});
