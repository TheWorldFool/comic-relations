import { Play } from 'lucide-react';
import type { Project } from '../shared/types';

export default function ReviewNotice({project,busy,onView,onConfirm,onContinue}:{
  project:Project;busy:boolean;onView:()=>void;
  onConfirm:(override:'story'|'skip')=>void;onContinue:()=>void;
}) {
  const page=project.pages[project.processed];
  if(!page||!['paused','error'].includes(project.status))return null;
  if(page.analysis?.kind==='blocked'&&page.override!=='skip')return null;
  const uncertain=page.analysis?.kind==='uncertain';
  const needsReview=uncertain&&page.override==='auto';
  const corrected=uncertain&&page.override!=='auto';
  const pageNumber=project.processed+1;
  return <section className={`review-notice ${needsReview?'needs-review':'ready'}`} aria-label="阅读恢复操作">
    <div className="review-copy" role="status">
      <strong>{needsReview?`第 ${pageNumber} 页需要人工确认`:corrected?`第 ${pageNumber} 页已${page.override==='story'?'确认为正文':'排除'}`:project.status==='error'?'分析已中断':'分析已暂停'}</strong>
      <p>{needsReview?'查看原图后选择页面用途，确认后接着分析。':`已完成的 ${project.processed} 页会保留，从第 ${pageNumber} 页继续。`}</p>
      {project.status==='error'&&project.error&&<p>{project.error}</p>}
    </div>
    <div className="review-actions">
      <button className="button small" onClick={onView}>查看第 {pageNumber} 页</button>
      {needsReview?<>
        <button className="button small" disabled={busy} onClick={()=>onConfirm('skip')}>排除此页并继续</button>
        <button className="button primary small" disabled={busy} onClick={()=>onConfirm('story')}><Play size={14}/>确认正文并继续</button>
      </>:<button className="button primary" disabled={busy} onClick={onContinue}><Play size={14}/>继续分析</button>}
    </div>
  </section>;
}
