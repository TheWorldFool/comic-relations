import { Play } from 'lucide-react';
import type { Project } from '../shared/types';

export default function ReviewNotice({project,busy,onView,onContinue}:{
  project:Project;busy:boolean;onView:()=>void;onContinue:()=>void;
}) {
  const page=project.pages[project.processed];
  if(!page||!['paused','error'].includes(project.status))return null;
  // A refused page keeps its own explanation in the reading controls; there is
  // nothing to resume until the user excludes it.
  if(page.analysis?.kind==='blocked'&&page.override!=='skip')return null;
  const pageNumber=project.processed+1;
  return <section className="review-notice" aria-label="阅读恢复操作">
    <div className="review-copy" role="status">
      <strong>{project.status==='error'?'分析已中断':'分析已暂停'}</strong>
      <p>已完成的 {project.processed} 页会保留，从第 {pageNumber} 页继续。</p>
      {project.status==='error'&&project.error&&<p>{project.error}</p>}
    </div>
    <div className="review-actions">
      <button className="button small" onClick={onView}>查看第 {pageNumber} 页</button>
      <button className="button primary" disabled={busy} onClick={onContinue}><Play size={14}/>继续分析</button>
    </div>
  </section>;
}
