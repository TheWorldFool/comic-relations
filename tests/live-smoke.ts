// Optional paid smoke test: npm run test:live. Never part of the offline test suite.
import 'dotenv/config';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import type { Project } from '../shared/types.js';
import type { PageMetrics } from '../server/provider.js';

process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'comic-live-smoke-'));
const { readPage } = await import('../server/provider.js');
const { applyReading } = await import('../server/analysis.js');
const { projectDir } = await import('../server/store.js');
const id = randomUUID(), pageId = randomUUID();
const dir = path.join(projectDir(id), 'images'); await mkdir(dir, {recursive:true});
// An original, deliberately simple comic fixture, not a user manga or a demo project.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1200" viewBox="0 0 1000 1200">
<rect width="1000" height="1200" fill="white"/>
<g stroke="#222" stroke-width="4" fill="none"><rect x="30" y="30" width="940" height="545"/><rect x="30" y="600" width="940" height="570"/>
<ellipse cx="260" cy="125" rx="195" ry="62"/><path d="M260 187 L250 220 L290 190"/>
<ellipse cx="720" cy="125" rx="185" ry="62"/><path d="M720 187 L700 220 L750 188"/>
<circle cx="265" cy="310" r="75"/><path d="M190 300 Q200 160 338 292 M190 310 L182 390 M338 300 L352 390 M220 380 L165 550 L365 550 L305 380"/><circle cx="240" cy="308" r="5"/><circle cx="290" cy="308" r="5"/><path d="M243 345 Q268 365 290 342"/>
<circle cx="720" cy="310" r="75"/><path d="M646 290 L670 230 L705 245 L735 217 L791 284 M675 380 L620 550 L820 550 L765 380"/><circle cx="695" cy="308" r="5"/><circle cx="745" cy="308" r="5"/><path d="M700 345 Q721 365 743 342"/>
<ellipse cx="270" cy="700" rx="210" ry="65"/><ellipse cx="730" cy="700" rx="210" ry="65"/>
<circle cx="270" cy="900" r="75"/><path d="M195 890 Q200 745 344 882 M195 900 L183 980 M345 890 L357 980 M225 970 L170 1140 L370 1140 L310 970 M326 1030 L500 1070"/><circle cx="245" cy="897" r="5"/><circle cx="295" cy="897" r="5"/><path d="M247 935 Q270 955 295 935"/>
<circle cx="730" cy="900" r="75"/><path d="M656 880 L680 820 L715 835 L745 807 L801 874 M685 970 L630 1140 L830 1140 L775 970 M674 1030 L500 1070"/><circle cx="705" cy="897" r="5"/><circle cx="755" cy="897" r="5"/><path d="M707 935 Q730 955 755 935"/>
</g><g fill="#111" font-family="Arial" font-size="31" text-anchor="middle"><text x="260" y="137">My name is Mei.</text><text x="720" y="137">I am Ren.</text><text x="270" y="696">Let's be partners</text><text x="270" y="734">on this journey.</text><text x="730" y="696">Yes, Mei.</text><text x="730" y="734">We're a team now!</text></g></svg>`;
await sharp(Buffer.from(svg)).jpeg({quality:95}).toFile(path.join(dir,`${pageId}.jpg`));
const project: Project = { id,name:'isolated live fixture',createdAt:'',updatedAt:'',direction:'ltr',pages:[{id:pageId,name:'original-test-comic.jpg',image:'',thumbnail:'',width:1000,height:1200,override:'auto'}],characters:[],relations:[],stages:[],memory:'',processed:0,status:'idle' };
const checkpoint=process.argv.includes('--checkpoint');
if(checkpoint){
  // A controlled context fixture for the checkpoint protocol, not a real comic
  // benchmark. Prior pages have no reference images, so only the original
  // two-panel fixture above is sent; the supplied history is deliberately small.
  const prior=Array.from({length:5},(_,i)=>({...project.pages[0],id:randomUUID(),name:`fixture-history-${i+1}.jpg`,override:'story' as const}));
  project.pages=[...prior,project.pages[0]];project.processed=5;
  project.memory='两人准备出发旅行。';
  project.readingMemory={version:1,checkpointPage:0,pending:[
    {page:1,text:'Mei 提议一起旅行。'},
    {page:2,text:'Ren 愿意讨论同行计划。'},
    {page:3,text:'两人尚未决定目的地。'},
    {page:4,text:'Mei 希望正式确认伙伴关系。'},
    {page:5,text:'Ren 准备回应 Mei 的提议。'},
  ],threads:[{id:'destination',text:'旅途目的地尚未确定。',sincePage:3}]};
}
const metrics:PageMetrics={attempts:0,promptTokens:0,completionTokens:0,reasoningTokens:0};
const reading = await readPage(project,new AbortController().signal,metrics);
assert.equal(reading.memoryMode,checkpoint?'checkpoint':'delta');
assert.equal(metrics.attempts,1+(metrics.identityReviewRequests||0),'初读无需格式修正，新增人物另计身份复核请求');
applyReading(project, reading);
assert.equal(reading.kind,'story','真实模型应将原创测试漫画识别为正文');
assert.ok(project.characters.length >= 2,'应识别至少两个人物');
assert.ok(project.relations.length >= 1,'应识别明确的同行伙伴关系');
assert.equal(project.stages.length,1);
if(project.characters.some(c=>c.identityState==='pending'))console.log(JSON.stringify({identityReview:reading.identityReview,reviewResult:metrics.identityReviewResult},null,2));
assert.equal(project.characters.filter(c=>c.identityState==='pending').length,0,'明确的双人场景应完成身份复核');
assert.ok(project.stages[0].characters.length>=2&&project.stages[0].relations.length>=1,'正式图也应包含已确认的人物及关系');
if(checkpoint){
  assert.deepEqual(project.readingMemory?.pending,[]);
  assert.equal(project.readingMemory?.checkpointPage,6);
  assert.ok(project.readingMemory?.threads.some(t=>t.id==='destination'),'没有目的地证据，不能清除未解线索');
}
let continuation:Record<string,unknown>|undefined;
if(process.argv.includes('--identity')){
  const originalIds=project.characters.map(c=>c.id).sort(),nextPageId=randomUUID();
  // Reuse the isolated fixture with the introductions removed; no user project is read.
  const nextSvg=svg.replace('My name is Mei.','Ready to leave?').replace('I am Ren.','Yes, ready.').replace("Let's be partners","Let's keep going").replace('on this journey.','on our journey.').replace('Yes, Mei.','Right behind you.');
  await sharp(Buffer.from(nextSvg)).jpeg({quality:95}).toFile(path.join(dir,`${nextPageId}.jpg`));
  project.pages.push({id:nextPageId,name:'continuation-without-names.jpg',image:'',thumbnail:'',width:1000,height:1200,override:'story'});
  const nextMetrics:PageMetrics={attempts:0,promptTokens:0,completionTokens:0,reasoningTokens:0};
  const next=await readPage(project,new AbortController().signal,nextMetrics);applyReading(project,next);
  assert.deepEqual(project.characters.map(c=>c.id).sort(),originalIds,'去掉姓名后的连续画面应沿用同一组身份');
  assert.equal(project.characters.filter(c=>c.identityState==='pending').length,0);
  continuation={passed:true,attempts:nextMetrics.attempts,identityReviewRequests:nextMetrics.identityReviewRequests||0,modelMs:nextMetrics.modelMs};
}
console.log(JSON.stringify({passed:true,kind:reading.kind,memoryMode:reading.memoryMode,attempts:metrics.attempts,modelMs:metrics.modelMs,characters:project.characters.map(c=>c.name),relations:project.relations.map(r=>r.label),avatarCandidates:reading.characters.filter(c=>c.avatarBox).length,isolatedFixture:true,continuation},null,2));
