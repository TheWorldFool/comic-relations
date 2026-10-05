import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyReading, type Reading } from '../server/analysis.js';
import { parseReadingOutput } from '../server/reading-output.js';
import CharacterDossier from '../src/CharacterDossier.js';
import { stateSummaries } from '../src/character-display.js';
import type { Project, Character } from '../shared/types.js';

const person=(id='a')=>({id,name:id==='a'?'小甲':'小乙',aliases:[],description:'调查员',avatarBox:null});
const fact=(value='存活')=>({action:'upsert' as const,key:'life',label:'生存',value,certainty:'confirmed' as const,evidence:'画面与对白明确确认',target:null});
const reading=(updates:Partial<Reading>={}):Reading=>({kind:'story',confidence:.95,reason:'正文',summary:'推进剧情',storyTime:'',memory:'累计记忆',turningPoint:null,characters:[],relationChanges:[],...updates});
const project=():Project=>({id:'test',name:'测试',createdAt:'',updatedAt:'',direction:'ltr',pages:Array.from({length:12},(_,i)=>({id:`p${i}`,name:`${i}.jpg`,image:'',thumbnail:'',width:100,height:100,override:'auto'})),characters:[],relations:[],stages:[],memory:'',processed:0,status:'idle'});

test('自定义档案和有向状态增量保存、去重，不因缺席或未返回新字段丢失',()=>{
  const p=project();
  applyReading(p,reading({characters:[{...person(),profileUpdates:[{...fact('调查员'),key:'occupation',label:'职业'}],statusChanges:[fact(),{...fact('信任'),key:'trust',label:'信任程度',target:'b'}]},person('b')]}));
  assert.equal(p.characters[0].profile![0].value,'调查员');assert.equal(p.characters[0].statuses!.length,2);
  assert.equal(p.characters[1].statuses!.length,0,'不反推对方态度');
  applyReading(p,reading({characters:[{...person(),statusChanges:[fact()]}]}));
  applyReading(p,reading({characters:[person()]}));
  assert.equal(p.characters[0].records!.length,3);assert.equal(p.characters[0].statuses![0].sincePage,1);assert.equal(p.characters[0].statuses![1].target,'b');
  assert.equal(p.stages.length,1);
  assert.ok(stateSummaries(p.characters[0],p.characters).some(s=>s.text.includes('对小乙')));
});

test('日常状态更新不分阶段，重大确认状态转折创建独立快照且旧档案不被后文改写',()=>{
  const p=project();applyReading(p,reading({characters:[{...person(),statusChanges:[fact()]}]}));
  applyReading(p,reading({characters:[{...person(),statusChanges:[{...fact('受伤'),key:'health',label:'健康'}]}]}));assert.equal(p.stages.length,1);
  const before=structuredClone(p.stages[0]);
  const turningPoint={title:'调查员牺牲',reason:'确认死亡，主线调查由同伴接手',confidence:.96};
  applyReading(p,reading({characters:[{...person(),statusChanges:[fact('死亡')]}],turningPoint}));
  assert.equal(p.stages.length,2);assert.deepEqual(p.stages[0],before);assert.equal(p.stages[1].characters[0].statuses![0].value,'死亡');
  assert.equal(p.stages[1].baselineStatuses![0].statuses![0].value,'死亡');
  applyReading(p,reading({characters:[{...person(),statusChanges:[fact('死亡')]}],turningPoint}));assert.equal(p.stages.length,2);
});

test('存疑线索不覆盖已确认事实、不触发转折；明确撤销保留记录；非正文不改档案',()=>{
  const p=project();applyReading(p,reading({characters:[{...person(),statusChanges:[fact()]}]}));
  applyReading(p,reading({characters:[{...person(),statusChanges:[{...fact('死亡'),certainty:'uncertain'}]}],turningPoint:{title:'传言',reason:'有人猜测',confidence:.99}}));
  assert.equal(p.characters[0].statuses![0].value,'存活');assert.equal(p.characters[0].records![1].certainty,'uncertain');assert.equal(p.stages.length,1);
  applyReading(p,reading({characters:[{...person(),statusChanges:[{...fact('死亡'),certainty:'uncertain'}]}]}));
  assert.equal(p.characters[0].records!.length,2,'重复线索不重复追加');
  const old=structuredClone(p.characters);
  applyReading(p,reading({kind:'ad',characters:[{...person(),statusChanges:[fact('死亡')]}]}));assert.deepEqual(p.characters,old);
  applyReading(p,reading({characters:[{...person(),statusChanges:[{...fact(),action:'remove',evidence:'此前画面被确认是幻象'}]}]}));
  assert.equal(p.characters[0].statuses!.length,0);assert.equal(p.characters[0].records!.at(-1)!.action,'remove');
});

test('无效状态目标及重复维度整页拒绝提交；旧输出兼容，新字段损坏不能静默忽略',()=>{
  for(const statuses of [[{...fact(),target:'unknown'}],[fact(),fact('死亡')]]){
    const p=project(),before=JSON.stringify(p);
    assert.throws(()=>applyReading(p,reading({characters:[{...person(),statusChanges:statuses}]})));
    assert.equal(JSON.stringify(p),before);
  }
  assert.equal(parseReadingOutput(reading({characters:[person()]})).parsed.success,true);
  assert.equal(parseReadingOutput(reading({characters:[{...person(),statusChanges:[fact()]}]})).parsed.success,true);
  const invalid:any=reading({characters:[person()]});invalid.characters[0].statusChanges=[{...fact(),evidence:''}];
  assert.equal(parseReadingOutput(invalid).parsed.success,false);
});

test('人物档案显示当前状态、单向对象、不确定性和证据页；旧数据不杜撰状态',()=>{
  const p=project();applyReading(p,reading({characters:[{...person(),statusChanges:[{...fact('有好感'),key:'affection',label:'好感',target:'b',certainty:'uncertain'}]},person('b')]}));
  const render=(c:Character)=>renderToStaticMarkup(createElement(CharacterDossier,{people:p.characters,person:c,toPage:1,onSelect:()=>{},onClear:()=>{},onPage:()=>{},onCrop:()=>{},canCrop:true}));
  const html=render(p.characters[0]);for(const text of ['对小乙','有好感','待确认','P.1','变化与线索记录','截至第 1 页'])assert.ok(html.includes(text));
  const legacy=render({...person(),firstPage:1});assert.match(legacy,/尚未提取状态/);assert.doesNotMatch(legacy,/存活|死亡/);
});
