import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReadingOutput, describeReadingIssues, isModelRefusal } from '../server/reading-output.js';

function validOutput() {
  return {kind:'story',confidence:.9,reason:'对白与分格',summary:'两人确认同行',storyTime:'',memory:'两人成为同伴',turningPoint:null,characters:[{id:'a',name:'甲',aliases:[],description:'短发',avatarBox:null},{id:'b',name:'乙',aliases:[],description:'长发',avatarBox:null}],relationChanges:[{action:'upsert',source:'a',target:'b',kind:'affiliation',label:'同伴',directed:false,evidence:'对白中确认一起出发'}]};
}

test('可选元数据缺失及字符串数字布尔值兼容，不改变关系语义或原输出',()=>{
  const output:any=validOutput();output.storyTime=null;output.confidence='0.90';output.characters[0].aliases=null;delete output.characters[1].avatarBox;output.relationChanges[0].directed='false';
  const result=parseReadingOutput(output);assert.ok(result.parsed.success);
  assert.equal(result.parsed.data.storyTime,'');assert.deepEqual(result.parsed.data.characters[0].aliases,[]);assert.equal(result.parsed.data.confidence,.9);assert.equal(result.parsed.data.relationChanges[0].directed,false);assert.equal(result.parsed.data.relationChanges[0].label,'同伴');assert.equal(output.relationChanges[0].directed,'false');
});
test('内容拒绝与普通图像不清晰分开识别',()=>{
  assert.equal(isModelRefusal({kind:'uncertain',reason:'无法分析文字，图片太模糊'}),false);
  assert.equal(isModelRefusal({kind:'uncertain',reason:'无法处理违反内容限制的页面'}),true);
  assert.equal(isModelRefusal({status:'blocked',reason:'不予处理'}),true);
  assert.equal(isModelRefusal('I cannot help with that request.'),true);
  assert.equal(isModelRefusal({kind:'story',summary:'角色拒绝帮助另一方'}),false);
});
test('坏头像框降级为无头像，不阻断有效剧情，不猜测像素或归一化单位',()=>{
  for(const avatarBox of [{x:100,y:100,width:80,height:90},{x:.2,y:.2,width:0,height:.5},{x:.8,y:.1,width:.5,height:.4},[.1,.1,.2,.2],{}]){
    const output:any=validOutput();output.characters[0].avatarBox=avatarBox;
    const result=parseReadingOutput(output);assert.ok(result.parsed.success);assert.equal(result.parsed.data.characters[0].avatarBox,null);assert.equal(result.parsed.data.relationChanges.length,1);assert.ok(result.adjustments.some(a=>a.includes('avatarBox')));
  }
});
test('有效的归一化坐标仍可裁剪',()=>{
  const output:any=validOutput();output.characters[0].avatarBox={x:'0.1',y:'0.2',width:'0.3',height:'0.4'};
  const result=parseReadingOutput(output);assert.ok(result.parsed.success);assert.deepEqual(result.parsed.data.characters[0].avatarBox,{x:.1,y:.2,width:.3,height:.4});
});
test('缺失关键剧情、人物或关系必须纠错，不能用空值静默跳过',()=>{
  for(const field of ['memory','characters','relationChanges','kind','confidence']){
    const output:any=validOutput();delete output[field];const result=parseReadingOutput(output);assert.equal(result.parsed.success,false);
    if(!result.parsed.success)assert.match(describeReadingIssues(result.parsed.error.issues),new RegExp(field));
  }
  for(const confidence of [null,'',true,'90%',90]){const result=parseReadingOutput({...validOutput(),confidence});assert.equal(result.parsed.success,false);}
});
