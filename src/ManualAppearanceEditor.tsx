import { useState, useRef, type PointerEvent } from 'react';
import type { Box, ManualAppearanceInput, Project } from '../shared/types';

export default function ManualAppearanceEditor({project,locked,onSave}:{project:Project;locked:boolean;onSave:(input:ManualAppearanceInput)=>Promise<unknown>}){
  const pages=project.pages.map((p,i)=>({page:p,number:i+1})).filter(p=>p.number<=project.processed&&p.page.analysis?.kind==='story');
  const [pageId,setPageId]=useState(pages[0]?.page.id||''),[target,setTarget]=useState('new');
  const [name,setName]=useState(''),[appearance,setAppearance]=useState(''),[reason,setReason]=useState('');
  const [nameType,setNameType]=useState<'named'|'descriptive'>('descriptive');
  const [box,setBox]=useState<Box|null>(null),[working,setWorking]=useState(false),[message,setMessage]=useState('');
  const start=useRef<{x:number;y:number}|null>(null);
  const page=pages.find(p=>p.page.id===pageId)?.page,disabled=locked||working;
  const point=(e:PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
  const draw=(e:PointerEvent<HTMLDivElement>)=>{if(!start.current)return;const p=point(e),s=start.current;setBox({x:Math.min(s.x,p.x),y:Math.min(s.y,p.y),width:Math.abs(s.x-p.x),height:Math.abs(s.y-p.y)});};
  return <details className="manual-appearance"><summary>＋ 补录漏识别人物</summary>
    <p className="identity-note">选择已读正文页，拖动框出清晰的人物区域，再指定归属。补录更新当前图并保留证据，不调用模型、不改写已结束阶段。</p>
    {!pages.length?<p>尚无已读正文页，请先完成页面分析。</p>:<form onSubmit={e=>{e.preventDefault();if(!box||disabled)return;setWorking(true);setMessage('');void onSave({pageId,characterId:target==='new'?null:target,name,nameType,appearance,reason,box}).then(()=>{setMessage('已补录出场，当前人物图与参考头像已更新。');setBox(null);setName('');setReason('');},e=>setMessage((e as Error).message)).finally(()=>setWorking(false));}}>
      <label>证据页面<select value={pageId} disabled={disabled} onChange={e=>{setPageId(e.target.value);setBox(null);start.current=null;}}>{pages.map(p=><option key={p.page.id} value={p.page.id}>P.{p.number} · {p.page.name}</option>)}</select></label>
      {page&&<div className="manual-crop-scroll"><div className="manual-crop-image" onPointerDown={e=>{if(disabled||e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);start.current=point(e);setBox(null);}} onPointerMove={draw} onPointerUp={e=>{draw(e);start.current=null;}} onPointerCancel={()=>{start.current=null;setBox(null);}}><img draggable={false} src={page.image} alt="拖动框选要补录的人物"/>{box&&<span className="crop-box" style={{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.width*100}%`,height:`${box.height*100}%`}}/>}</div></div>}
      <label>本次人物属于<select disabled={disabled} value={target} onChange={e=>setTarget(e.target.value)}><option value="new">新建独立人物</option>{project.characters.filter(c=>c.identityState!=='pending').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {target==='new'&&<><label>姓名或临时称呼<input required maxLength={200} disabled={disabled} value={name} onChange={e=>setName(e.target.value)} placeholder="没有名字时，可用稳定外观称呼"/></label><label>称呼依据<select value={nameType} disabled={disabled} onChange={e=>setNameType(e.target.value as typeof nameType)}><option value="descriptive">临时外观称呼</option><option value="named">漫画中已确认的姓名</option></select></label></>}
      <label>可辨认外观<input maxLength={1000} disabled={disabled} value={appearance} onChange={e=>setAppearance(e.target.value)}/></label>
      <label>补录依据<textarea required maxLength={1000} disabled={disabled} value={reason} onChange={e=>setReason(e.target.value)} placeholder="说明框中人物及其身份依据"/></label>
      <button className="button primary" disabled={disabled||!box||box.width<.005||box.height<.005}>{working?'保存中…':'保存补录人物'}</button>
    </form>}{message&&<p role="status">{message}</p>}
  </details>;
}
