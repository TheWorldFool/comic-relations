import { savedGraphPositions, saveGraphPositions } from './view-preferences';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Handle, Position, MarkerType, BaseEdge, EdgeLabelRenderer, Panel, useNodesState, useReactFlow, useNodesInitialized, useStore, useViewport, getBezierPath, type NodeProps, type Node, type Edge, type EdgeProps } from '@xyflow/react';
import { LayoutGrid, Maximize2, Minus, Plus, Focus } from 'lucide-react';
import type { Character, Stage } from '../shared/types';
import { stateSummaries } from './character-display';
import { CARD_WIDTH, CARD_HEIGHT, groupRelations, layoutGraph, type Point } from './graph-layout';

type PersonNode = Node<{ person:Character; active:boolean; dimmed:boolean; connections:number; statuses:ReturnType<typeof stateSummaries>; onSelect:(id:string)=>void }>;
function PortraitNode({data}:NodeProps<PersonNode>) {
  return <button className={`portrait-card ${data.active?'is-active':''} ${data.dimmed?'is-dimmed':''}`} aria-pressed={data.active} onClick={()=>data.onSelect(data.person.id)} title={data.person.name}>
    <Handle type="target" position={Position.Top}/>
    <span className="portrait-top">{data.person.avatar?<img src={data.person.avatar} alt=""/>:<span className="portrait-initial">{data.person.name.slice(0,1)}</span>}
    <span className="portrait-copy"><strong>{data.person.name}</strong><small>初登场 P.{data.person.firstPage}</small><span>{data.connections} 位关联人物</span></span></span>
    <span className="portrait-statuses">{data.statuses.length?data.statuses.slice(0,2).map((state,i)=><span key={i} title={state.text} className={state.uncertain?'is-uncertain':''}>{state.text}</span>):<span className="status-unrecorded">状态尚未记录</span>}{data.statuses.length>2&&<b title="点击查看完整档案">+{data.statuses.length-2}</b>}</span>
    <Handle type="source" position={Position.Bottom}/>
  </button>;
}
type RouteEdge = Edge<{points:Point[]; labelPoint:Point; sourceAnchor:Point; targetAnchor:Point; count:number; active:boolean; dimmed:boolean; fullLabel:string; onSelect:()=>void}>;
function RelationEdge(props:EdgeProps<RouteEdge>) {
  const {id,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,data,label,markerStart,markerEnd,style} = props;
  if (!data) return null;
  const moved = Math.abs(sourceX-data.sourceAnchor.x)+Math.abs(sourceY-data.sourceAnchor.y)+Math.abs(targetX-data.targetAnchor.x)+Math.abs(targetY-data.targetAnchor.y)>2;
  const [path,x,y] = moved && props.source!==props.target
    ? getBezierPath({sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition})
    : [data.points.map((point,index)=>`${index?'L':'M'} ${point.x},${point.y}`).join(' '),data.labelPoint.x,data.labelPoint.y];
  return <><BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style}/><EdgeLabelRenderer>
    <button className={`relation-chip nodrag nopan ${data.active?'is-active':''} ${data.dimmed?'is-dimmed':''}`} style={{transform:`translate(-50%, -50%) translate(${x}px,${y}px)`}} onClick={data.onSelect} title={data.fullLabel} aria-label={`查看关系：${data.fullLabel}`}>
      <span>{label}</span>{data.count>1&&<b>+{data.count-1}</b>}
    </button>
  </EdgeLabelRenderer></>;
}
const nodeTypes = {person:PortraitNode};
const edgeTypes = {relation:RelationEdge};
function LayoutTools({onReset,revision,related}:{onReset:()=>void;revision:string;related:string[]}) {
  const {fitView,zoomIn,zoomOut,zoomTo} = useReactFlow();
  const {zoom}=useViewport();
  const fitted=useRef<string|null>(null);
  const ready = useNodesInitialized();
  const width = useStore(state=>state.width);
  const height = useStore(state=>state.height);
  useEffect(()=>{
    if (!ready || width<=0 || height<=0 || fitted.current===revision) return;
    const frame=requestAnimationFrame(()=>{fitted.current=revision;void fitView({padding:.18,maxZoom:1,duration:250});});
    return ()=>cancelAnimationFrame(frame);
  },[ready,revision,width,height,fitView]);
  return <><Panel position="top-right" className="graph-view-actions">
    {related.length>0&&<button className="graph-arrange" onClick={()=>void fitView({nodes:related.map(id=>({id})),padding:.2,maxZoom:1.1,duration:250})}><Focus size={15}/>定位所选关系</button>}
    <button className="graph-arrange" title="恢复自动排列的人物位置" onClick={onReset}><LayoutGrid size={15}/>整理布局</button>
  </Panel><Panel position="bottom-left" className="graph-zoom-tools">
    <button aria-label="缩小关系图" onClick={()=>void zoomOut({duration:150})}><Minus size={17}/></button>
    <button title="以原始大小显示人物和文字" aria-label="关系图原始大小" onClick={()=>void zoomTo(1,{duration:200})}>{Math.round(zoom*100)}%</button>
    <button aria-label="放大关系图" onClick={()=>void zoomIn({duration:150})}><Plus size={17}/></button>
    <button onClick={()=>void fitView({padding:.18,maxZoom:1,duration:250})}><Maximize2 size={15}/>全图</button>
  </Panel></>;
}
export default function Graph({stage,selectedPerson,selectedGroup,onSelect,onSelectGroup,viewMode='embedded'}:{viewMode?:string;stage:Stage;selectedPerson:string|null;selectedGroup:string|null;onSelect:(id:string)=>void;onSelectGroup:(id:string)=>void}) {
  const groups=useMemo(()=>groupRelations(stage.relations),[stage.relations]);
  // Polling and avatar edits should not reset the user's dragged positions.
  const topology=JSON.stringify([stage.characters.map(p=>p.id),groups.map(g=>[g.id,g.source,g.target])]);
  const layout=useMemo(()=>layoutGraph(stage.characters,groups),[topology]);
  const saved=useMemo(()=>savedGraphPositions(stage.id),[stage.id,layout]);
  const initial=useMemo<PersonNode[]>(()=>stage.characters.map(person=>({id:person.id,type:'person',position:saved[person.id]||layout.positions.get(person.id)!,width:CARD_WIDTH,height:CARD_HEIGHT,data:{person,active:false,dimmed:false,connections:0,statuses:[],onSelect}})),[layout,onSelect,saved]);
  const [nodes,setNodes,onNodesChange]=useNodesState(initial);
  const [reset,setReset]=useState(0);
  useEffect(()=>{setNodes(initial);},[initial,setNodes]);
  const group=groups.find(g=>g.id===selectedGroup);
  const focused = selectedPerson || group;
  const related = new Set(selectedPerson?[selectedPerson,...groups.filter(g=>[g.source,g.target].includes(selectedPerson)).flatMap(g=>[g.source,g.target])]:group?[group.source,group.target]:[]);
  const visibleNodes=nodes.filter(node=>stage.characters.some(p=>p.id===node.id)).map(node=>({...node,data:{...node.data,person:stage.characters.find(p=>p.id===node.id)!,statuses:stateSummaries(stage.characters.find(p=>p.id===node.id)!,stage.characters),active:node.id===selectedPerson,dimmed:!!focused&&!related.has(node.id),connections:new Set(groups.filter(g=>[g.source,g.target].includes(node.id)).flatMap(g=>[g.source,g.target]).filter(id=>id!==node.id)).size}}));
  const edges:RouteEdge[]=groups.flatMap(group=>{
    const route=layout.routes.get(group.id),source=layout.positions.get(group.source),target=layout.positions.get(group.target);
    if(!route||!source||!target)return [];
    const active=group.id===selectedGroup||!!selectedPerson&&[group.source,group.target].includes(selectedPerson);
    const dimmed=!!focused&&!active;
    const color=active?'#355e50':'#9ba89e';
    const marker={type:MarkerType.ArrowClosed,color,width:15,height:15};
    return [{id:group.id,source:group.source,target:group.target,type:'relation',label:group.relations[0].label,
      markerStart:group.relations.some(r=>r.directed&&r.source!==group.source)?marker:undefined,
      markerEnd:group.relations.some(r=>r.directed&&r.source===group.source)?marker:undefined,
      style:{stroke:color,strokeWidth:active?2:1.4,opacity:dimmed?.2:1,strokeLinejoin:'round'},
      data:{points:route.points,labelPoint:route.label,sourceAnchor:{x:source.x+CARD_WIDTH/2,y:source.y+CARD_HEIGHT},targetAnchor:{x:target.x+CARD_WIDTH/2,y:target.y},count:group.relations.length,active,dimmed,fullLabel:group.relations.map(r=>r.label).join(' / '),onSelect:()=>onSelectGroup(group.id)}}];
  });
  return <ReactFlow nodes={visibleNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onNodeDragStop={(_,node)=>saveGraphPositions(stage.id,visibleNodes.map(n=>n.id===node.id?{...n,position:node.position}:n))} fitView fitViewOptions={{padding:.25,maxZoom:1.1}} minZoom={.15} maxZoom={2} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} proOptions={{hideAttribution:true}}>
    <Background gap={24} size={1} color="#dfe4dd"/>
    <LayoutTools related={[...related]} revision={`${topology}-${reset}-${viewMode}`} onReset={()=>{const arranged=initial.map(n=>({...n,position:layout.positions.get(n.id)!}));setNodes(arranged);saveGraphPositions(stage.id,arranged);setReset(n=>n+1);}}/>
  </ReactFlow>;
}
