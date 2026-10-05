import { ExternalLink, LoaderCircle, Search } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '../shared/types';
export default function BackgroundResearchPanel({project,busy,onSearch,onApply}:{project:Project;busy:boolean;onSearch:(hint?:string)=>void;onApply:()=>void}){
  const r=project.backgroundResearch;
  const [hint,setHint]=useState(project.workContext?.originalWork||'');
  return <section className="background-research">
    <div className="background-research-heading"><div><strong>AI 查找作品背景</strong><p>从封面与前几页辨认原作，再联网核对背景、译名和人物特征。</p></div><button type="button" className="button small" disabled={busy} onClick={()=>onSearch(hint)}>{busy?<LoaderCircle size={13} className="spin"/>:<Search size={13}/>} {r?'重新查找':'识别并联网查找'}</button></div>
    <input className="background-hint" aria-label="补充作品名称线索" value={hint} maxLength={300} onChange={e=>setHint(e.target.value)} disabled={busy} placeholder="可选：补充原作名或标题线索，留空由 AI 识别"/>
    {busy&&<p className="identity-note" role="status">正在处理，请稍候。识别与联网检索可能需要一两分钟。</p>}
    {r&&<div className="background-result"><div><strong>{r.originalWork||'暂时无法确认原作'}</strong><span className={`tag ${r.status==='ready'?'':'amber'}`}>{r.accepted?'已采用':r.status==='ready'?'检索完成':r.sources.length?'需要核对':'线索不足'}</span></div>
      {!!r.evidence.length&&<p className="identity-note">识别依据：{r.evidence.join('；')}</p>}
      {r.background&&<><h4>原作背景</h4><p>{r.background}</p></>}
      {r.characterGuide&&<><h4>人物对照</h4><p>{r.characterGuide}</p></>}
      {!!r.sources.length&&<ol className="background-sources">{r.sources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}<ExternalLink size={11}/></a></li>)}</ol>}
      {!r.sources.length&&<p className="identity-note">尚无可核对的联网资料。可以补充作品名称后重试，或先不采用背景。</p>}
      {!!r.sources.length&&<button type="button" className="button small" disabled={busy||r.accepted} onClick={onApply}>{r.accepted?'背景已采用':'采用这份背景'}</button>}
    </div>}
    <small>检索资料仅作原作参考。采用后用于后续辨认，不会直接写入本篇关系图。</small>
  </section>;
}
