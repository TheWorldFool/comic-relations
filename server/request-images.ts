import { createHash } from 'node:crypto';

// Keep every label/evidence association, but send identical image bytes only
// once within a request. Never deduplicate different crops or resolutions.
export function deduplicateRequestImages(content: unknown[]) {
  const keys=content.map(part=>{
    const item = part as {type?:string;image_url?:{url?:string;detail?:string}} | null;
    if (item?.type !== 'image_url' || !item.image_url?.url) return null;
    return createHash('sha256').update(item.image_url.url).update(`\0${item.image_url.detail||'auto'}`).digest('hex');
  });
  const present=keys.filter(key=>key!==null);
  if(new Set(present).size===present.length)return content;
  const images = new Map<string, number>();
  return content.flatMap((part,index) => {
    const key=keys[index];
    if(key===null)return [part];
    const existing = images.get(key);
    if (existing !== undefined) return [{type:'text',text:`以上说明对应前面的图像 ${existing}（同一张图片，复用该图，不表示额外出场）。`}];
    const number = images.size + 1;
    images.set(key, number);
    return [{type:'text',text:`图像 ${number}：`},part];
  });
}
