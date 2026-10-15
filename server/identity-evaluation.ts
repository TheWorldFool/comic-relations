import { z } from 'zod';
import type { Box, Project } from '../shared/types.js';

const box=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).refine(b=>b.x+b.width<=1&&b.y+b.height<=1,'框不能超出页面');
export const identitySuiteSchema=z.object({
  version:z.literal(1),name:z.string().min(1),scope:z.literal('identity-probes'),annotationStatus:z.enum(['draft','human-reviewed']),notes:z.string(),
  pages:z.array(z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),label:z.string(),subjects:z.array(z.object({identity:z.string().min(1),regions:z.array(box).min(1)})).min(1)})).min(1),
}).superRefine((s,ctx)=>{
  if(new Set(s.pages.map(p=>p.sha256)).size!==s.pages.length)ctx.addIssue({code:'custom',message:'页面哈希重复'});
  s.pages.forEach((p,i)=>{if(new Set(p.subjects.map(s=>s.identity)).size!==p.subjects.length)ctx.addIssue({code:'custom',path:['pages',i],message:'同页同一人物的多个画面应放在 regions 中'});});
});
export type IdentitySuite=z.infer<typeof identitySuiteSchema>;
const containsCenter=(region:Box,crop:Box)=>{const x=crop.x+crop.width/2,y=crop.y+crop.height/2;return x>=region.x&&x<=region.x+region.width&&y>=region.y&&y<=region.y+region.height;};

export function evaluateIdentity(project:Project,suite:IdentitySuite,pageNumbers:number[]){
  if(pageNumbers.length!==suite.pages.length||pageNumbers.some(p=>!Number.isInteger(p)||p<1||p>project.processed))throw new Error('评测页面不存在或尚未读完。');
  const rows:{page:number;identity:string;ids:string[];detected:boolean;pending:boolean}[]=[];
  let ambiguousCrops=0,unlocatedCrops=0,manualAppearances=0;
  for(const [i,annotation] of suite.pages.entries()){
    const page=pageNumbers[i],pageId=project.pages[page-1].id;
    const expected=annotation.subjects.map(s=>({...s,ids:new Set<string>(),detected:false,pending:false}));
    for(const a of (project.appearances||[]).filter(a=>a.pageId===pageId)){
      if(a.bindings.some(b=>b.method==='manual'||b.method==='merge'))manualAppearances++;
      if(!a.observed.box){unlocatedCrops++;continue;}
      const matches=expected.filter(e=>e.regions.some(r=>containsCenter(r,a.observed.box!)));
      if(matches.length>1){ambiguousCrops++;continue;}
      if(matches.length===1){const e=matches[0];e.detected=true;if(a.characterId)e.ids.add(a.characterId);else e.pending=true;}
    }
    rows.push(...expected.map(e=>({page,identity:e.identity,ids:[...e.ids].sort(),detected:e.detected,pending:e.pending})));
  }
  const observations=rows.flatMap(r=>r.ids.map(id=>({truth:r.identity,prediction:id})));
  let sameIdentityPairs=0,splitPairs=0,differentIdentityPairs=0,mergedPairs=0;
  for(let i=0;i<observations.length;i++)for(let j=i+1;j<observations.length;j++){
    const a=observations[i],b=observations[j];
    if(a.truth===b.truth){sameIdentityPairs++;if(a.prediction!==b.prediction)splitPairs++;}
    else{differentIdentityPairs++;if(a.prediction===b.prediction)mergedPairs++;}
  }
  const detected=rows.filter(r=>r.detected).length,confirmed=rows.filter(r=>r.ids.length).length;
  const pageIds=new Set(pageNumbers.map(n=>project.pages[n-1].id));
  const runs=(project.readingRuns||[]).filter(r=>pageIds.has(r.pageId));
  const sum=(key:'elapsedMs'|'attempts'|'promptTokens'|'completionTokens'|'identityReviewMs')=>runs.reduce((n,r)=>n+(r[key]||0),0);
  return {version:1,suite:suite.name,annotationStatus:suite.annotationStatus,scope:suite.scope,
    status:Array.isArray(project.appearances)?'scored':'missing-appearance-records',
    metrics:{expected:rows.length,detected,confirmed,unmatched:rows.length-detected,pending:rows.filter(r=>r.pending).length,coverage:detected/rows.length,confirmedCoverage:confirmed/rows.length,
      sameIdentityPairs,splitPairs,splitRate:sameIdentityPairs?splitPairs/sameIdentityPairs:null,differentIdentityPairs,mergedPairs,mergeRate:differentIdentityPairs?mergedPairs/differentIdentityPairs:null},
    diagnostics:{ambiguousCrops,unlocatedCrops,manualAppearances},
    timing:{runs:runs.length,elapsedMs:sum('elapsedMs'),requests:sum('attempts'),promptTokens:sum('promptTokens'),completionTokens:sum('completionTokens'),identityReviewMs:sum('identityReviewMs'),models:[...new Set(runs.map(r=>r.model).filter(Boolean))],promptHashes:[...new Set(runs.map(r=>r.promptHash).filter(Boolean))]},rows};
}
