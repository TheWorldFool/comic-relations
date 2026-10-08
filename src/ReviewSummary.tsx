import type { Project } from '../shared/types';
import { reviewSummary } from '../shared/review-summary';

export default function ReviewSummary({project,onReview,onPage}:{project:Project;onReview:()=>void;onPage:(page:number)=>void}){
  const summary=reviewSummary(project);
  if(!project.processed)return null;
  const needsReview=summary.pending+summary.missingPortraits+summary.failedPages.length>0;
  return <details className="review-summary" open={needsReview}>
    <summary>{project.status==='completed'?'分析完成':'校对概况'} · {needsReview?'仍有待核对事项':'暂无已记录的待核对事项'}</summary>
    <div><span>{summary.pending} 位待定人物</span><span>{summary.failedPages.length} 页身份复核未完整完成</span><span>{summary.missingPortraits} 位人物缺少头像</span><button className="text-button" onClick={onReview}>打开人物校对 →</button></div>
    {!!summary.failedPages.length&&<div>复核记录：{summary.failedPages.map(page=><button key={page} className="text-button" onClick={()=>onPage(page)}>P.{page}</button>)}</div>}
    <small>这是程序记录的待查项，不代表已检测出所有漏识别；复核失败页保留当时记录，补充校对后仍可追溯。</small>
  </details>;
}
