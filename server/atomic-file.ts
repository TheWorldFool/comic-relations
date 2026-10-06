import { rename } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

// Windows readers/indexers may briefly prevent replacing an existing file.
// Retry the atomic rename only; never unlink the last valid project snapshot.
export async function replaceFile(source:string, target:string, options: {
  rename?:typeof rename; platform?:NodeJS.Platform; wait?:(ms:number)=>Promise<unknown>;
} = {}) {
  const move=options.rename||rename, platform=options.platform||process.platform;
  const wait=options.wait||setTimeout, delays=[20,40,80,160,320];
  for(let attempt=0;;attempt++){
    try { await move(source,target); return; }
    catch(error){
      const code=(error as NodeJS.ErrnoException).code;
      if(platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(code||'')||attempt>=delays.length)throw error;
      await wait(delays[attempt]);
    }
  }
}
