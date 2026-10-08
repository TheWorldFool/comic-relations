import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Network, Scissors, X, Maximize2, Minimize2, ChevronLeft, ChevronRight, History, Search } from 'lucide-react';
import Graph from './Graph';
import CharacterDossier from './CharacterDossier';
import { groupRelations } from './graph-layout';
import type { Stage } from '../shared/types';

type Props = {
  stage:Stage; stages:Stage[]; selectedPerson:string|null; following:boolean;
  onSelectPerson:(id:string)=>void; onClearPerson:()=>void; onStage:(index:number|null)=>void;
  onPage:(page:number)=>void; onCrop:()=>void; canCrop:boolean;
};
export default function RelationshipExplorer(props:Props) {
  const {stage,stages,selectedPerson,onSelectPerson,onClearPerson,onStage,onPage,onCrop,canCrop,following}=props;
  const [tab,setTab]=useState<'relations'|'stage'|'dossier'>('relations');
  const [inspectorOpen,setInspectorOpen]=useState(false);
  const [selectedGroup,setSelectedGroup]=useState<string|null>(null);
  const [focused,setFocused]=useState(false);
  const [showStages,setShowStages]=useState(false);
  const [query,setQuery]=useState('');
  const explorer=useRef<HTMLDivElement>(null);
  const focusButton=useRef<HTMLButtonElement>(null);
  const phaseNav=useRef<HTMLElement>(null);
  const inspectorContent=useRef<HTMLDivElement>(null);
  const graphTab=useRef<HTMLButtonElement>(null);
  const inspectorClose=useRef<HTMLButtonElement>(null);
  const closeInspector=useCallback(()=>{setInspectorOpen(false);graphTab.current?.focus();},[]);
  useEffect(()=>{if(inspectorOpen)inspectorClose.current?.focus();},[inspectorOpen]);
  useEffect(()=>{setSelectedGroup(null);setQuery('');},[stage.id]);
  useEffect(()=>{if(focused)focusButton.current?.focus();},[focused]);
  useEffect(()=>{
    if(!focused)return;
    const close=(event:KeyboardEvent)=>{
      if(event.key==='Tab'&&explorer.current){
        const controls=[...explorer.current.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length>0);
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&(document.activeElement===first||!explorer.current.contains(document.activeElement))){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&(document.activeElement===last||!explorer.current.contains(document.activeElement))){event.preventDefault();first?.focus();}
      }
      if(event.key==='Escape'&&!inspectorOpen&&!document.querySelector('.modal-backdrop')){
        setFocused(false);focusButton.current?.focus();
      }
    };
    window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
  },[focused,inspectorOpen]);
  useEffect(()=>{if(inspectorContent.current)inspectorContent.current.scrollTop=0;},[stage.id,selectedPerson,selectedGroup,tab]);
  useEffect(()=>{
    if(!inspectorOpen)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('.modal-backdrop'))closeInspector();};
    window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
  },[inspectorOpen,closeInspector]);
  useEffect(()=>{
    const nav=phaseNav.current;
    const current=nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if(!nav||!current||!showStages)return;
    const reveal=()=>{if(current.offsetLeft<nav.scrollLeft||current.offsetLeft+current.offsetWidth>nav.scrollLeft+nav.clientWidth)
      nav.scrollLeft=Math.max(0,current.offsetLeft-18);};
    reveal();const observer=new ResizeObserver(reveal);observer.observe(nav);return()=>observer.disconnect();
  },[stage.id,showStages]);
  const groups=useMemo(()=>groupRelations(stage.relations),[stage.relations]);
  const activeGroup=groups.find(g=>g.id===selectedGroup);
  const person=stage.characters.find(p=>p.id===selectedPerson);
  const index=stages.findIndex(s=>s.id===stage.id);
  const relations=activeGroup?activeGroup.relations:person?stage.relations.filter(r=>r.source===person.id||r.target===person.id):stage.relations;
  const name=(id:string)=>stage.characters.find(p=>p.id===id)?.name||id;
  const selectPerson=useCallback((id:string)=>{setQuery('');setSelectedGroup(null);setTab('dossier');setInspectorOpen(true);onSelectPerson(id);},[onSelectPerson]);
  const selectGroup=(id:string)=>{onClearPerson();setSelectedGroup(id);setTab('relations');setInspectorOpen(true);};
  const clear=()=>{onClearPerson();setSelectedGroup(null);};
  const matches=query.trim()?stage.characters.filter(p=>[p.name,...p.aliases,p.appearance||''].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):[];
  const openPage=(page:number)=>{setFocused(false);onPage(page);};
  return <div ref={explorer} role={focused?'dialog':undefined} aria-modal={focused||undefined} aria-label={focused?'关系图专注视图':undefined} className={`relationship-explorer ${focused?'is-focused':''}`}>
    <div className="relationship-stagebar"><div className="relationship-heading">
      <span className="relationship-stage-number">{String(index+1).padStart(2,'0')}</span>
      <div><span className="relationship-kicker">当前关系阶段</span><h3 title={stage.title}>{stage.title}</h3><div className="relationship-meta"><span><BookOpen size={12}/>第 {stage.fromPage}–{stage.toPage} 页</span>{stage.storyTime&&<span>{stage.storyTime}</span>}</div></div>
      <div className="relationship-stage-actions">
        <button className="icon-button" aria-label="上一关系阶段" disabled={index<=0} onClick={()=>onStage(index-1)}><ChevronLeft size={18}/></button>
        <select aria-label="跳转关系阶段" value={stage.id} onChange={e=>onStage(stages.findIndex(s=>s.id===e.target.value))}>{stages.map((s,i)=><option key={s.id} value={s.id}>{i+1}. {s.title} · P.{s.fromPage}–{s.toPage}</option>)}</select>
        <button className="icon-button" aria-label="下一关系阶段" disabled={index>=stages.length-1} onClick={()=>onStage(index+1)}><ChevronRight size={18}/></button>
        <button className="icon-button" title="展开阶段时间线" aria-label="阶段时间线" aria-expanded={showStages} onClick={()=>setShowStages(v=>!v)}><History size={18}/></button>
        <button ref={focusButton} className="button small graph-focus-button" aria-pressed={focused} onClick={()=>setFocused(v=>!v)}>{focused?<Minimize2 size={15}/>:<Maximize2 size={15}/>}<span>{focused?'退出专注':'专注看图'}</span></button>
      </div>
    </div>
    <nav ref={phaseNav} className="relationship-phases" aria-label="关系阶段" hidden={!showStages}>
      {stages.map((s,i)=><button key={s.id} aria-current={s.id===stage.id?'step':undefined} className={`relationship-phase ${s.id===stage.id?'is-current':''}`} onClick={()=>onStage(i)}>
        <span>{String(i+1).padStart(2,'0')}<small>第 {s.fromPage}–{s.toPage} 页</small></span><strong title={s.title}>{s.title}</strong>
      </button>)}
    </nav></div>
    <div className="relationship-toolbar"><div className="relationship-tools"><span><b>{stage.characters.length}</b> 人物<i/> <b>{stage.relations.length}</b> 关系</span><div className="graph-person-search"><label><Search size={15}/><input type="search" aria-label="在关系图中查找人物" placeholder="查找姓名、别名或外观" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setQuery('');}if(e.key==='Enter'&&matches.length===1)selectPerson(matches[0].id);}}/></label>{query.trim()&&<div className="graph-search-results">{matches.map(p=><button key={p.id} onClick={()=>selectPerson(p.id)}><strong>{p.name}</strong><small>{p.aliases.join('、')||p.appearance}</small></button>)}{!matches.length&&<p>没有匹配的人物</p>}</div>}</div></div>
    <nav className="relationship-views" aria-label="关系图与详情"><button ref={graphTab} className={!inspectorOpen?'is-current':''} aria-pressed={!inspectorOpen} onClick={closeInspector}><Network size={14}/>关系图</button>{([{id:'dossier',label:'角色档案'},{id:'relations',label:'关系证据'},{id:'stage',label:'阶段说明'}] as const).map(view=><button key={view.id} className={inspectorOpen&&tab===view.id?'is-current':''} aria-pressed={inspectorOpen&&tab===view.id} onClick={()=>{setTab(view.id);setInspectorOpen(true);}}>{view.label}</button>)}</nav></div>
    <div className={`relationship-body ${inspectorOpen?'has-inspector':''}`}>
      <div className="relationship-map">{(person||activeGroup)&&<div className="graph-selection"><span>正在查看：<strong>{person?person.name:`${name(activeGroup!.source)} · ${name(activeGroup!.target)}`}</strong></span><button className="text-button" onClick={clear}><X size={14}/>取消聚焦</button></div>}<div className="relationship-canvas"><Graph key={stage.id} viewMode={focused?'focused':'embedded'} stage={stage} selectedPerson={selectedPerson} selectedGroup={selectedGroup} onSelect={selectPerson} onSelectGroup={selectGroup}/></div><div className="relationship-legend"><span>拖动空白移动 · 滚轮缩放 · 点人物看档案</span><span>→ 有向关系</span></div></div>
      <aside className="relationship-inspector" aria-label="关系详情" hidden={!inspectorOpen}>
        <div className="inspector-heading"><strong>{tab==='dossier'?'角色档案':tab==='relations'?`关系证据 · ${relations.length}`:'阶段说明'}</strong><button ref={inspectorClose} className="text-button" onClick={closeInspector} aria-label="关闭详情，返回关系图"><X size={15}/>收起详情</button></div>
        <div ref={inspectorContent} className="relationship-inspector-content">
          {tab==='dossier'?<CharacterDossier key={stage.id} people={stage.characters} person={person} toPage={stage.toPage} onSelect={selectPerson} onClear={clear} onPage={openPage} onCrop={()=>{setFocused(false);onCrop();}} canCrop={canCrop}/>:tab==='stage'?<div className="relationship-notes"><h4>{index===0?'初始关系':'阶段转折'}</h4><p>{stage.turningReason||stage.title}</p>{stage.storyTime&&<><h4>故事时间</h4><p>{stage.storyTime}</p></>}{stage.changes.length>0&&<><h4>本阶段记录</h4><ul>{stage.changes.map((change,i)=><li key={i}>{change}</li>)}</ul></>}<button className="text-button" onClick={()=>openPage(stage.fromPage)}><BookOpen size={14}/>查看阶段起始页 P.{stage.fromPage}</button><small>对应第 {stage.fromPage}–{stage.toPage} 页。一般互动归入当前阶段，重大转折才新增阶段。</small></div>:<>
            {(person||activeGroup)&&<div className="relationship-focus"><strong>{person?person.name:`${name(activeGroup!.source)} · ${name(activeGroup!.target)}`}</strong><button className="icon-button" title="显示全部关系" aria-label="显示全部关系" onClick={clear}><X size={14}/></button></div>}
            {person&&<div className="relationship-person-info"><p>{person.description||'暂无人物描述'}</p>{person.aliases.length>0&&<small>别名：{person.aliases.join('、')}</small>}<button className="text-button" disabled={!canCrop} onClick={()=>{setFocused(false);onCrop();}}><Scissors size={12}/>从当前页框选头像</button></div>}
            <div className="relationship-evidence">{relations.map((relation,i)=><article key={i}>
              <div className="relationship-evidence-pair"><span>{name(relation.source)}</span><span className="relationship-direction" aria-label={relation.directed?'指向':'相互关联'}>{relation.directed?'→':'—'}</span><span>{name(relation.target)}</span></div>
              <div className="relationship-evidence-label"><strong>{relation.label}</strong><button onClick={()=>openPage(relation.sincePage)} title={`查看第 ${relation.sincePage} 页`}>P.{relation.sincePage}<ArrowUpRight size={11}/></button></div>
              <p>{relation.evidence||'暂无记录证据'}</p>
            </article>)}</div>
            {!relations.length&&<p className="relationship-no-evidence">{person?'该人物在本阶段尚无已确认的关系。':'本阶段尚无已确认的关系。'}</p>}
          </>}
        </div>
      </aside>
    </div>
    <div className="relationship-follow"><span>阶段 {index+1} / {stages.length} · 仅记录重大转折</span>{following?<span className="following-latest">跟随最新阶段</span>:<button className="text-button" onClick={()=>onStage(null)}>跟随最新阶段 →</button>}</div>
  </div>;
}
