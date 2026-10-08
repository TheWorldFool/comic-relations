import { setTimeout } from 'node:timers/promises';

const transientStatuses=new Set([408,429,500,502,503,504]);
function networkFailure(error:unknown){
  const e=error as {name?:string;cause?:{code?:string};code?:string};
  return e?.name==='TypeError' && ['ECONNRESET','ECONNREFUSED','EAI_AGAIN','ETIMEDOUT','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT'].includes(e.cause?.code||e.code||'');
}
export async function fetchWithRetry(url:string, init:RequestInit, onAttempt?:()=>void, dependencies:{fetch?:typeof fetch;wait?:(ms:number,signal:AbortSignal)=>Promise<unknown>}={}) {
  const request=dependencies.fetch||fetch;
  const signal=init.signal||new AbortController().signal;
  const wait=dependencies.wait||((ms,signal)=>setTimeout(ms,undefined,{signal}));
  for(let attempt=0;;attempt++){
    signal.throwIfAborted();onAttempt?.();
    let response:Response;
    try{response=await request(url,init);}
    catch(error){
      if(signal.aborted||attempt>=2||!networkFailure(error))throw error;
      await wait(1000*2**attempt,signal);continue;
    }
    if(!transientStatuses.has(response.status)||attempt>=2)return response;
    const header=response.headers.get('retry-after');
    let delay=header===null?NaN:/^\d+(?:\.\d+)?$/.test(header.trim())?Number(header)*1000:Date.parse(header)-Date.now();
    if(!Number.isFinite(delay))delay=1000*2**attempt;
    // A long server-requested delay is surfaced to the user, never shortened.
    if(delay>15000)return response;
    await response.body?.cancel();
    await wait(Math.max(0,delay),signal);
  }
}
