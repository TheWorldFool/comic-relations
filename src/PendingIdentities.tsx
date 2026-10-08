import { identityView } from '../shared/identity-people';
import type { Project } from '../shared/types';

export default function PendingIdentities({project,locked,onPage,onChoose,onConfirm,onReview}:{
  project:Project;locked:boolean;onPage:(page:number)=>void;onChoose:(source:string,target:string)=>void;
  onConfirm:(id:string)=>void;onReview:(id:string)=>void;
}){
  project=identityView(project);
  const pending=project.characters.filter(c=>c.identityState==='pending');
  return <div className="pending-identities">
    <p className="identity-note">这些出场已保留剧情、状态和关系证据，身份尚未确定，暂不进入正式关系图。继续阅读会尝试补证据；也可选择对应人物，或确认是独立人物。</p>
    {!pending.length&&<p className="identity-note">目前没有待定身份。</p>}
    {pending.map(person=><article className="pending-person" key={person.id}>
      <strong>{person.name}</strong><p>{person.identityEvidence||person.appearance||person.description}</p>
      <div className="identity-reference-images">{[...(person.references||[]),...(project.appearances||[]).filter(a=>a.trackId===person.id&&!a.characterId&&a.observed.crop).slice(-4).map(a=>({url:a.observed.crop!,page:a.page,view:a.observed.view}))].map(ref=><button type="button" key={ref.url} onClick={()=>onPage(ref.page)} title={`查看 P.${ref.page}`}><img src={ref.url} alt={`${person.name}在第${ref.page}页的参考图`}/><small>P.{ref.page}</small></button>)}</div>
      <div className="pending-candidates">{person.identityCandidates?.map(id=>{const candidate=project.characters.find(c=>c.id===id);return candidate&&<button className="button" disabled={locked} key={id} onClick={()=>onChoose(person.id,id)}>核对是否为 {candidate.name}</button>;})}</div>
      <div className="modal-actions"><button className="text-button" onClick={()=>onPage(person.firstPage)}>初次出场 P.{person.firstPage} ↗</button><button className="button" disabled={locked} onClick={()=>onReview(person.id)}>AI 再次复核</button><button className="button" disabled={locked} onClick={()=>onChoose(person.id,'')}>选择对应人物</button><button className="button primary" disabled={locked} onClick={()=>onConfirm(person.id)}>确认是独立人物</button></div>
    </article>)}
  </div>;
}
