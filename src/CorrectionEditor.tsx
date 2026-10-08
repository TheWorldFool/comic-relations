import { useEffect, useState } from 'react';
import type { CorrectionInput, Project } from '../shared/types';

export default function CorrectionEditor({project,locked,onSave,onUnlock}:{project:Project;locked:boolean;onSave:(input:CorrectionInput)=>void;onUnlock:(id:string)=>void}){
  const [scope,setScope]=useState<'once'|'fixed'>('once');
  const [dimension,setDimension]=useState(''),[section,setSection]=useState<'profile'|'status'>('status'),[target,setTarget]=useState(''),[directed,setDirected]=useState(true);
  const [evidencePage,setEvidencePage]=useState(project.processed);
  const [kind,setKind]=useState<'character'|'fact'|'relation'>('character');
  const [personId,setPersonId]=useState(project.characters[0]?.id||'');
  const [entry,setEntry]=useState('0');
  const [name,setName]=useState(''),[aliases,setAliases]=useState(''),[description,setDescription]=useState(''),[appearance,setAppearance]=useState('');
  const [nameType,setNameType]=useState<'named'|'descriptive'>('named');
  const [certainty,setCertainty]=useState<'confirmed'|'uncertain'>('confirmed');
  const [value,setValue]=useState(''),[evidence,setEvidence]=useState(''),[remove,setRemove]=useState(false);
  const person=project.characters.find(p=>p.id===personId);
  const facts=[...(person?.profile||[]).map(fact=>({section:'profile' as const,fact})),...(person?.statuses||[]).map(fact=>({section:'status' as const,fact}))];
  const adding=entry==='new';
  const selected=adding?undefined:facts[Number(entry)],relation=adding?undefined:project.relations[Number(entry)];
  // Compare values so periodic project refreshes do not discard an unsaved edit.
  const personFields=JSON.stringify(person&&[person.name,person.aliases,person.description,person.appearance,person.nameType]);
  const selectedFields=JSON.stringify(kind==='fact'?selected:kind==='relation'?relation:null);
  useEffect(()=>{if(kind==='fact'&&!facts.length||kind==='relation'&&!project.relations.length)setEntry('new');},[kind,personId,facts.length,project.relations.length]);
  useEffect(()=>{if(!person)setPersonId(project.characters[0]?.id||'');},[person,project.characters]);
  useEffect(()=>{if(person){setName(person.name);setAliases(person.aliases.join('、'));setDescription(person.description);setAppearance(person.appearance||'');setNameType(person.nameType||'named');}},[personId,personFields]);
  useEffect(()=>{setEntry(current=>current==='new'?'new':'0');},[personId,kind]);
  useEffect(()=>{setValue(kind==='fact'?selected?.fact.value||'':kind==='relation'?relation?.label||'':'');setEvidence('');setRemove(false);setCertainty(selected?.fact.certainty||'confirmed');setEvidencePage((kind==='fact'?selected?.fact.sincePage:relation?.sincePage)||project.processed);},[kind,personId,entry,selectedFields]);
  const label=(id:string)=>project.characters.find(p=>p.id===id)?.name||id;
  return <div className="correction-editor">
    <p className="identity-note">校正更新当前结论，已结束的阶段保留原记录。默认允许后续剧情更新；仅在需要阻止模型覆盖时选择持续固定。</p>
    <form onSubmit={event=>{event.preventDefault();
      if(kind==='character'&&person)onSave({scope,kind,personId,name,aliases:aliases.split(/[、,，\n]/).map(s=>s.trim()).filter(Boolean),description,appearance,nameType});
      if(kind==='fact'&&selected)onSave({scope,kind,personId,section:selected.section,action:remove?'remove':'upsert',fact:{...selected.fact,sincePage:evidencePage,certainty,value:remove?selected.fact.value:value,evidence}});
      if(kind==='relation'&&relation)onSave({scope,kind,action:remove?'remove':'upsert',relation:{...relation,sincePage:evidencePage,label:remove?relation.label:value,evidence}});
      if(adding&&kind==='fact'&&person)onSave({scope,kind,personId,section,action:'upsert',fact:{key:dimension.trim(),label:dimension.trim(),value,certainty,evidence,sincePage:evidencePage,target:target||undefined}});
      if(adding&&kind==='relation'&&person&&target)onSave({scope,kind,action:'upsert',relation:{source:personId,target,kind:dimension.trim(),label:value,directed,evidence,sincePage:evidencePage}});
    }}>
      <label>校正内容<select value={kind} disabled={locked} onChange={e=>{setKind(e.target.value as typeof kind);setEntry('0');}}><option value="character">人物姓名与外貌</option><option value="fact">人物档案与状态</option><option value="relation">人物关系</option></select></label>
      {(kind!=='relation'||adding)&&<label>人物<select value={personId} disabled={locked} onChange={e=>setPersonId(e.target.value)}>{project.characters.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      {kind==='character'?<>
        <label>姓名<input required maxLength={200} disabled={locked||!person} value={name} onChange={e=>setName(e.target.value)}/></label>
        <label>称呼类型<select disabled={locked} value={nameType} onChange={e=>setNameType(e.target.value as typeof nameType)}><option value="named">已确认姓名</option><option value="descriptive">临时外观称呼</option></select></label>
        <label>别名（顿号分隔）<input disabled={locked} value={aliases} onChange={e=>setAliases(e.target.value)}/></label>
        <label>简介<textarea maxLength={2000} disabled={locked} value={description} onChange={e=>setDescription(e.target.value)}/></label>
        <label>辨认特征<textarea maxLength={1000} disabled={locked} value={appearance} onChange={e=>setAppearance(e.target.value)}/></label>
      </>:<>
        <label>选择记录<select value={entry} disabled={locked} onChange={e=>setEntry(e.target.value)}><option value="new">＋ 补充遗漏记录</option>{kind==='fact'?facts.map((item,i)=><option key={i} value={i}>{item.fact.label}{item.fact.target?` → ${label(item.fact.target)}`:''}：{item.fact.value}</option>):project.relations.map((r,i)=><option key={i} value={i}>{label(r.source)} {r.directed?'→':'↔'} {label(r.target)}：{r.label}</option>)}</select></label>
        {adding&&<>
          {kind==='fact'&&<label>记录位置<select value={section} disabled={locked} onChange={e=>setSection(e.target.value as typeof section)}><option value="status">人物状态</option><option value="profile">人物档案</option></select></label>}
          <label>{kind==='fact'?'属性名称':'关系类型'}<input required maxLength={100} disabled={locked} value={dimension} onChange={e=>setDimension(e.target.value)} placeholder={kind==='fact'?'例如：健康、职业、态度':'例如：亲属、合作'}/></label>
          <label>{kind==='relation'?'关系对象':'状态对象（可不选）'}<select required={kind==='relation'} disabled={locked} value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择人物</option>{project.characters.filter(p=>p.id!==personId&&p.identityState!=='pending'&&!p.archived).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {kind==='relation'&&<label className="correction-remove"><input type="checkbox" disabled={locked} checked={directed} onChange={e=>setDirected(e.target.checked)}/>单向关系（由所选人物指向对象）</label>}
        </>}
        {!adding&&<label className="correction-remove"><input type="checkbox" disabled={locked} checked={remove} onChange={e=>setRemove(e.target.checked)}/>撤销这项错误结论</label>}
        {!remove&&<label>正确内容<input required maxLength={300} disabled={locked} value={value} onChange={e=>setValue(e.target.value)}/></label>}
        {kind==='fact'&&!remove&&<label>确定程度<select disabled={locked} value={certainty} onChange={e=>setCertainty(e.target.value as typeof certainty)}><option value="confirmed">已确认</option><option value="uncertain">待确认</option></select></label>}
        <label>证据页码<input type="number" required min={1} max={project.processed} disabled={locked} value={evidencePage} onChange={e=>setEvidencePage(Number(e.target.value))}/></label>
        <label>校正依据<textarea required maxLength={2000} disabled={locked} value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="填写漫画中的证据或误判原因"/></label>
      </>}
      <label>校正方式<select disabled={locked} value={scope} onChange={e=>setScope(e.target.value as typeof scope)}><option value="once">仅校正当前结论，允许后续剧情更新</option><option value="fixed">持续固定，直到手动解除</option></select></label>
      <div className="modal-actions"><button className="button primary" disabled={locked||(kind==='character'?!person:adding?!person||!dimension.trim()||kind==='relation'&&(!target||target===personId):kind==='fact'?!selected:!relation)}>{scope==='fixed'?'保存并持续固定':'保存本次校正'}</button></div>
    </form>
    <div className="identity-mentions"><p className="identity-note">已固定 {project.corrections?.length||0} 项；解除档案事实、状态或关系固定后，按已保存证据重算；姓名与外貌允许后续阅读更新。旧版未保存的证据无法补回。</p>{project.corrections?.map(c=><article key={c.id}><strong>{c.kind==='character'?`${label(c.personId)}：姓名与外貌`:c.kind==='fact'?`${label(c.personId)}：${c.fact.label}`:`${label(c.relation.source)} → ${label(c.relation.target)}：${c.relation.label}`}</strong><small>校正于 P.{c.page}</small><button className="text-button" disabled={locked} onClick={()=>onUnlock(c.id)}>解除固定</button></article>)}</div>
  </div>;
}
