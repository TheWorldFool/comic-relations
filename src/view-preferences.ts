import type { Project } from '../shared/types';
import type { Point } from './graph-layout';

function read(key:string):unknown{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function write(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* Viewing remains available if storage is full or disabled. */}}
export function savedReadingPage(project:Project){const id=read(`comic-page:${project.id}`);return Math.max(0,project.pages.findIndex(p=>p.id===id));}
export function saveReadingPage(projectId:string,pageId:string){write(`comic-page:${projectId}`,pageId);}
export function savedGraphPositions(stageId:string):Record<string,Point>{
  const value=read(`comic-layout:${stageId}`);
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter(([,p])=>p&&typeof p==='object'&&Number.isFinite(p.x)&&Number.isFinite(p.y)));
}
export function saveGraphPositions(stageId:string,nodes:{id:string;position:Point}[]){write(`comic-layout:${stageId}`,Object.fromEntries(nodes.map(n=>[n.id,n.position])));}
