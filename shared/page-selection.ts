import type { Page, PagePurpose } from './types.js';
export const purposeLabels:Record<PagePurpose,string>={story:'正文',cover:'封面',ad:'广告',extra:'附页'};
export function pagesClassified(pages:Page[]){return pages.length>0&&pages.every(p=>p.purpose&&p.override===(p.purpose==='story'?'story':'skip'));}
export function suggestedPurpose(page:Page):PagePurpose|undefined{
  if(page.purpose)return page.purpose;
  if(page.override==='story')return 'story';
  if(page.analysis&&['story','cover','ad','extra'].includes(page.analysis.kind))return page.analysis.kind as PagePurpose;
  if(page.override==='skip')return 'extra';
}
