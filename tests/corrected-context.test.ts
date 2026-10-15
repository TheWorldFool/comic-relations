import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReading, type Reading } from '../server/analysis.js';
import { bindAppearances } from '../server/appearances.js';
import { identityHistory } from '../server/identity-context.js';
import { identityReviewContext } from '../server/identity-review.js';
import { readingContext, referenceCharacters } from '../server/reading-request.js';
import { pageIdentityIds } from '../shared/identity-people.js';
import type { Project } from '../shared/types.js';

const person=(id:string)=>({id,name:id,aliases:[],description:'人物',avatarBox:null});
const reading=(characters:Reading['characters']):Reading=>({kind:'story',confidence:1,reason:'正文',summary:'旧称谓 a 与 b 同行',storyTime:'',memory:'旧称谓 a 与 b 同行',memoryMode:'delta',turningPoint:null,characters,relationChanges:[]});
const project=():Project=>({id:'test',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'paused',processed:0,memory:'',characters:[],relations:[],stages:[],pages:Array.from({length:8},(_,i)=>({id:`p${i+1}`,name:String(i+1),image:'',thumbnail:'',width:100,height:100,override:'story'}))});

test('出场校正同时更新初读、复核、出场历史和头像排序，旧摘要保留但明确标记',()=>{
  const p=project();
  applyReading(p,reading([person('a'),person('b'),person('c')]));
  applyReading(p,reading([person('a'),person('b')]));
  bindAppearances(p,[p.appearances!.find(a=>a.page===2&&a.characterId==='a')!.id],'c','第二页实为 c');
  const before=JSON.stringify(p),context=readingContext(p),review=identityReviewContext(p,[person('a'),person('c')],'reading');
  assert.deepEqual(context.recentPages[1].characterIds,['c','b']);
  assert.deepEqual(review.scenes[1].people,['c','b']);
  assert.equal(context.recentPages[1].summary,'旧称谓 a 与 b 同行');
  assert.equal(context.recentPages[0].summaryNeedsReview,false);
  assert.equal(context.recentPages[1].summaryNeedsReview,true);
  assert.deepEqual(review.narrativeReview,context.narrativeReview);
  assert.equal(context.narrativeReview?.fromPage,2);assert.equal(context.narrativeReview?.throughPage,2);
  assert.deepEqual(identityHistory(p,'a').recentAppearances.map(a=>a.page),[1]);
  assert.deepEqual(identityHistory(p,'c').recentAppearances.map(a=>a.page),[1,2]);
  assert.equal(identityHistory(p,'c').recentAppearances[1].summaryNeedsReview,true);
  assert.ok(referenceCharacters(p).findIndex(c=>c.id==='c')<referenceCharacters(p).findIndex(c=>c.id==='a'));
  assert.equal(JSON.stringify(p),before);
  applyReading(p,reading([person('c')]));
  assert.equal(readingContext(p).recentPages.at(-1)?.summaryNeedsReview,false,'新页不误标成旧叙述');
});

test('移出正式身份后上下文只含待定出场，未来或错页记录不进入当前请求',()=>{
  const p=project();applyReading(p,reading([person('a')]));
  bindAppearances(p,[p.appearances![0].id],null,'归属不明');
  const track=p.appearances![0].trackId;
  p.appearances!.push({...structuredClone(p.appearances![0]),id:'future',page:2,pageId:'p2',characterId:'future-person'});
  p.appearances!.push({...structuredClone(p.appearances![0]),id:'wrong-page',page:1,pageId:'p8',characterId:'wrong-person'});
  assert.deepEqual(pageIdentityIds(p,1),[track]);assert.deepEqual(pageIdentityIds(p,2),[]);
  assert.deepEqual(readingContext(p).recentAppearances.map(a=>a.id),[p.appearances![0].id]);
  assert.equal(identityHistory(p,'a').storyAppearances,0);
  assert.deepEqual(identityReviewContext(p,[person(track)],'reading').scenes[0].people,[track]);
});

test('旧项目的局部补录不能吞掉其他人物历史，完整台账的无人页不恢复陈旧 ID',()=>{
  const p=project();applyReading(p,reading([person('a'),person('b')]));
  p.identityBaseline!.throughPage=1;
  p.appearances=p.appearances!.filter(a=>a.characterId==='a');
  assert.deepEqual(pageIdentityIds(p,1),['a','b']);assert.equal(identityHistory(p,'b').storyAppearances,1);
  p.identityBaseline!.throughPage=0;p.appearances=[];
  assert.deepEqual(pageIdentityIds(p,1),[]);assert.equal(identityHistory(p,'b').storyAppearances,0);
  delete p.identityBaseline;delete p.appearances;
  p.identityRedirects={a:'merged'};
  assert.deepEqual(pageIdentityIds(p,1),['merged','b']);assert.equal(identityHistory(p,'merged').storyAppearances,1);
});
