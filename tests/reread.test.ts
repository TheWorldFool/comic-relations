import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyReading, resetAnalysis, type Reading } from '../server/analysis.js';
import { correctProject, unlockCorrection } from '../server/corrections.js';
import { bindAppearances } from '../server/appearances.js';
import { saveReadingCheckpoint, previewReread, prepareReread, restoreReread, originalReread, dueRereadItems, assertRereadReady, resolveRereadItem, finishReread, preservedEdits } from '../server/reread.js';
import { readingContext } from '../server/reading-request.js';
import { rereadPageHints } from '../shared/reread.js';
import type { Project } from '../shared/types.js';

const person=(id:string)=>({id,name:id,aliases:[],description:'人物',avatarBox:null});
const reading=(page:number):Reading=>({kind:'story',confidence:1,reason:'正文',summary:`事件 ${page}`,storyTime:'',memory:`记忆 ${page}`,memoryMode:'delta',threadChanges:page===1?[{action:'upsert',id:'promise',text:'未完成的约定'}]:[],turningPoint:null,characters:[person('a'),person('b')],relationChanges:[]});
const project=():Project=>({id:'test',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'paused',processed:0,memory:'',characters:[],relations:[],stages:[],pages:[1,2,3,4].map(n=>({id:`p${n}`,name:String(n),image:'',thumbnail:'',width:100,height:100,override:'story',purpose:'story'}))});
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){const dir=await mkdtemp(path.join(os.tmpdir(),'comic-reread-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('指定页重读恢复完整前文，校正按证据页保留、提示及暂停；失败后可恢复并保留用量',async t=>{
  const dir=await fixture(t),p=project();
  await saveReadingCheckpoint(p,dir);applyReading(p,reading(1));
  await saveReadingCheckpoint(p,dir);const prefix=structuredClone(p);applyReading(p,reading(2));
  await saveReadingCheckpoint(p,dir);applyReading(p,reading(3));
  correctProject(p,{scope:'fixed',kind:'fact',personId:'a',section:'status',action:'upsert',fact:{key:'health',label:'健康',value:'受伤',certainty:'confirmed',evidence:'第 2 页画面',sincePage:2}});
  correctProject(p,{scope:'once',kind:'character',personId:'b',name:'乙',aliases:[],description:'人工核对的身份',appearance:'短发',nameType:'named'});
  p.pages[2].timing={elapsedMs:10,attempts:1};
  const before=JSON.stringify(p),preview=await previewReread(p,2,dir);
  assert.equal(JSON.stringify(p),before);assert.equal(preview.items.length,2);assert.equal(preview.available,true);
  const next=await prepareReread(p,2,preview.token,dir);
  assert.equal(JSON.stringify(p),before);assert.equal(next.processed,1);assert.equal(next.status,'paused');
  assert.deepEqual(next.characters,JSON.parse(JSON.stringify(prefix.characters)));assert.deepEqual(next.stages,JSON.parse(JSON.stringify(prefix.stages)));assert.deepEqual(next.readingMemory,prefix.readingMemory);
  assert.equal(next.pages[1].analysis,undefined);assert.equal(next.pages[2].timing,undefined);assert.equal(next.corrections,undefined);
  assert.equal(next.readingRuns?.length,1);assert.equal(dueRereadItems(next).length,1,'较早身份编辑必须先核对');
  assert.throws(()=>assertRereadReady(next),/核对/);assert.throws(()=>resetAnalysis(next),/重读/);
  const early=dueRereadItems(next)[0];resolveRereadItem(next,early.id);assert.doesNotThrow(()=>assertRereadReady(next));
  assert.equal(readingContext(next).rereadHints?.[0].title,'a · 健康：受伤');
  assert.equal(next.characters.find(c=>c.id==='b')?.name,'b','标记已核对不会偷偷应用旧 ID');
  assert.throws(()=>resolveRereadItem(next,next.reread!.items.find(i=>i.page===2)!.id),/证据页/);
  applyReading(next,reading(2));assert.equal(dueRereadItems(next).length,1);
  const continued=JSON.parse(JSON.stringify(next)) as Project;
  assert.equal(dueRereadItems(continued).length,1,'刷新和服务重启后仍保留核对队列');
  const original=await originalReread(next,dir);assert.equal(original.processed,3);assert.equal(original.characters.find(c=>c.id==='b')?.name,'乙');
  next.readingRuns!.push({...next.readingRuns![0],id:'retry',outcome:'error',attempts:2});next.status='error';
  const restored=await restoreReread(next,dir);
  assert.deepEqual(restored.characters,JSON.parse(JSON.stringify(p.characters)));assert.deepEqual(restored.stages,JSON.parse(JSON.stringify(p.stages)));assert.deepEqual(restored.corrections,p.corrections);
  assert.equal(restored.readingRuns!.length,2);assert.equal(restored.reread,undefined);
  assert.throws(()=>finishReread(next),/读完/);
  resolveRereadItem(next,next.reread!.items.find(i=>!i.resolved)!.id);applyReading(next,reading(3));finishReread(next);assert.equal(next.reread,undefined);
});

test('旧项目只能选择真实可用起点；过期预览、错页和损坏恢复点不修改现有项目',async t=>{
  const dir=await fixture(t),p=project();applyReading(p,reading(1));applyReading(p,reading(2));
  const unavailable=await previewReread(p,2,dir);assert.equal(unavailable.available,false);assert.deepEqual(unavailable.availableFromPages,[1]);
  await assert.rejects(prepareReread(p,2,unavailable.token,dir),/没有完整/);
  const fresh=await previewReread(p,1,dir);p.name='改过名字';await assert.rejects(prepareReread(p,1,fresh.token,dir),/项目已经变化/);
  const restart=await prepareReread(p,1,(await previewReread(p,1,dir)).token,dir);assert.equal(restart.processed,0);assert.deepEqual(restart.characters,[]);assert.equal(restart.memory,'');
  await saveReadingCheckpoint(p,dir);applyReading(p,reading(3));
  const before=JSON.stringify(p);p.pages[0].purpose='cover';await assert.rejects(previewReread(p,3,dir),/用途/);p.pages[0].purpose='story';
  const entry=p.readingCheckpoints![0];await writeFile(path.join(dir,'reading-history',`${entry.id}.json`),'{}');
  await assert.rejects(previewReread(p,3,dir),/校验失败/);assert.equal(JSON.stringify(p),before);
});

test('人工出场、解除固定和手工头像保留为核对项；后页校正不提前进入模型',async t=>{
  const p=project();applyReading(p,reading(1));
  correctProject(p,{kind:'character',scope:'fixed',personId:'a',name:'甲',aliases:[],description:'',appearance:'',nameType:'named'});
  const prefix=structuredClone(p);unlockCorrection(p,p.corrections![0].id);
  applyReading(p,reading(2));bindAppearances(p,[p.appearances!.find(a=>a.page===2&&a.characterId==='b')!.id],'a','同一人');
  p.characters[0].references=[{url:'/manual.jpg',page:2,view:'manual'}];
  const items=preservedEdits(p,prefix);
  assert.ok(items.some(i=>i.kind==='固定项已变更'));assert.ok(items.some(i=>i.kind==='出场归属'));assert.ok(items.some(i=>i.kind==='手动头像'));
  const next=structuredClone(prefix);next.reread={id:'session',backupHash:'',fromPage:2,previousProcessed:2,createdAt:'',items};
  assert.ok(rereadPageHints(next)?.every(i=>i.kind!=='固定项已变更'));
  next.processed=0;assert.ok(rereadPageHints(next)?.every(i=>i.kind!=='出场归属'));
  const dir=await fixture(t);await saveReadingCheckpoint(prefix,dir);applyReading(prefix,reading(2));
  const preview=await previewReread(prefix,2,dir);const replay=await prepareReread(prefix,2,preview.token,dir);
  assert.equal(replay.reread?.items.length,0,'恢复点中已经生效的人工固定不重复核对');
  assert.equal(replay.corrections?.length,1);
});
