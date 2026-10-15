import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Project, RereadPreview, RereadReviewItem, Appearance } from '../shared/types';
import { api, json } from './api';

type Props={project:Project;locked:boolean;onAction:(suffix:string,body:unknown)=>Promise<unknown>;onPage:(page:number)=>void;onReview:()=>void};
function Item({item,project,locked,onAction,onPage,onReview}:Props&{item:RereadReviewItem}){
  const due=item.page<=project.processed;
  const crop=item.kind==='出场归属'?(item.data as Appearance).observed.crop:undefined;
  return <article className="reread-item">
    {crop&&<img src={crop} alt="原人工校正的出场裁图" loading="lazy"/>}
    <div><small>P.{item.page} · {item.kind}{item.resolved?' · 已核对':!due?' · 等待读到此页':''}</small><strong>{item.title}</strong><p>{item.detail}</p>
      <div className="reread-actions"><button className="text-button" onClick={()=>onPage(item.page)}>查看原页</button>
        {!item.resolved&&due&&<><button className="button small" disabled={locked} onClick={()=>{onPage(item.page);onReview();}}>核对人物与校正</button><button className="button small" disabled={locked} onClick={()=>void onAction('/reread/resolve',{sessionId:project.reread!.id,itemId:item.id})}>已核对此项</button></>}
      </div>
    </div>
  </article>;
}

export function RereadPanel(props:Props){
  const {project,locked,onAction}=props,session=project.reread;
  if(!session)return null;
  const pending=session.items.filter(i=>!i.resolved),due=pending.filter(i=>i.page<=project.processed);
  return <section className="reread-panel" aria-label="重读与保留校正">
    <div className="reread-heading"><div><strong>从 P.{session.fromPage} 重新分析</strong><p>原结果已独立保存。{pending.length?`${pending.length} 项保留校正待核对，其中 ${due.length} 项已到达证据页。`:'保留校正已全部核对。'}重读用量计入累计统计。</p></div>
      <div className="reread-actions"><a className="button small" href={`/api/projects/${project.id}/reread/original`}>下载重读前结果</a><button className="button small" disabled={locked} onClick={()=>{if(window.confirm('恢复重读前的分析？本次重读结果另存备份，已经发生的模型用量仍会保留。'))void onAction('/reread/restore',{sessionId:session.id});}}>恢复原结果</button>
        <button className="button small" disabled={locked||pending.length>0||project.processed<session.previousProcessed} onClick={()=>void onAction('/reread/finish',{sessionId:session.id})}>完成重读核对</button>
      </div>
    </div>
    {!!session.items.length&&<details open={due.length>0}><summary>保留的校正 · {session.items.length} 项</summary><p>先在「背景与人物」中确认新结果或重新应用校正，再点「已核对此项」。此按钮只记录核对完成，不自动修改人物或事实。</p><div className="reread-items">{session.items.map(item=><Item key={item.id} {...props} item={item}/>)}</div></details>}
  </section>;
}

export function RereadDialog({project,initialPage,locked,onClose,onPrepare}:{project:Project;initialPage:number;locked:boolean;onClose:()=>void;onPrepare:(fromPage:number,token:string)=>Promise<unknown>}){
  const [fromPage,setFromPage]=useState(Math.max(1,Math.min(initialPage,project.processed))),[preview,setPreview]=useState<RereadPreview|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  useEffect(()=>{
    let cancelled=false;setPreview(null);setError('');setLoading(true);
    void api<RereadPreview>(`/projects/${project.id}/reread/preview`,json('POST',{fromPage})).then(value=>{if(!cancelled)setPreview(value);}).catch(e=>{if(!cancelled)setError((e as Error).message);}).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[project.id,project.updatedAt,fromPage]);
  return <div className="modal-backdrop"><section className="modal reread-dialog" role="dialog" aria-modal="true" aria-labelledby="reread-title"><div className="modal-heading"><h2 id="reread-title">选择重读起点</h2><button className="icon-button" disabled={locked} aria-label="关闭重读设置" onClick={onClose}><X size={18}/></button></div>
    <label>从哪一页重新分析<select aria-label="重读起点" disabled={locked} value={fromPage} onChange={e=>setFromPage(Number(e.target.value))}>{project.pages.slice(0,project.processed).map((page,i)=><option key={page.id} value={i+1}>P.{i+1} · {page.name}</option>)}</select></label>
    {loading&&<p role="status">正在检查历史恢复点…</p>}{error&&<p role="alert">{error}</p>}
    {preview&&(preview.available?<><p>{fromPage===1?'从头重新理解故事':`保留 P.1–${fromPage-1} 的已保存前文`}，从 P.{fromPage} 重新生成后续摘要、人物和关系阶段。原来的 {preview.throughPage} 页分析会另行保存，可以恢复。</p><p>{preview.items.length} 项有记录的人工校正或身份归并将保留为核对清单。到达对应页时提供给模型作线索，读完该页后暂停，等你确认新结果或重新应用校正。恢复点内已有的固定项继续生效。</p><p>准备重读不调用模型；点击「继续分析」后才产生新的模型用量。</p></>:<div role="status"><p>该页没有完整的历史恢复点，不能直接恢复前文。旧项目需要先从头重读；新一轮阅读会逐页保存恢复点。</p><label>改用可用起点<select aria-label="可用重读起点" value="" onChange={e=>setFromPage(Number(e.target.value))}><option value="" disabled>请选择</option>{preview.availableFromPages.map(n=><option key={n} value={n}>从 P.{n} 重读</option>)}</select></label></div>)}
    <div className="modal-actions"><button className="button" disabled={locked} onClick={onClose}>取消</button><button className="button primary" disabled={locked||loading||!preview?.available} onClick={()=>{if(preview)void onPrepare(fromPage,preview.token);}}>保留原结果并准备重读</button></div>
  </section></div>;
}
