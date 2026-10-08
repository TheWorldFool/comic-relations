import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Project } from '../shared/types';

const labels={preparing:'准备图片',reading:'理解剧情',repairing:'修正模型输出',identity:'复核人物身份',saving:'整理并保存本页'};
export default function ReadingActivityLabel({project}:{project:Project|null}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(project?.status!=='running')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[project?.status]);
  if(project?.status!=='running')return <>{project?.status==='completed'?'分析完成':project?.status==='paused'?'阅读已暂停':project?.status==='error'?'本页阅读失败':'准备阅读'}</>;
  const activity=project.readingActivity;
  return <><LoaderCircle className="spin" size={12}/>正在阅读第 {activity?.page||project.processed+1} 页{activity&&` · ${labels[activity.phase]} · 本页已等待 ${Math.max(0,Math.floor((now-activity.startedAt)/1000))} 秒`}</>;
}
