import { useState } from 'react';
import type { Project } from '../shared/types';

export type AppearanceBindingInput={ids:string[];characterId:string|null;reason:string;newName?:string};
export default function AppearanceManager({project,locked,onPage,onBind}:{project:Project;locked:boolean;onPage:(page:number)=>void;onBind:(input:AppearanceBindingInput)=>Promise<unknown>}){
  const [selected,setSelected]=useState<string[]>([]),[target,setTarget]=useState(''),[reason,setReason]=useState(''),[name,setName]=useState('');
  const [query,setQuery]=useState(''),[pendingOnly,setPendingOnly]=useState(false),[offset,setOffset]=useState(0),[working,setWorking]=useState(false),[message,setMessage]=useState('');
  const entries=(project.appearances||[]).filter(a=>(!pendingOnly||!a.characterId)&&(!query||`${a.page} ${a.observed.name} ${project.characters.find(c=>c.id===a.characterId)?.name||''}`.toLowerCase().includes(query.toLowerCase())));
  const disabled=locked||working;
  const submit=async()=>{setWorking(true);setMessage('');try{await onBind({ids:selected,characterId:target==='new'||target==='pending'?null:target,reason,...(target==='new'?{newName:name}:{})});setSelected([]);setMessage('已更新所选出场的归属及当前关系、状态；原始观察和修改记录已保留。');}catch(e){setMessage((e as Error).message);}finally{setWorking(false);}};
  return <div className="appearance-manager">
    <p className="identity-note">按页核对出场，只校正勾选的记录。存疑裁图不会自动加入人物参考库；校正后更新当前关系与状态，已结束的历史阶段保留当时结论。</p>
    {!project.appearances?.length?<p className="identity-note">尚无独立出场记录。新版阅读会逐页积累；旧分析没有保存的定位和证据不会自动补造。</p>:<>
      <div className="appearance-toolbar"><label>查找出场<input value={query} placeholder="人物名或页码" onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label><label className="appearance-check"><input type="checkbox" checked={pendingOnly} onChange={e=>{setPendingOnly(e.target.checked);setOffset(0);}}/>仅看待定</label><span>{entries.length} 条出场 · 已选 {selected.length} 条</span></div>
      <div className="appearance-list">{entries.slice(offset,offset+20).map(a=>{
        const person=project.characters.find(c=>c.id===a.characterId);
        return <article className="appearance-entry" key={a.id}>
          <label className="appearance-check"><input type="checkbox" disabled={disabled} checked={selected.includes(a.id)} aria-label={`选择第 ${a.page} 页的${a.observed.name}`} onChange={e=>setSelected(e.target.checked?[...selected,a.id]:selected.filter(id=>id!==a.id))}/>P.{a.page}</label>
          <button type="button" className="appearance-crop" onClick={()=>onPage(a.page)} title={`查看第 ${a.page} 页`}>{a.observed.crop?<img src={a.observed.crop} alt={`${a.observed.name}的本次出场裁图`}/>:<span>查看原页</span>}</button>
          <div className="appearance-details"><strong>{person?.name||'身份待定'}</strong><small>初读称呼：{a.observed.name} · {a.verification==='manual'?'人工核对':a.verification==='reviewed'?'已复核':a.verification==='continuity'?'沿用前文，未独立复核':'待核对'}</small><p>{[a.observed.appearance,a.observed.outfit&&`衣着：${a.observed.outfit}`,a.observed.hairStyle&&`发型：${a.observed.hairStyle}`].filter(Boolean).join('；')}</p><p>{a.evidence}</p><details><summary>归属记录 · {a.bindings.length}</summary>{a.bindings.map((b,i)=><p key={i}>读至 P.{b.atPage}：{b.characterId?(project.characters.find(c=>c.id===b.characterId)?.name||b.characterId):'待定'} — {b.reason}</p>)}</details></div>
        </article>;
      })}</div>
      <div className="modal-actions"><button className="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>上一组</button><span>{entries.length?offset+1:0}–{Math.min(offset+20,entries.length)} / {entries.length}</span><button className="button" disabled={offset+20>=entries.length} onClick={()=>setOffset(offset+20)}>下一组</button></div>
      <div className="appearance-binding"><label>所选出场属于<select disabled={disabled} value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择归属</option><option value="pending">暂时待定</option><option value="new">新建独立人物</option>{project.characters.filter(c=>c.identityState!=='pending').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{target==='new'&&<label>人物名称<input maxLength={200} disabled={disabled} value={name} onChange={e=>setName(e.target.value)}/></label>}<label>校正依据<input maxLength={1000} disabled={disabled} value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如：这一页的耳饰和明确称呼对应同一人"/></label><button className="button primary" disabled={disabled||!selected.length||selected.length>200||!target||!reason.trim()||target==='new'&&!name.trim()} onClick={()=>void submit()}>保存所选出场归属</button></div>
    </>}{message&&<p role="status" className="identity-message">{message}</p>}
  </div>;
}
