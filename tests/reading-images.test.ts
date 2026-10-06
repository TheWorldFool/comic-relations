import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ReadingImages } from '../server/reading-images.js';
import type { Project } from '../shared/types.js';

const project=():Project=>({id:'00000000-0000-0000-0000-000000000001',name:'test',createdAt:'',updatedAt:'',direction:'ltr',status:'running',processed:0,memory:'',characters:[],relations:[],stages:[],pages:Array.from({length:4},(_,i)=>({id:`p${i}`,name:`${i}.jpg`,image:'',thumbnail:'',width:100,height:100,override:i===1?'skip':'story'}))});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('图片预取有界且跳过附页，共用正在进行的编码；不读取未来剧情、不修改项目',async()=>{
  const p=project(),before=JSON.stringify(p),calls:string[]=[];
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const images=new ReadingImages(p.id,new AbortController().signal,async(file,variant)=>{
    calls.push(`${path.basename(file)}:${variant}`);await gate;return `image:${file}:${variant}`;
  });
  try{
    images.prefetch(p);await tick();
    assert.deepEqual(calls,['p0.jpg:reference','p2.jpg:page']);
    const waiting=images.page(p.pages[2]);await tick();assert.equal(calls.length,2);
    release();assert.match((await waiting)!,/p2\.jpg/);
    await images.page(p.pages[2]);assert.equal(calls.length,2,'预取完成后继续复用');
    assert.equal(JSON.stringify(p),before);
  }finally{release();images.close();}
});

test('预取失败不产生未处理拒绝，不阻塞当前页，真正到达失败页时可以重新准备',async()=>{
  const p=project();let fail=true,nextCalls=0;
  const images=new ReadingImages(p.id,new AbortController().signal,async file=>{
    if(file.endsWith('p2.jpg')){nextCalls++;if(fail)throw new Error('temporary');}
    return 'image';
  });
  try{
    images.prefetch(p);await tick();
    assert.equal(await images.page(p.pages[0]),'image');
    fail=false;assert.equal(await images.page(p.pages[2]),'image');assert.equal(nextCalls,2);
  }finally{images.close();}
});

test('取消期间完成的图片不能进入后续请求，缓存按任务隔离且有大小上限',async()=>{
  const p=project(),controller=new AbortController();let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const images=new ReadingImages(p.id,controller.signal,async()=>{await gate;return 'image';});
  const pending=images.page(p.pages[0]);const rejected=assert.rejects(pending,/abort/i);
  controller.abort();release();await rejected;
  await assert.rejects(images.page(p.pages[2]),/abort/i);
  let calls=0;
  const fresh=new ReadingImages(p.id,new AbortController().signal,async()=>{calls++;return 'fresh';});
  try{
    assert.equal(await fresh.page(p.pages[0]),'fresh');
    for(let i=0;i<30;i++)await fresh.avatar(`/avatars/${i}.jpg`);
    await fresh.page(p.pages[0]);assert.equal(calls,32,'较旧的缓存项被淘汰');
  }finally{fresh.close();}
});
