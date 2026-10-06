import { lazy, Suspense, useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, BookOpen, Check, ChevronLeft, ChevronRight, Download, Expand, ExternalLink, FolderOpen, ImagePlus, LoaderCircle, Maximize2, Network, Pause, Play, Plus, RotateCcw, Scissors, Settings2, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { api, json } from './api';
import { subscribeProject } from './project-sync';
const RelationshipExplorer=lazy(()=>import('./RelationshipExplorer'));
import ReviewNotice from './ReviewNotice';
const IdentityManager=lazy(()=>import('./IdentityManager'));
const PageSetup=lazy(()=>import('./PageSetup'));
import { pagesClassified, purposeLabels } from '../shared/page-selection';
import type { Project, Settings, Page, Box, PageTiming } from '../shared/types';

const kindLabels: Record<string,string> = { story:'正文', cover:'封面', ad:'广告', extra:'附页', uncertain:'待复核', blocked:'内容无法处理' };
const compact=(value?:number)=>value===undefined?'—':value>=1000?`${(value/1000).toFixed(1)}k`:String(value);
const timingLabel=(timing:PageTiming)=>`用时 ${(timing.elapsedMs/1000).toFixed(1)}s${timing.modelMs!==undefined?` · API ${(timing.modelMs/1000).toFixed(1)}s / 准备 ${((timing.preparationMs||0)/1000).toFixed(1)}s`:''} · 请求 ${timing.attempts} 次 · 输入 ${compact(timing.promptTokens)} / 输出 ${compact(timing.completionTokens)} tokens${timing.reasoningTokens?`（含思考 ${compact(timing.reasoningTokens)}）`:''}`;
type ProjectOption = { id:string; name:string; pages:number };
export default function App() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [stageIndex, setStageIndex] = useState<number | null>(null);
  const requestedStage=useRef(new URLSearchParams(window.location.search).get('stage'));
  const [personId, setPersonId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [identityOpen,setIdentityOpen]=useState(false);
  const [pageSetupOpen,setPageSetupOpen]=useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [wideGraph, setWideGraph] = useState(()=>new URLSearchParams(window.location.search).get('view')==='relationships');
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState<Box | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const cropStart = useRef<{x:number;y:number} | null>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<string | undefined>(undefined);
  projectRef.current = project?.id;
  const refreshList = useCallback(async () => setProjects(await api<ProjectOption[]>('/projects')), []);
  const loadProject = useCallback(async (id: string, initialStageId?:string|null) => {
    const p = await api<Project>(`/projects/${id}`); setProject(p); setPageIndex(0); const initialStage=p.stages.findIndex(s=>s.id===initialStageId);setStageIndex(initialStage<0?null:initialStage);setPersonId(null); setCropMode(false); localStorage.setItem('comic-project', id);
  }, []);
  useEffect(() => { void (async () => {
    try {
      const [list, config] = await Promise.all([api<ProjectOption[]>('/projects'),api<Settings>('/settings')]); setProjects(list); setSettings(config);
      const requested = new URLSearchParams(window.location.search).get('project');
      const saved = localStorage.getItem('comic-project'); const id = list.find(p => p.id === requested)?.id || list.find(p => p.id === saved)?.id || list[0]?.id;
      if (id) await loadProject(id,requestedStage.current);
    } catch(e) { setError((e as Error).message); }
  })(); }, [loadProject]);
  useEffect(()=>{
    if(!project?.id)return;
    const url=new URL(window.location.href);url.searchParams.set('project',project.id);
    window.history.replaceState(null,'',url);
  },[project?.id]);
  useEffect(() => {
    if (!project?.id) return;
    const id=project.id;
    return subscribeProject({load:()=>api<Project>(`/projects/${id}`),target:window,onError:setSyncError,onProject:p=>{
      if(projectRef.current===id)setProject(current=>current?.id===id&&current.updatedAt>p.updatedAt?current:p);
    }});
  }, [project?.id]);
  useEffect(() => { setCrop(null); setCropMode(false); }, [pageIndex,personId,project?.id]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''),4500); return () => clearTimeout(timer); }, [notice]);
  const perform = async (fn: () => Promise<unknown>) => { setError(''); setBusy(true); try { await fn(); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } };
  const mutate = async (suffix: string, options: RequestInit) => {
    if (!project) return; const id = project.id; const next = await api<Project>(`/projects/${id}${suffix}`, options);
    if (projectRef.current === id) { setProject(next); if (!next.stages.length) { setStageIndex(null); setPersonId(null); } }
    return next;
  };
  const running = project?.status === 'running';
  const locked = busy || running;
  const page = project?.pages[pageIndex];
  const stage = project?.stages[stageIndex === null ? project.stages.length - 1 : Math.min(stageIndex,project.stages.length-1)];
  const timedPages = project?.pages.filter(p=>p.timing) ?? [];
  const averageMs = timedPages.length ? Math.round(timedPages.reduce((sum,p)=>sum+p.timing!.elapsedMs,0)/timedPages.length) : 0;
  const selectPerson = useCallback((id:string) => setPersonId(id), []);
  useEffect(()=>{
    if(!project)return;
    const url=new URL(window.location.href);
    if(wideGraph)url.searchParams.set('view','relationships');else url.searchParams.delete('view');
    if(stageIndex!==null&&stage)url.searchParams.set('stage',stage.id);else url.searchParams.delete('stage');
    window.history.replaceState(null,'',url);
  },[wideGraph,stageIndex,stage?.id,project?.id]);
  const graphLink=project?`?project=${encodeURIComponent(project.id)}&view=relationships${stageIndex!==null&&stage?`&stage=${encodeURIComponent(stage.id)}`:''}`:undefined;
  const needsReset = () => !project?.processed || window.confirm('修改会清除现有阅读分析，需要按新顺序重新阅读。原始漫画保留。继续吗？');
  async function createProject() {
    await perform(async () => { const p = await api<Project>('/projects',json('POST',{name:name.trim() || '未命名漫画'})); setProject(p); localStorage.setItem('comic-project',p.id); setPageIndex(0); setStageIndex(null); setPersonId(null); setNewOpen(false); setName(''); await refreshList(); });
  }
  async function importFiles(files: FileList | File[]) {
    const images = Array.from(files).filter(file => /\.(jpe?g|png|webp|gif)$/i.test(file.name));
    if (!images.length) { setError('请选择 JPG、PNG、WebP 或 GIF 漫画图片。'); return; }
    await perform(async () => {
      let p = project;
      if (!p) { p = await api<Project>('/projects',json('POST',{name:images[0].webkitRelativePath?.split('/')[0] || images[0].name.replace(/\.[^.]+$/,'')})); setProject(p); projectRef.current=p.id; localStorage.setItem('comic-project',p.id); }
      const form = new FormData(); images.forEach(file => form.append('files',file,file.webkitRelativePath || file.name));
      const next = await api<Project>(`/projects/${p.id}/pages`, {method:'POST',body:form}); setProject(next); await refreshList(); setPageSetupOpen(true); setNotice(`已导入 ${images.length} 页，请先划分正文和封面。`);
    });
  }
  async function reorder(ids: string[]) { if (!needsReset()) return; const selected = page?.id; await perform(async () => { await mutate('/order',json('PUT',{ids})); if (selected) setPageIndex(ids.indexOf(selected)); }); }
  function movePage(delta:number) { if (!project) return; const ids=project.pages.map(p=>p.id); const target=pageIndex+delta; if (target<0||target>=ids.length) return; [ids[pageIndex],ids[target]]=[ids[target],ids[pageIndex]]; void reorder(ids); }
  function cropPoint(e:PointerEvent<HTMLDivElement>) { const r=e.currentTarget.getBoundingClientRect(); return { x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)), y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height)) }; }
  function startCrop(e:PointerEvent<HTMLDivElement>) { if (!cropMode) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); cropStart.current=cropPoint(e); setCrop(null); }
  function moveCrop(e:PointerEvent<HTMLDivElement>) { if (!cropStart.current) return; const pt=cropPoint(e), start=cropStart.current; setCrop({x:Math.min(pt.x,start.x),y:Math.min(pt.y,start.y),width:Math.abs(pt.x-start.x),height:Math.abs(pt.y-start.y)}); }
  const saveCrop = () => perform(async () => { if (!crop || !page || !personId) return; await mutate(`/characters/${personId}/avatar`,json('PUT',{pageId:page.id,...crop})); setCropMode(false); setCrop(null); setNotice('头像已更新。'); });
  const resumeAnalysis = async () => {
    if(project&&!pagesClassified(project.pages)){setPageSetupOpen(true);return;}
    await startClassifiedReading();
  };
  const startClassifiedReading = async () => {
    if(!settings?.hasKey){setSettingsOpen(true);return;}
    await mutate('/read',json('POST'));
  };

  return <div className={`app ${wideGraph?'graph-mode':'reading-mode'}`}>
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><BookOpen size={23}/></span><strong>页间</strong><span className="brand-subtitle">漫画关系阅读室</span></div>
      <div className="project-switch"><span className="tiny-label">书架 /</span><select aria-label="选择漫画" value={project?.id || ''} disabled={busy} onChange={e=>void perform(()=>loadProject(e.target.value))}><option value="" disabled>尚未添加漫画</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="icon-button" title="新建漫画" onClick={()=>setNewOpen(true)}><Plus size={17}/></button></div>
      <button className="button quiet" disabled={!project} onClick={()=>setIdentityOpen(true)}>背景与人物</button>
      <button className="button quiet" onClick={()=>setSettingsOpen(true)}><span className={`connection-dot ${settings?.hasKey?'connected':''}`}/><span className="settings-label">阅读设置</span><Settings2 size={16}/></button>
    </header>
    <main>
      <div className="workspace-heading"><div><div className="eyebrow">READ BETWEEN THE PANELS</div><h1>{project?.name || '从一页漫画，读懂人物之间。'}</h1><p>{project?.pages.length ? `${project.pages.length} 页漫画 · 已阅读 ${project.processed} 页 · ${project.stages.length} 个关系阶段` : '整理页序，顺着故事，留下每一次关系的变化。'}</p></div><div className="heading-actions"><button className="button" disabled={locked} onClick={()=>folderRef.current?.click()}><FolderOpen size={16}/>导入文件夹</button><button className="button primary" disabled={locked} onClick={()=>filesRef.current?.click()}><Plus size={17}/>导入漫画</button></div></div>
      <input hidden ref={filesRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={e=>{if(e.target.files)void importFiles(e.target.files);e.target.value='';}}/>
      <input hidden ref={folderRef} type="file" multiple {...{webkitdirectory:'',directory:''}} onChange={e=>{if(e.target.files)void importFiles(e.target.files);e.target.value='';}}/>
      {error && <div className="banner error" role="alert">{error}<button aria-label="关闭错误" onClick={()=>setError('')}><X size={16}/></button></div>}
      {syncError && <div className="banner error" role="alert">状态同步失败：{syncError} · 连接恢复后会自动更新。</div>}
      {notice && <div className="toast" role="status"><Check size={16}/>{notice}</div>}
      {project&&project.pages.length>0&&!pagesClassified(project.pages)&&<div className="review-notice"><div className="review-copy"><strong>分析前，请先确认页面用途</strong><p>批量划分正文、封面、广告和附页，确认后再开始阅读。</p></div><button className="button primary" disabled={locked} onClick={()=>setPageSetupOpen(true)}>划分页面</button></div>}
      {project&&<ReviewNotice project={project} busy={busy} onView={()=>{setPageIndex(project.processed);setWideGraph(false);}} onContinue={()=>void perform(resumeAnalysis)}/>}
      <div className="workspace-viewbar"><nav aria-label="工作区视图"><button className={!wideGraph?'active':''} aria-pressed={!wideGraph} onClick={()=>setWideGraph(false)}><BookOpen size={16}/>阅读对照</button><button className={wideGraph?'active':''} aria-pressed={wideGraph} onClick={()=>setWideGraph(true)}><Network size={16}/>关系工作台</button></nav><a className={`button small ${!project?'disabled':''}`} href={graphLink} target="_blank" rel="noopener noreferrer" aria-label="在独立标签页打开关系图"><ExternalLink size={14}/>独立打开关系图</a></div>
      <div className={`workspace ${wideGraph?'graph-wide':''}`}>
        <aside className="pages-panel panel">
          <div className="panel-header"><h2>漫画页面 <span className="count">{project?.pages.length || '—'}</span></h2><button className="text-button" disabled={locked||!project?.pages.length} onClick={()=>setPageSetupOpen(true)}>划分</button><button className="icon-button" title="按文件名自然排序" disabled={locked || !project?.pages.length} onClick={()=>{if(project)void reorder([...project.pages].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true})).map(p=>p.id));}}><ArrowUpDown size={16}/></button></div>
          <div className="page-list" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files.length&&!locked)void importFiles(e.dataTransfer.files);}}>
            {!project?.pages.length ? <div className="pages-empty"><ImagePlus size={28}/><p>还没有页面</p><span>拖入图片或点击导入</span></div> : project.pages.map((p,i)=><button draggable={!locked} onDragStart={()=>setDragId(p.id)} onDragEnd={()=>setDragId(null)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();e.stopPropagation();if(!dragId||!project||locked||dragId===p.id)return;const ids=project.pages.map(p=>p.id).filter(id=>id!==dragId);ids.splice(ids.indexOf(p.id),0,dragId);setDragId(null);void reorder(ids);}} className={`page-item ${pageIndex===i?'active':''}`} key={p.id} onClick={()=>setPageIndex(i)}>
              <div className="page-thumb"><img src={p.thumbnail} alt="" loading="lazy"/>{i<project.processed&&<span className="processed-mark"><Check size={10}/></span>}</div><div className="page-item-text"><span className="page-number">{String(i+1).padStart(3,'0')}</span><span className="page-name" title={p.name}>{p.name}</span><span className={`page-kind ${p.analysis?.kind==='uncertain'?'warning':''}`}>{p.purpose?purposeLabels[p.purpose]:p.override==='skip'?'已排除':p.override==='story'?'指定正文':p.analysis?kindLabels[p.analysis.kind]:'待划分'}</span></div>{running&&i===project.processed&&<LoaderCircle size={14} className="spin"/>}
            </button>)}
          </div>
          <div className="page-tools"><button className="icon-button" title="前移页面" disabled={locked||pageIndex===0||!page} onClick={()=>movePage(-1)}><ArrowUp size={15}/></button><button className="icon-button" title="后移页面" disabled={locked||!page||pageIndex===(project?.pages.length||0)-1} onClick={()=>movePage(1)}><ArrowDown size={15}/></button><span>拖动调整顺序</span><button className="icon-button" title="移除当前页" disabled={locked||!page} onClick={()=>{if(!page||!project)return;if(window.confirm(pageIndex<project.processed?'此页已参与分析，移除后需要重新阅读。继续吗？':'从项目移除此页？'))void perform(async()=>{await mutate(`/pages/${page.id}`,json('DELETE'));setPageIndex(Math.max(0,pageIndex-1));});}}><Trash2 size={15}/></button></div>
        </aside>
        <section className="reader-panel panel">
          <div className="panel-header"><h2>原稿阅读</h2><div className="reader-pagination"><button className="icon-button" aria-label="上一页" disabled={pageIndex===0} onClick={()=>setPageIndex(i=>i-1)}><ChevronLeft size={16}/></button><span>{page?`${pageIndex+1} / ${project?.pages.length}`:'— / —'}</span><button className="icon-button" aria-label="下一页" disabled={!page||pageIndex===(project?.pages.length||0)-1} onClick={()=>setPageIndex(i=>i+1)}><ChevronRight size={16}/></button></div></div>
          <div className="reader-canvas" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!locked&&e.dataTransfer.files.length)void importFiles(e.dataTransfer.files);}}>
            {page ? <div className={`comic-image-wrap ${cropMode?'cropping':''}`} style={{width:`${zoom}%`}} onPointerDown={startCrop} onPointerMove={moveCrop} onPointerUp={()=>{cropStart.current=null;}} onPointerCancel={()=>{cropStart.current=null;}}><img className="comic-image" draggable={false} src={page.image} alt={`第 ${pageIndex+1} 页：${page.name}`}/>{crop&&cropMode&&<div className="crop-box" style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.width*100}%`,height:`${crop.height*100}%`}}/>}</div> : <div className="reader-empty"><div className="empty-book"><span/><span/><BookOpen size={40} strokeWidth={1.2}/></div><span className="eyebrow">YOUR STORY STARTS HERE</span><h3>把故事放进来</h3><p>导入一组漫画图片，按页序慢慢展开。<br/>人物、相遇与转变，都有迹可循。</p><button className="button" onClick={()=>filesRef.current?.click()} disabled={busy}><Upload size={15}/>选择漫画图片</button><small>JPG / PNG / WebP / GIF</small></div>}
          </div>
          {cropMode ? <div className="crop-toolbar"><span>在原图拖动框选人物头像</span><button className="button small" onClick={()=>{setCropMode(false);setCrop(null);}}>取消</button><button className="button primary small" disabled={busy||!crop||crop.width<0.005||crop.height<0.005} onClick={()=>void saveCrop()}>保存头像</button></div> : <div className="reader-toolbar"><select aria-label="页面用途" disabled={!page||locked} value={page?.override||'auto'} onChange={e=>{if(!page||!project)return;if(pageIndex<project.processed&&!needsReset())return;void perform(()=>mutate(`/pages/${page.id}`,json('PATCH',{override:e.target.value})));}}><option value="auto">待确认用途</option><option value="story">作为正文</option><option value="skip">排除此页</option></select><div className="zoom-controls"><button className="icon-button" title="缩小" onClick={()=>setZoom(z=>Math.max(50,z-25))}><ZoomOut size={15}/></button><span>{zoom}%</span><button className="icon-button" title="放大" onClick={()=>setZoom(z=>Math.min(300,z+25))}><ZoomIn size={15}/></button><button className="icon-button" title="适应宽度" onClick={()=>setZoom(100)}><Maximize2 size={15}/></button></div></div>}
          {page?.analysis&&<div className="page-summary"><span className={`tag ${page.analysis.kind==='uncertain'?'amber':''}`}>{kindLabels[page.analysis.kind]}</span><p>{page.analysis.kind==='story'?page.analysis.summary:page.analysis.reason}</p>{page.timing&&<small className="page-timing">{timingLabel(page.timing)}</small>}</div>}
        </section>
        <section className="relations-panel panel">
          <div className="panel-header"><h2>人物关系 <span className="live-label">随故事变化</span></h2><div className="inline-actions"><a className={`icon-button ${!project?'disabled':''}`} title="导出阅读结果 JSON" href={project?`/api/projects/${project.id}/export`:undefined}><Download size={16}/></a><button className="text-button" title={wideGraph?"返回阅读对照":"展开为关系工作台"} onClick={()=>setWideGraph(w=>!w)}><Expand size={14}/>{wideGraph?"返回对照":"展开"}</button></div></div>
          {stage ? <Suspense fallback={<div className="relations-loading" role="status"><LoaderCircle className="spin" size={20}/>正在加载关系图…</div>}><RelationshipExplorer key={project!.id} stage={stage} stages={project!.stages} selectedPerson={personId} onSelectPerson={selectPerson} onClearPerson={()=>setPersonId(null)} following={stageIndex===null} onStage={index=>{setStageIndex(index);setPersonId(null);}} onPage={page=>{setPageIndex(page-1);setWideGraph(false);}} canCrop={!locked&&!!page} onCrop={()=>{setCropMode(true);setWideGraph(false);}}/></Suspense> : <div className="relations-empty"><div className="empty-network"><Network size={43} strokeWidth={1.15}/></div><h3>关系，随着故事浮现</h3><p>阅读后在这里查看人物关系。<br/>一般互动更新当前图，重大转折才新增阶段。</p><div className="empty-legend"><span/><i/> <span/><i/> <span/></div><small>每个阶段都有对应的漫画页码</small></div>}

        </section>
      </div>
          <div className="reading-controls workspace-status">{project?.error&&<div className="job-message" role="alert">{project.error}{project.pages[project.processed]&&<button className="text-button" onClick={()=>{setPageIndex(project.processed);setWideGraph(false);}}>查看待处理页 →</button>}</div>}<div className="reading-progress"><div><span>{running?<><LoaderCircle className="spin" size={12}/>正在阅读第 {(project?.processed||0)+1} 页</>:project?.status==='completed'?'阅读完成':project?.status==='paused'?'阅读已暂停':project?.status==='error'?'本页阅读失败':'准备阅读'}</span><small>{project?.processed||0} / {project?.pages.length||0}{averageMs?` · 均 ${(averageMs/1000).toFixed(1)}s/页`:''}</small></div><progress value={project?.processed||0} max={project?.pages.length||1}/></div><div className="reading-buttons"><select aria-label="分格阅读方向" disabled={locked||!project} value={project?.direction||'rtl'} onChange={e=>{if(needsReset())void perform(()=>mutate('',json('PATCH',{direction:e.target.value})));}}><option value="rtl">分格从右到左</option><option value="ltr">分格从左到右</option></select>{project?.processed!==0&&project&&<button className="icon-button" title="清除分析并重新阅读" disabled={locked} onClick={()=>{if(needsReset())void perform(()=>mutate('/reset',json('POST')));}}><RotateCcw size={15}/></button>}<button className="button primary read-button" disabled={busy||!project?.pages.length||project.status==='completed'} onClick={()=>void perform(async()=>{if(running){await api(`/projects/${project!.id}/pause`,json('POST'));setNotice('正在暂停，已完成页面会保留。');}else await resumeAnalysis();})}>{running?<><Pause size={14}/>暂停阅读</>:<><Play size={14}/>{project?.status==='completed'?'阅读完成':project&&!pagesClassified(project.pages)?'先划分页面':project?.status==='paused'||project?.status==='error'||project?.processed?'继续分析':'开始阅读'}</>}</button></div></div>
      <footer><span>页序决定故事。重大转折，才留下新的阶段。</span><span>原图与阅读进度保存在本机 · 阅读时图片发送至配置的 API</span></footer>
    </main>
    {busy&&<div className="busy-pill" role="status"><LoaderCircle size={15} className="spin"/>处理中…</div>}
    {newOpen&&<div className="modal-backdrop"><form className="modal compact" onSubmit={e=>{e.preventDefault();void createProject();}}><div className="modal-heading"><h2>新建漫画</h2><button type="button" className="icon-button" aria-label="关闭" onClick={()=>setNewOpen(false)}><X size={18}/></button></div><label>漫画名称<input autoFocus value={name} maxLength={100} onChange={e=>setName(e.target.value)} placeholder="给这段故事起个名字"/></label><button className="button primary" disabled={busy}>创建并开始整理</button></form></div>}
    {pageSetupOpen&&project&&<Suspense fallback={<div className="busy-pill">正在加载页面划分…</div>}><PageSetup key={project.id} project={project} onClose={()=>setPageSetupOpen(false)} onSave={async(pages,resetAnalysis)=>(await mutate('/page-selection',json('PUT',{pages,resetAnalysis})))!} onSearch={async hint=>(await mutate('/background/research',json('POST',{hint})))!} onApply={async researchId=>(await mutate('/background/apply',json('POST',{researchId})))!} onRead={startClassifiedReading}/></Suspense>}
    {identityOpen&&project&&<Suspense fallback={<div className="busy-pill" role="status">正在加载人物资料…</div>}><IdentityManager key={project.id} project={project} busy={busy} onClose={()=>setIdentityOpen(false)} onPrepare={()=>{setIdentityOpen(false);setPageSetupOpen(true);}} onResearch={async hint=>(await mutate('/background/research',json('POST',{hint})))!} onApply={async researchId=>(await mutate('/background/apply',json('POST',{researchId})))!} onContext={workContext=>mutate('',json('PATCH',{workContext}))} onMerge={async(source,target)=>{await mutate('/characters/merge',json('POST',{source,target}));setPersonId(target);}} onUndo={async()=>{await mutate('/characters/merge/undo',json('POST'));setPersonId(null);}} onPage={page=>{setPageIndex(page-1);setWideGraph(false);setIdentityOpen(false);}}/></Suspense>}
    {settingsOpen&&settings&&<SettingsModal settings={settings} locked={!!running} onClose={()=>setSettingsOpen(false)} onSave={s=>{setSettings(s);setNotice('阅读设置已保存。');}}/>}
  </div>;
}

function SettingsModal({settings,locked,onClose,onSave}:{settings:Settings;locked:boolean;onClose:()=>void;onSave:(s:Settings)=>void}) {
  const [baseUrl,setBaseUrl]=useState(settings.baseUrl),[model,setModel]=useState(settings.model),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
  async function save(test=false) { setBusy(true);setMessage('');setFailed(false);try{const s=await api<Settings>('/settings',json('PUT',{baseUrl,model,apiKey:key}));onSave(s);setKey('');if(test){await api('/settings/test',json('POST'));setMessage('连接成功，模型已接受图片输入。');}else onClose();}catch(e){setFailed(true);setMessage((e as Error).message);}finally{setBusy(false);} }
  return <div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();void save();}}><div className="modal-heading"><div><span className="eyebrow">READING ENGINE</span><h2>阅读设置</h2></div><button type="button" className="icon-button" aria-label="关闭设置" onClick={onClose}><X size={18}/></button></div><p>连接 DeepSeek 视觉模型，按漫画页序理解故事。</p><label>API 地址<input type="url" required value={baseUrl} onChange={e=>setBaseUrl(e.target.value)}/></label><label>模型名称<input required value={model} onChange={e=>setModel(e.target.value)}/><small>需要支持图片输入和 JSON 输出的模型。</small></label><label>API Key<input type="password" autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)} placeholder={settings.hasKey?'已配置，留空保留现有密钥':'sk-…'}/><small>密钥仅保存在本机服务端，不写入浏览器存储。更换 API 地址需重新填写。</small></label>{locked&&<div className="job-message">请先暂停阅读，再更改配置。</div>}{message&&<div className={`banner ${failed?'error':'success'}`} role="status">{message}</div>}<div className="modal-actions"><button type="button" className="button" disabled={busy||locked} onClick={()=>void save(true)}>{busy?<LoaderCircle size={15} className="spin"/>:<Network size={15}/>}保存并测试图片连接</button><button className="button primary" disabled={busy||locked}>保存设置</button></div><small className="muted">连接测试会发送一张小型测试图，并产生少量 API 用量。</small></form></div>;
}
