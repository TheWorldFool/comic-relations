import type { Project } from '../shared/types.js';
import { canonicalId } from './identity.js';
import { pageIdentityIds } from '../shared/identity-people.js';
import { summaryNeedsReview } from '../shared/story-review.js';

export const coverReferenceLabel=(page:number)=>`封面人物参考 P.${page}：只用于外貌及明确姓名对照，不是本页正文。封面同框不证明关系，不提取封面剧情，也不为仅在封面出现的人物建立正文档案。`;
export function coverReferencePages(project:Project){
  const covers=project.pages.slice(0,project.processed).flatMap((page,index)=>page.purpose==='cover'?[{page,number:index+1}]:[]);
  return covers.length>1?[covers[0],covers[covers.length-1]]:covers;
}
export function identityHistory(project:Project,id:string){
  const canonical=canonicalId(project,id);
  const appearances=project.pages.slice(0,project.processed).flatMap((page,index)=>{
    if(page.analysis?.kind!=='story')return [];
    if(!pageIdentityIds(project,index+1).includes(canonical))return [];
    const observed=project.appearances?.filter(a=>a.page===index+1&&a.pageId===page.id);
    if(observed?.some(a=>canonicalId(project,a.characterId||a.trackId)===canonical)){
      const matching=observed.filter(a=>canonicalId(project,a.characterId||a.trackId)===canonical);
      return [{page:index+1,summary:page.analysis.summary,summaryNeedsReview:summaryNeedsReview(project,index+1),identityEvidence:matching.map(a=>a.bindings.at(-1)?.reason||a.evidence)}];
    }
    return [{page:index+1,summary:page.analysis.summary,summaryNeedsReview:summaryNeedsReview(project,index+1),identityEvidence:page.analysis.identityObservations?.filter(o=>canonicalId(project,o.personId)===canonical).map(o=>o.evidence)}];
  });
  return {storyAppearances:appearances.length,recentAppearances:appearances.slice(-3)};
}
