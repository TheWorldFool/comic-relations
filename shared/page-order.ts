import type { Project } from './types.js';

export function changesReadOrder(project:Pick<Project,'pages'|'processed'>, ids:string[]) {
  return project.pages.slice(0,project.processed).some((page,index)=>ids[index]!==page.id);
}
