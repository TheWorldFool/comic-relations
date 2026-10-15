import { createHash, randomUUID } from 'node:crypto';
import { bindAppearances } from './appearances.js';
import { identityPeople } from '../shared/identity-people.js';
import type { AppearanceBindingInput, Project } from '../shared/types.js';

export interface AppearanceBackup { version:1; id:string; before:Project; beforeHash:string; afterHash:string; }
// Timestamps and transient progress do not affect the result being restored.
// Reading usage remains part of the hash: undo must never discard billed work.
export function appearanceStateHash(project:Project){
  const {updatedAt,readingActivity,appearanceUndo,...state}=project;
  // Storage validation may reorder object properties. Compare values, not key order.
  return createHash('sha256').update(JSON.stringify(state,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)).digest('hex');
}
export function invalidateAppearanceUndo(project:Project){
  if(project.appearanceUndo?.available&&project.appearanceUndo.stateHash!==appearanceStateHash(project))project.appearanceUndo.available=false;
}
export function bindWithUndo(project:Project,input:AppearanceBindingInput):AppearanceBackup{
  const before=structuredClone(project),draft=structuredClone(project);
  delete before.appearanceUndo; // One undo only; snapshots do not form a hidden chain.
  bindAppearances(draft,input.ids,input.characterId,input.reason,input.newName);
  const id=randomUUID(),afterHash=appearanceStateHash(draft);
  const selected=draft.appearances!.filter(a=>input.ids.includes(a.id));
  const target=selected[0].characterId;
  draft.appearanceUndo={id,selected:selected.length,pages:[...new Set(selected.map(a=>a.page))].sort((a,b)=>a-b),targetName:target?identityPeople(draft).find(c=>c.id===target)!.name:'待定',reason:input.reason,createdAt:new Date().toISOString(),stateHash:afterHash,available:true};
  Object.assign(project,draft);
  return {version:1,id,before,beforeHash:appearanceStateHash(before),afterHash};
}
export function restoreAppearanceBinding(project:Project,backup:AppearanceBackup|null,undoId:string):Project{
  const undo=project.appearanceUndo;
  if(!undo?.available||undo.id!==undoId||undo.stateHash!==appearanceStateHash(project))throw new Error('校正后已有新的阅读或编辑，不能直接撤销。请按出场记录重新校正。');
  if(backup?.version!==1||backup.id!==undoId||backup.afterHash!==undo.stateHash||backup.before?.id!==project.id||backup.beforeHash!==appearanceStateHash(backup.before))throw new Error('出场校正备份不完整，未修改当前结果。');
  const restored=structuredClone(backup.before);
  delete restored.appearanceUndo;
  return restored;
}
