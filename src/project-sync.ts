import type { Project } from '../shared/types';

// A paused/error tab must still discover server-side recovery or another tab's changes.
export function subscribeProject(options: {
  load:()=>Promise<Project>; onProject:(p:Project)=>void; onError:(message:string)=>void;
  target:EventTarget; intervalMs?:number;
}) {
  let active=true, pending=false;
  const refresh=async()=>{
    if(!active||pending)return;
    pending=true;
    try { const p=await options.load(); if(active){options.onProject(p);options.onError('');} }
    catch(error){if(active)options.onError((error as Error).message);}
    finally{pending=false;}
  };
  const onFocus=()=>{void refresh();};
  const timer=setInterval(onFocus,options.intervalMs??2500);
  options.target.addEventListener('focus',onFocus);
  onFocus();
  return ()=>{active=false;clearInterval(timer);options.target.removeEventListener('focus',onFocus);};
}
