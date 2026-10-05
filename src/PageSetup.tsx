import { useState } from 'react';
import { X, ZoomIn } from 'lucide-react';
import type { PagePurpose, Project } from '../shared/types';
import { purposeLabels, suggestedPurpose } from '../shared/page-selection';
import BackgroundResearchPanel from './BackgroundResearchPanel';

export default function PageSetup({project,onClose,onSave,onSearch,onApply,onRead}:{project:Project;onClose:()=>void;onSave:(pages:{id:string;purpose:PagePurpose}[],reset:boolean)=>Promise<Project>;onSearch:(hint?:string)=>Promise<Project>;onApply:(id:string)=>Promise<Project>;onRead:()=>Promise<void>}){
  const [purposes,setPurposes]=useState<Record<string,PagePurpose|undefined>>(()=>Object.fromEntries(project.pages.map(p=>[p.id,suggestedPurpose(p)])));
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [range,setRange]=useState(''),[preview,setPreview]=useState<string|null>(null),[error,setError]=useState('');
  const [working,setWorking]=useState(false),[autoSearch,setAutoSearch]=useState(true),[allowReset,setAllowReset]=useState(false),[step,setStep]=useState<'pages'|'background'>('pages');
  const remaining=project.pages.filter(p=>!purposes[p.id]).length;
  const changesRead=project.pages.some((p,i)=>i<project.processed&&purposes[p.id]&&purposes[p.id]!==suggestedPurpose(p));
  const act=async(fn:()=>Promise<void>)=>{setError('');setWorking(true);try{await fn();}catch(e){setError((e as Error).message);}finally{setWorking(false);}};
  const mark=(purpose:PagePurpose)=>{setPurposes(current=>({...current,...Object.fromEntries([...selected].map(id=>[id,purpose]))}));setSelected(new Set());};
  const selectRange=()=>{const next=new Set<string>();for(const part of range.replace(/[，、]/g,',').replace(/[–—]/g,'-').split(',')){const match=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!match){setError('页码格式示例：1, 3-12');return;}const start=Number(match[1]),end=Number(match[2]||match[1]);if(start<1||end<start||end>project.pages.length){setError('页码范围超出当前漫画。');return;}for(let i=start-1;i<end;i++)next.add(project.pages[i].id);}setSelected(next);setError('');};
  const save=(continueReading:boolean)=>void act(async()=>{
    if(remaining)throw new Error('请先为所有页面选择用途。');
    const next=await onSave(project.pages.map(p=>({id:p.id,purpose:purposes[p.id]!})),allowReset);
    if(!continueReading){onClose();return;}
    if(autoSearch){setStep('background');await onSearch();}
    else{if(next.processed<next.pages.length)await onRead();onClose();}
  });
  return <div className="modal-backdrop"><div className="modal page-setup" role="dialog" aria-modal="true" aria-labelledby="page-setup-title">
    <div className="modal-heading"><div><span className="eyebrow">阅读前准备</span><h2 id="page-setup-title">{step==='pages'?'先划分正文与封面':'核对作品背景'}</h2></div><button className="icon-button" disabled={working} onClick={onClose} aria-label="关闭阅读前准备"><X size={18}/></button></div>
    {step==='pages'?<>
      <p className="identity-note">点击缩略图多选，再批量指定用途。正文参与剧情分析；封面只用于识别作品，广告和附页跳过。还有 {remaining} 页未划分。</p>
      <div className="page-setup-tools"><button className="button small" disabled={working} onClick={()=>setSelected(new Set(project.pages.map(p=>p.id)))}>全选</button><button className="button small" disabled={working} onClick={()=>setSelected(new Set(project.pages.filter(p=>!purposes[p.id]).map(p=>p.id)))}>选择未划分页</button><input aria-label="选择页码范围" placeholder="页码：1, 3-12" value={range} onChange={e=>setRange(e.target.value)} disabled={working}/><button className="button small" disabled={working||!range} onClick={selectRange}>选择范围</button><span>已选 {selected.size} 页</span></div>
      <div className="page-setup-tools">{Object.entries(purposeLabels).map(([value,label])=><button key={value} className="button small" disabled={working||!selected.size} onClick={()=>mark(value as PagePurpose)}>设为{label}</button>)}<button className="text-button" disabled={working||!remaining} onClick={()=>{setPurposes(current=>({...current,...Object.fromEntries(project.pages.filter(p=>!current[p.id]).map(p=>[p.id,'story']))}));setSelected(new Set());}}>其余未划分页设为正文</button></div>
      <div className="page-setup-grid">{project.pages.map((page,i)=><article key={page.id} className={selected.has(page.id)?'selected':''}><button className="page-setup-thumbnail" disabled={working} aria-pressed={selected.has(page.id)} aria-label={`选择第 ${i+1} 页`} onClick={()=>setSelected(current=>{const next=new Set(current);if(next.has(page.id))next.delete(page.id);else next.add(page.id);return next;})}><img src={page.thumbnail} alt={`第 ${i+1} 页`} loading="lazy"/><span>{String(i+1).padStart(3,'0')}</span></button><div><span>{purposes[page.id]?purposeLabels[purposes[page.id]!]: '未划分'}</span><button className="icon-button" aria-label={`放大第 ${i+1} 页`} onClick={()=>setPreview(page.image)}><ZoomIn size={13}/></button></div></article>)}</div>
      <div className="page-setup-footer"><label className="setup-check"><input type="checkbox" checked={autoSearch} onChange={e=>setAutoSearch(e.target.checked)} disabled={working}/>划分后自动查找作品背景</label>{changesRead&&<label className="setup-check"><input type="checkbox" checked={allowReset} onChange={e=>setAllowReset(e.target.checked)} disabled={working}/>本次修改涉及已读页面，我确认清除旧分析后重新阅读</label>}<div className="modal-actions"><button className="button" disabled={working||!!remaining||changesRead&&!allowReset} onClick={()=>save(false)}>只保存划分</button><button className="button primary" disabled={working||!!remaining||changesRead&&!allowReset} onClick={()=>save(true)}>{working?'处理中…':'保存划分并继续'}</button></div></div>
    </>:<div className="page-setup-background"><BackgroundResearchPanel project={project} busy={working} onSearch={hint=>void act(async()=>{await onSearch(hint);})} onApply={()=>void act(async()=>{if(project.backgroundResearch)await onApply(project.backgroundResearch.id);})}/><div className="modal-actions"><button className="button" disabled={working} onClick={()=>setStep('pages')}>返回页面划分</button><button className="button primary" disabled={working} onClick={()=>void act(async()=>{if(project.processed<project.pages.length)await onRead();onClose();})}>{project.processed===project.pages.length?'返回阅读工作台':project.backgroundResearch?.accepted?'开始分析':'不采用新背景，开始分析'}</button></div></div>}
    {error&&<p className="banner error" role="alert">{error}</p>}
    {preview&&<div className="page-preview" onClick={()=>setPreview(null)}><button className="button" onClick={()=>setPreview(null)}>关闭预览</button><img src={preview} alt="原页预览"/></div>}
  </div></div>;
}
