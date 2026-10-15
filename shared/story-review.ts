import type { Project } from './types.js';

export function summaryNeedsReview(project:Project,page:number){
  return project.storyReviewFromPage!==undefined&&page>=project.storyReviewFromPage&&page<=Math.min(project.storyReviewThroughPage??project.processed,project.processed);
}

export function narrativeReviewContext(project:Project){
  if(project.storyReviewFromPage===undefined)return undefined;
  return {fromPage:project.storyReviewFromPage,throughPage:Math.min(project.storyReviewThroughPage??project.processed,project.processed),
    instruction:'此范围的人物或事实已经校正，原页摘要、阶段标题及记忆中的旧称谓和归属尚未重新核对。按当前结构化出场归属、人工校正和 identityRedirects 解释旧文；不要用旧摘要推翻校正，也不要把单次出场校正推广为全局人物合并。保留未受影响的事件和因果；无法对应的旧叙述保持不确定，不猜测改写。'};
}
