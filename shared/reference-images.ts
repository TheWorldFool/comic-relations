import type { Character, Project } from './types.js';

// Display avatars are not evidence unless their source page is known and read.
export function readingReferences(project:Project,person:Character){
  return (person.references||[]).filter(r=>Number.isInteger(r.page)&&r.page>=1&&r.page<=project.processed&&!!project.pages[r.page-1]);
}
export function readingPortrait(project:Project,person:Character){
  const refs=readingReferences(project,person);
  return refs.find(r=>r.url===person.avatar)?.url||refs[0]?.url;
}
