import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Network, Scissors, X } from 'lucide-react';
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
  const phaseNav=useRef<HTMLElement>(null);
  const inspectorContent=useRef<HTMLDivElement>(null);
  const graphTab=useRef<HTMLButtonElement>(null);
  const inspectorClose=useRef<HTMLButtonElement>(null);
  const closeInspector=useCallback(()=>{setInspectorOpen(false);graphTab.current?.focus();},[]);
  useEffect(()=>{if(inspectorOpen)inspectorClose.current?.focus();},[inspectorOpen]);
  useEffect(()=>{setSelectedGroup(null);},[stage.id]);
  useEffect(()=>{if(inspectorContent.current)inspectorContent.current.scrollTop=0;},[stage.id,selectedPerson,selectedGroup,tab]);
  useEffect(()=>{
    if(!inspectorOpen)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('.modal-backdrop'))closeInspector();};
    window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
  },[inspectorOpen,closeInspector]);
  useEffect(()=>{
    const nav=phaseNav.current;
    const current=nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if(!nav||!current)return;
    if(current.offsetLeft<nav.scrollLeft||current.offsetLeft+current.offsetWidth>nav.scrollLeft+nav.clientWidth)
      nav.scrollLeft=Math.max(0,current.offsetLeft-18);
  },[stage.id]);
  const groups=useMemo(()=>groupRelations(stage.relations),[stage.relations]);
  const activeGroup=groups.find(g=>g.id===selectedGroup);
  const person=stage.characters.find(p=>p.id===selectedPerson);
  const index=stages.findIndex(s=>s.id===stage.id);
  const relations=activeGroup?activeGroup.relations:person?stage.relations.filter(r=>r.source===person.id||r.target===person.id):stage.relations;
  const name=(id:string)=>stage.characters.find(p=>p.id===id)?.name||id;
  const selectPerson=useCallback((id:string)=>{setSelectedGroup(null);setTab('dossier');setInspectorOpen(true);onSelectPerson(id);},[onSelectPerson]);
  const selectGroup=(id:string)=>{onClearPerson();setSelectedGroup(id);setTab('relations');setInspectorOpen(true);};
  const clear=()=>{onClearPerson();setSelectedGroup(null);};
  return <div className="relationship-explorer">
    <div className="relationship-stagebar"><div className="relationship-heading">
      <span className="relationship-stage-number">{String(index+1).padStart(2,'0')}</span>
      <div><span className="relationship-kicker">当前关系阶段</span><h3 title={stage.title}>{stage.title}</h3><div className="relationship-meta"><span><BookOpen size={12}/>第 {stage.fromPage}–{stage.toPage} 页</span>{stage.storyTime&&<span>{stage.storyTime}</span>}</div></div>
      <button className="icon-button" title="查看阶段起始页" aria-label="查看阶段起始页" onClick={()=>onPage(stage.fromPage)}><ArrowUpRight size={18}/></button>
    </div>
    <nav ref={phaseNav} className="relationship-phases" aria-label="关系阶段">
      {stages.map((s,i)=><button key={s.id} aria-current={s.id===stage.id?'step':undefined} className={`relationship-phase ${s.id===stage.id?'is-current':''}`} onClick={()=>onStage(i)}>
        <span>{String(i+1).padStart(2,'0')}<small>第 {s.fromPage}–{s.toPage} 页</small></span><strong title={s.title}>{s.title}</strong>
      </button>)}
    </nav></div>
    <div className="relationship-toolbar"><div className="relationship-tools"><span><b>{stage.characters.length}</b> 人物<i/> <b>{stage.relations.length}</b> 关系</span><select aria-label="聚焦人物" value={selectedPerson||''} onChange={e=>e.target.value?selectPerson(e.target.value):clear()}><option value="">全部人物</option>{stage.characters.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    <nav className="relationship-views" aria-label="关系图与详情"><button ref={graphTab} className={!inspectorOpen?'is-current':''} aria-pressed={!inspectorOpen} onClick={closeInspector}><Network size={14}/>关系图</button>{([{id:'dossier',label:'角色档案'},{id:'relations',label:'关系证据'},{id:'stage',label:'阶段说明'}] as const).map(view=><button key={view.id} className={inspectorOpen&&tab===view.id?'is-current':''} aria-pressed={inspectorOpen&&tab===view.id} onClick={()=>{setTab(view.id);setInspectorOpen(true);}}>{view.label}</button>)}</nav></div>
    <div className={`relationship-body ${inspectorOpen?'has-inspector':''}`}>
      <div className="relationship-map"><div className="relationship-canvas"><Graph key={stage.id} stage={stage} selectedPerson={selectedPerson} selectedGroup={selectedGroup} onSelect={selectPerson} onSelectGroup={selectGroup}/></div><div className="relationship-legend"><span>拖动人物 · 点击关系查看证据</span><span>→ 有向关系</span></div></div>
      <aside className="relationship-inspector" aria-label="关系详情" hidden={!inspectorOpen}>
        <div className="inspector-heading"><strong>{tab==='dossier'?'角色档案':tab==='relations'?`关系证据 · ${relations.length}`:'阶段说明'}</strong><button ref={inspectorClose} className="text-button" onClick={closeInspector} aria-label="关闭详情，返回关系图"><X size={15}/>收起详情</button></div>
        <div ref={inspectorContent} className="relationship-inspector-content">
          {tab==='dossier'?<CharacterDossier key={stage.id} people={stage.characters} person={person} toPage={stage.toPage} onSelect={selectPerson} onClear={clear} onPage={onPage} onCrop={onCrop} canCrop={canCrop}/>:tab==='stage'?<div className="relationship-notes"><h4>{index===0?'初始关系':'阶段转折'}</h4><p>{stage.turningReason||stage.title}</p>{stage.storyTime&&<><h4>故事时间</h4><p>{stage.storyTime}</p></>}{stage.changes.length>0&&<><h4>本阶段记录</h4><ul>{stage.changes.map((change,i)=><li key={i}>{change}</li>)}</ul></>}<small>对应第 {stage.fromPage}–{stage.toPage} 页。一般互动归入当前阶段，重大转折才新增阶段。</small></div>:<>
            {(person||activeGroup)&&<div className="relationship-focus"><strong>{person?person.name:`${name(activeGroup!.source)} · ${name(activeGroup!.target)}`}</strong><button className="icon-button" title="显示全部关系" aria-label="显示全部关系" onClick={clear}><X size={14}/></button></div>}
            {person&&<div className="relationship-person-info"><p>{person.description||'暂无人物描述'}</p>{person.aliases.length>0&&<small>别名：{person.aliases.join('、')}</small>}<button className="text-button" disabled={!canCrop} onClick={onCrop}><Scissors size={12}/>从当前页框选头像</button></div>}
            <div className="relationship-evidence">{relations.map((relation,i)=><article key={i}>
              <div className="relationship-evidence-pair"><span>{name(relation.source)}</span><span className="relationship-direction" aria-label={relation.directed?'指向':'相互关联'}>{relation.directed?'→':'—'}</span><span>{name(relation.target)}</span></div>
              <div className="relationship-evidence-label"><strong>{relation.label}</strong><button onClick={()=>onPage(relation.sincePage)} title={`查看第 ${relation.sincePage} 页`}>P.{relation.sincePage}<ArrowUpRight size={11}/></button></div>
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
