import type { Project } from './types.js';

export function readingTotals(project:Project){
  const rows=project.readingRuns||project.pages.flatMap(p=>p.timing?[p.timing]:[]);
  return rows.reduce<{elapsedMs:number;attempts:number;promptTokens:number;completionTokens:number}>((sum,row)=>({elapsedMs:sum.elapsedMs+row.elapsedMs,attempts:sum.attempts+row.attempts,promptTokens:sum.promptTokens+(row.promptTokens||0),completionTokens:sum.completionTokens+(row.completionTokens||0)}),{elapsedMs:0,attempts:0,promptTokens:0,completionTokens:0});
}
