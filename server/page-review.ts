import type { Reading } from './analysis.js';

export function needsPageReview(reading:Reading){
  return reading.kind==='uncertain'||reading.confidence<(reading.kind==='story'?.75:.9);
}
export function reviewAcceptable(first:Reading,second:Reading){
  if(!needsPageReview(second))return true;
  if(first.kind!==second.kind||second.kind==='uncertain')return false;
  const threshold=second.kind==='story'?.6:.8;
  return first.confidence>=threshold&&second.confidence>=threshold;
}
