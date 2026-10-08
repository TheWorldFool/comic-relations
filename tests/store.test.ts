import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Project } from '../shared/types.js';

test('损坏项目仍列在书架；恢复前保留原文件，坏文件不能覆盖有效备份',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'comic-store-'));
  process.env.DATA_DIR=temp;
  const store=await import('../server/store.js');
  t.after(async()=>{if(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(temp).startsWith('comic-store-'))await rm(temp,{recursive:true,force:true});});
  const p:Project={id:randomUUID(),name:'可恢复项目',createdAt:'',updatedAt:'',direction:'ltr',status:'idle',processed:0,memory:'',characters:[],relations:[],stages:[],pages:[]};
  await store.saveProject(p);p.name='新版名称';await store.saveProject(p);
  const file=path.join(store.projectDir(p.id),'project.json');const backup=path.join(store.projectDir(p.id),'project.backup.json');
  const good=await readFile(backup,'utf8');await writeFile(file,'{broken');
  await assert.rejects(store.readProject(p.id),/损坏/);
  const entries=await store.listProjectEntries();assert.equal(entries.length,1);assert.equal(entries[0].unreadable,true);assert.equal(entries[0].recoverable,true);
  await assert.rejects(store.saveProject(p));assert.equal(await readFile(backup,'utf8'),good);
  const restored=await store.restoreProject(p.id);assert.equal(restored.name,'可恢复项目');assert.equal((await store.readProject(p.id)).name,restored.name);
  const retained=(await readdir(store.projectDir(p.id))).find(f=>f.startsWith('project.before-restore-'))!;
  assert.equal(await readFile(path.join(store.projectDir(p.id),retained),'utf8'),'{broken');
  assert.equal((await store.listProjectEntries())[0].unreadable,undefined);
});
