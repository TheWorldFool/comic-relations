import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateRequestImages } from '../server/request-images.js';

test('同一请求内复用完全相同图片，保留不同人物的标签、顺序与证据',()=>{
  const image={type:'image_url',image_url:{url:'data:image/jpeg;base64,YQ=='}};
  const content=[{type:'text',text:'当前页'},image,{type:'text',text:'甲初次出场页，需核对脸部'},image,{type:'text',text:'乙初次出场页，同页不同人物'},image];
  const before=structuredClone(content),result=deduplicateRequestImages(content) as typeof content;
  assert.equal(result.filter(c=>c.type==='image_url').length,1);
  const text=result.filter(c=>c.type==='text').map(c=>'text' in c?c.text:'').join('\n');
  assert.match(text,/甲初次出场页/);assert.match(text,/乙初次出场页/);
  assert.equal(text.match(/前面的图像 1/g)?.length,2);
  assert.deepEqual(content,before);
  assert.deepEqual(deduplicateRequestImages([image]),[image],'不跨页缓存模型判断；无重复图片时不添加额外指令');
});

test('不同画面、不同清晰度参数不折叠，不移除任何非图片内容',()=>{
  const images=[
    {type:'image_url',image_url:{url:'original',detail:'high'}},
    {type:'image_url',image_url:{url:'original',detail:'low'}},
    {type:'image_url',image_url:{url:'different-crop',detail:'high'}},
  ];
  const rest=[null,{type:'text',text:'人工证据'}, {type:'image_url',image_url:{}}];
  const result=deduplicateRequestImages([...images,...rest]);
  for(const image of images)assert.ok(result.includes(image));
  assert.deepEqual(result.slice(-3),rest);
});
