import { useState } from 'react';
import { ArrowUpRight, Scissors, Search } from 'lucide-react';
import type { Character, CharacterFact } from '../shared/types';
import { factTitle, stateSummaries } from './character-display';

type Props={people:Character[];person?:Character;toPage:number;onSelect:(id:string)=>void;onClear:()=>void;onPage:(page:number)=>void;onCrop:()=>void;canCrop:boolean};
export default function CharacterDossier({people,person,toPage,onSelect,onClear,onPage,onCrop,canCrop}:Props){
  const [query,setQuery]=useState('');
  const filtered=people.filter(p=>[p.name,...p.aliases,p.appearance||'',p.description].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  if(!person)return <div className="dossier-directory"><div className="dossier-directory-tools"><p className="dossier-scope">本阶段人物 · 截至第 {toPage} 页</p><label className="dossier-search"><Search size={15}/><input type="search" aria-label="搜索本阶段角色档案" placeholder="搜索姓名、别名或外观" value={query} onChange={e=>setQuery(e.target.value)}/></label><small>{query?`找到 ${filtered.length} 位人物`:`共 ${people.length} 位人物`}</small></div>{filtered.map(p=><button key={p.id} className="dossier-person" onClick={()=>onSelect(p.id)}>
    {p.avatar?<img src={p.avatar} alt=""/>:<span className="dossier-avatar">{p.name.slice(0,1)}</span>}<span><strong>{p.name}</strong><small>{p.description||'暂无人物简介'}</small><em>{stateSummaries(p,people)[0]?.text||'尚未记录状态'}</em></span><ArrowUpRight size={14}/>
  </button>)}{!filtered.length&&<p className="relationship-no-evidence">{people.length?'没有匹配的人物，试试别名或外观关键词。':'本阶段尚未识别人物。'}</p>}</div>;
  const renderFact=(fact:CharacterFact,index:number)=><article className={`dossier-fact ${fact.certainty==='uncertain'?'is-uncertain':''}`} key={index}>
    <div><span>{factTitle(fact,people)}</span><button onClick={()=>onPage(fact.sincePage)}>P.{fact.sincePage}<ArrowUpRight size={11}/></button></div>
    <strong>{fact.value}{fact.certainty==='uncertain'&&<small>待确认</small>}</strong><p>{fact.evidence}</p>
  </article>;
  return <div className="character-dossier">
    <div className="dossier-navigation"><button className="text-button" onClick={onClear}>← 全部档案</button><span>截至第 {toPage} 页</span></div>
    <div className="dossier-heading">{person.avatar?<img src={person.avatar} alt={`${person.name}的头像`}/>:<span className="dossier-avatar">{person.name.slice(0,1)}</span>}<div><h4>{person.name}</h4><button className="text-button" onClick={()=>onPage(person.firstPage)}>初登场 · 第 {person.firstPage} 页 ↗</button>{!!person.aliases.length&&<p>别名：{person.aliases.join('、')}</p>}</div></div>
    <p className="dossier-description">{person.description||'暂无人物简介'}</p>{person.nameType==='descriptive'&&<p className="dossier-empty">暂用外观称呼，真名尚未确认。</p>}{person.appearance&&<p className="dossier-description">辨认特征：{person.appearance}</p>}<button className="text-button dossier-crop" disabled={!canCrop} onClick={onCrop}><Scissors size={12}/>从当前页框选头像</button>
    <section><h4>当前状态 <small>{person.statuses?.length||0}</small></h4>{person.statuses?.length?person.statuses.map(renderFact):<p className="dossier-empty">尚未提取状态。继续阅读时，会根据作品证据记录。</p>}</section>
    <section><h4>身份与背景</h4>{person.profile?.length?person.profile.map(renderFact):<p className="dossier-empty">暂无结构化档案，已有信息见人物简介。</p>}</section>
    {!!person.records?.length&&<details className="dossier-history"><summary>变化与线索记录 <small>{person.records.length}</small></summary>{[...person.records].reverse().map((record,i)=><article key={i}><div><span>{record.action==='remove'?'撤销记录':record.certainty==='uncertain'?'待确认线索':'确认记录'} · {factTitle(record,people)}</span><button onClick={()=>onPage(record.sincePage)}>P.{record.sincePage} ↗</button></div><strong>{record.value}</strong><p>{record.evidence}</p></article>)}</details>}
  </div>;
}
