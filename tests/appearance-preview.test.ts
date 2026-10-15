import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReading, type Reading } from '../server/analysis.js';
import { bindAppearances } from '../server/appearances.js';
import { previewAppearanceBinding, appearancePreviewToken } from '../server/appearance-preview.js';
import type { Project } from '../shared/types.js';

function fixture(){
  const project:Project={id:'test',name:'预览',createdAt:'',updatedAt:'1',direction:'ltr',status:'completed',processed:0,memory:'',characters:[],relations:[],stages:[],pages:[1,2].map(n=>({id:`p${n}`,name:String(n),image:'',thumbnail:'',width:100,height:100,override:'story'}))};
  const reading:Reading={kind:'story',confidence:1,reason:'正文',summary:'共同调查',storyTime:'',memory:'保留前文',memoryMode:'delta',threadChanges:[],turningPoint:null,characters:['甲','乙','丙'].map((name,i)=>({id:`c${i}`,name,aliases:[],description:'测试人物',avatarBox:null,...(i===0?{statusChanges:[{key:'health',label:'健康',value:'受伤',action:'upsert' as const,certainty:'confirmed' as const,target:null,evidence:'绷带'}]}:{})})),relationChanges:[{action:'upsert',source:'c0',target:'c1',kind:'team',label:'同伴',directed:false,evidence:'共同调查'}]};
  applyReading(project,reading);
  return project;
}
test('预览使用实际重算逻辑而不修改数据，列出移动的关系与状态',()=>{
  const p=fixture(),before=JSON.stringify(p),input={ids:[p.appearances![0].id],characterId:'c2',reason:'此处应为丙'};
  const preview=previewAppearanceBinding(p,input);
  assert.equal(JSON.stringify(p),before);assert.deepEqual(preview.pages,[1]);assert.equal(preview.selected,1);
  assert.ok(preview.changes.some(c=>c.kind==='状态'&&c.before?.includes('甲')&&c.before.includes('受伤')));
  assert.ok(preview.changes.some(c=>c.kind==='状态'&&c.after?.includes('丙')&&c.after.includes('受伤')));
  assert.ok(preview.changes.some(c=>c.kind==='关系'&&c.after?.includes('丙')&&c.after.includes('乙')));
  bindAppearances(p,input.ids,input.characterId,input.reason);
  assert.equal(p.relations[0].source,'c2');assert.equal(p.characters.find(c=>c.id==='c2')?.statuses?.[0].value,'受伤');
  assert.equal(p.processed,1);assert.equal(p.memory,'');
});
test('新建或解除身份仅预演；无效出场拒绝，快照或请求改变使预览凭据失效',()=>{
  const p=fixture(),before=JSON.stringify(p),input={ids:[p.appearances![0].id],characterId:null,reason:'独立人物',newName:'丁'};
  const preview=previewAppearanceBinding(p,input);
  assert.ok(preview.changes.some(c=>c.kind==='人物'&&c.after?.includes('丁')));
  assert.equal(JSON.stringify(p),before);assert.equal(preview.token,appearancePreviewToken(p,input));
  assert.notEqual(preview.token,appearancePreviewToken({...p,updatedAt:'2'},input));
  assert.notEqual(preview.token,appearancePreviewToken(p,{...input,newName:'戊'}));
  const detached=previewAppearanceBinding(p,{...input,newName:undefined});
  assert.ok(detached.changes.some(c=>c.after?.includes('待定')));
  assert.throws(()=>previewAppearanceBinding(p,{...input,ids:['missing']}));assert.equal(JSON.stringify(p),before);
});
