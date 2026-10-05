import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Project, WorkContext } from '../shared/types';
import BackgroundResearchPanel from './BackgroundResearchPanel';
import { pagesClassified } from '../shared/page-selection';

export default function IdentityManager({project,busy,onClose,onContext,onMerge,onUndo,onPage,onResearch,onApply,onPrepare}:{project:Project;busy:boolean;onClose:()=>void;onContext:(context:WorkContext)=>Promise<unknown>;onMerge:(source:string,target:string)=>Promise<void>;onUndo:()=>Promise<void>;onPage:(page:number)=>void;onResearch:(hint?:string)=>Promise<Project>;onApply:(id:string)=>Promise<Project>;onPrepare:()=>void}){
  const [tab,setTab]=useState<'context'|'identity'|'mentions'>('context');
  const [context,setContext]=useState<WorkContext>(project.workContext||{originalWork:'',background:'',characterGuide:''});
  const [source,setSource]=useState(''),[target,setTarget]=useState('');
  const [message,setMessage]=useState(''),[working,setWorking]=useState(false);
  const locked=busy||working||project.status==='running';
  const from=project.characters.find(c=>c.id===source),to=project.characters.find(c=>c.id===target);
  useEffect(()=>{if(!project.characters.some(c=>c.id===source))setSource('');if(!project.characters.some(c=>c.id===target))setTarget('');},[project.characters,source,target]);
  const submit=async(action:()=>Promise<unknown>,success:string)=>{setMessage('');setWorking(true);try{await action();setMessage(success);}catch(e){setMessage((e as Error).message);}finally{setWorking(false);}};
  return <div className="modal-backdrop"><div className="modal identity-manager" role="dialog" aria-modal="true" aria-labelledby="identity-title">
    <div className="modal-heading"><div><span className="eyebrow">作品资料</span><h2 id="identity-title">背景与人物校对</h2></div><button className="icon-button" aria-label="关闭人物校对" disabled={working} onClick={onClose}><X size={18}/></button></div>
    <div className="identity-tabs"><button className={tab==='context'?'active':''} onClick={()=>setTab('context')}>原作背景</button><button className={tab==='identity'?'active':''} onClick={()=>setTab('identity')}>人物归并 {project.identitySuggestions?.length?`· ${project.identitySuggestions.length} 条候选`:''}</button><button className={tab==='mentions'?'active':''} onClick={()=>setTab('mentions')}>仅被提及 · {project.mentions?.length||0}</button></div>
    {project.status==='running'&&<p className="identity-note">阅读进行中，可查看资料；暂停后可保存背景或合并人物。</p>}
    <div className="identity-content">{tab==='context'?<form onSubmit={e=>{e.preventDefault();void submit(()=>onContext(context),'背景已保存，后续阅读会使用这些资料。');}}>
      {!pagesClassified(project.pages)?<p className="identity-note">先完成页面划分，再根据封面与正文查找背景。<button type="button" className="text-button" disabled={locked} onClick={onPrepare}>去划分页面 →</button></p>:<BackgroundResearchPanel project={project} busy={locked} onSearch={hint=>void submit(async()=>{await onResearch(hint);},'检索结果已更新，请核对来源后采用。')} onApply={()=>void submit(async()=>{if(project.backgroundResearch){const next=await onApply(project.backgroundResearch.id);if(next.workContext)setContext(next.workContext);}},'已采用检索背景，后续阅读会使用。')}/>}
      <p className="identity-note">提供原作、昵称和外观对照，帮助识别同人角色。原作关系和结局不会自动当作本篇剧情。</p>
      <label>原作名称<input maxLength={300} value={context.originalWork} disabled={locked} onChange={e=>setContext({...context,originalWork:e.target.value})} placeholder="可填写多个原作，用于交叉同人"/></label>
      <label>背景与本篇设定<textarea maxLength={6000} rows={3} disabled={locked} value={context.background} onChange={e=>setContext({...context,background:e.target.value})} placeholder="相关设定、时间线、同人改动；也可注明资料来源"/></label>
      <label>角色对照说明<textarea maxLength={10000} rows={5} disabled={locked} value={context.characterGuide} onChange={e=>setContext({...context,characterGuide:e.target.value})} placeholder="每行一人：姓名、译名／昵称、稳定外观、容易混淆的角色。只填写你确认的资料。"/></label>
      <div className="modal-actions"><button className="button primary" disabled={locked}>保存背景</button></div>
    </form>:tab==='identity'?<>
      <p className="identity-note">无名角色后续确认真名应沿用原档案。这里可以合并已有重复人物，连线、状态对象和各阶段引用会一起归并；继续阅读或修改资料前可撤销最近一次合并。</p>
      {!!project.identitySuggestions?.length&&<div className="identity-suggestions">{project.identitySuggestions.map((s,i)=><button key={i} onClick={()=>{setSource(s.source);setTarget(s.target);}}><strong>{project.characters.find(c=>c.id===s.source)?.name||s.source} ↔ {project.characters.find(c=>c.id===s.target)?.name||s.target}</strong><span>{s.evidence}</span><small>待核对 · P.{s.page}</small></button>)}</div>}
      <div className="identity-selects"><label>重复档案（并入另一人）<select value={source} disabled={locked} onChange={e=>setSource(e.target.value)}><option value="">选择重复人物</option>{project.characters.filter(c=>c.id!==target).map(c=><option key={c.id} value={c.id}>{c.name} · 初登场 P.{c.firstPage}</option>)}</select></label><label>保留档案<select value={target} disabled={locked} onChange={e=>setTarget(e.target.value)}><option value="">选择对应人物</option>{project.characters.filter(c=>c.id!==source).map(c=><option key={c.id} value={c.id}>{c.name} · 初登场 P.{c.firstPage}</option>)}</select></label></div>
      {from&&to&&<div className="identity-preview"><strong>{from.name} → {to.name}</strong><div>{[from,to].map(person=><article key={person.id}>{person.avatar&&<img src={person.avatar} alt={person.name}/>}<span><b>{person.name}</b><p>{person.appearance||person.description}</p><small>别名：{person.aliases.join('、')||'暂无'}</small></span></article>)}</div><p>保留「{to.name}」，将「{from.name}」记录为别名；同一维度保留较新的已确认事实。历史阶段只使用当时已有资料。</p></div>}
      <div className="modal-actions">{project.canUndoMerge&&<button className="button" disabled={locked} onClick={()=>void submit(onUndo,'已撤销最近一次合并。')}>撤销最近合并</button>}<button className="button primary" disabled={locked||!from||!to||source===target} onClick={()=>void submit(()=>onMerge(source,target),'人物已合并，后续阅读会沿用保留的档案。')}>确认合并</button></div>
    </>:<div className="identity-mentions"><p className="identity-note">这些名字只在对白等内容中被提及，尚未与画面人物对应，因此没有加入关系图。</p>{project.mentions?.map((m,i)=><article key={i}><strong>{m.name}</strong><p>{m.evidence}</p><button className="text-button" onClick={()=>onPage(m.page)}>查看 P.{m.page} ↗</button></article>)}{!project.mentions?.length&&<p className="identity-note">尚无单独记录的提及姓名，新阅读结果会逐步积累。</p>}</div>}</div>
    {message&&<p className="identity-message" role="status">{message}</p>}
  </div></div>;
}
