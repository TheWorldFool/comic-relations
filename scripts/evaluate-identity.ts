import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { identitySuiteSchema, evaluateIdentity } from '../server/identity-evaluation.js';
import type { Project } from '../shared/types.js';

const args=process.argv.slice(2),options=new Map<string,string>();
for(let i=0;i<args.length;i+=2){if(!['--project','--annotations','--output','--compare'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw new Error('用法：npm run evaluate -- --project <project.json> --annotations <标注.json> [--output <报告.json>] [--compare <基线报告.json>]');options.set(args[i],args[i+1]);}
if(!options.has('--project')||!options.has('--annotations'))throw new Error('需要 --project 和 --annotations；只读取现有结果，不调用模型。');
const projectFile=path.resolve(options.get('--project')!),annotationFile=path.resolve(options.get('--annotations')!);
const raw=await readFile(annotationFile,'utf8'),suite=identitySuiteSchema.parse(JSON.parse(raw));
const project=JSON.parse(await readFile(projectFile,'utf8')) as Project;
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const pages=new Map<string,number[]>();
for(const [index,page] of project.pages.entries()){
  if(!/^[a-f0-9-]{36}$/.test(page.id))throw new Error('无效页面 ID。');
  const digest=hash(await readFile(path.join(path.dirname(projectFile),'images',`${page.id}.jpg`)));
  pages.set(digest,[...(pages.get(digest)||[]),index+1]);
}
const pageNumbers=suite.pages.map(p=>{const matches=pages.get(p.sha256);if(matches?.length!==1)throw new Error(`样本缺失或重复：${p.label}；不能用不同图片比较结果。`);return matches[0];});
const report={...evaluateIdentity(project,suite,pageNumbers),annotationHash:hash(JSON.stringify(suite)),pageHashes:suite.pages.map(p=>p.sha256)};
let comparison:unknown;
if(options.has('--compare')){
  const before=JSON.parse(await readFile(options.get('--compare')!,'utf8'));
  if(before.annotationHash!==report.annotationHash||JSON.stringify(before.pageHashes)!==JSON.stringify(report.pageHashes))throw new Error('标注或素材不同，不能直接比较。');
  comparison={baseline:before.metrics,current:report.metrics,baselineTiming:before.timing,currentTiming:report.timing};
}
const output=JSON.stringify({...report,...(comparison?{comparison}:{})},null,2);
if(options.has('--output')){
  const target=path.resolve(options.get('--output')!);
  if([projectFile,annotationFile,...(options.has('--compare')?[path.resolve(options.get('--compare')!)]:[])].includes(target))throw new Error('报告不能覆盖输入文件。');
  await writeFile(target,output,{flag:'wx'});
}
console.log(output);
