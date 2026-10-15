import type { Project, Appearance } from './types.js';

export function rereadPageHints(project:Project){
  return project.reread?.items.filter(i=>!i.resolved&&i.page===project.processed+1).map(i=>({
    kind:i.kind,title:i.title,evidence:i.detail,
    ...(i.kind==='出场归属'?{box:(i.data as Appearance).observed.box}:{}),
  }));
}
