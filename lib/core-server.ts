import { GUESS_AUDIO_MAX_BYTES, guessWaveSeconds, readGuessBytes } from '../services/core/src/guess-audio-format.ts';
import {env} from 'cloudflare:workers';
export function coreUrl(){const value=(env as unknown as {GUTTA_CORE_PUBLIC_URL?:string}).GUTTA_CORE_PUBLIC_URL;if(!value)return null;const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Ugyldig sanntidsadresse.');return url.origin;}
export async function commandTicket(input:Record<string,unknown>){const origin=coreUrl(),key=(env as unknown as {ADMIN_BRIDGE_KEY?:string}).ADMIN_BRIDGE_KEY;if(!origin||!key)return {};const claims={...input,aud:'gutta-krutt-core',exp:Date.now()+30000,bridge:true};const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');const payload=encode(new TextEncoder().encode(JSON.stringify(claims)));const secret=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',secret,new TextEncoder().encode(payload))));return {ticket:payload+'.'+signature,url:origin+'/v1/ticket'};}
export async function coreRequest<T>(path:string,method='GET',input?:unknown,extraHeaders:Record<string,string>={},callerSignal?:AbortSignal):Promise<T>{const origin=coreUrl(),key=(env as unknown as {ADMIN_BRIDGE_KEY?:string}).ADMIN_BRIDGE_KEY;if(!origin||!key)throw new Error('Sanntidstjenesten mangler konfigurasjon.');const response=await fetch(origin+path,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...extraHeaders},...(input===undefined?{}:{body:JSON.stringify(input)}),redirect:'manual',signal:callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});if(!response.ok){const data=await response.json().catch(()=>({})) as {error?:string};const error=new Error(data.error??'Sanntidstjenesten svarer ikke.') as Error&{status:number};error.status=response.status;throw error;}return response.json() as Promise<T>;}

export function coreOrigin(request:Request){return new URL((env as unknown as {GUTTA_CORE_SITE_ORIGIN?:string}).GUTTA_CORE_SITE_ORIGIN??request.url).origin;}

/** Binary game preview only. No provider URLs, redirects or upstream headers reach the browser. */
export async function coreGuessAudio(input: unknown, callerSignal: AbortSignal) {
 const origin=coreUrl(),key=(env as unknown as {ADMIN_BRIDGE_KEY?:string}).ADMIN_BRIDGE_KEY;
 if(!origin||!key)throw Object.assign(new Error('Game preview is unavailable.'),{status:503});
 const signal=AbortSignal.any([callerSignal,AbortSignal.timeout(12000)]);
 // Workerd supports manual/follow only. Never follow a redirect with bridge credentials.
 const response=await fetch(origin+'/v1/guess',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(input),redirect:'manual',signal});
 if(!response.ok){void response.body?.cancel().catch(() => {});throw Object.assign(new Error('Game preview is unavailable. Reconnect and try again.'),{status:response.status>=300&&response.status<400?502:response.status});}
 try {
  if(response.headers.get('content-type')!=='audio/wav'){void response.body?.cancel().catch(()=>{});throw Error();}
  const bytes=await readGuessBytes(response,GUESS_AUDIO_MAX_BYTES,signal);guessWaveSeconds(bytes);
  return new Response(bytes.buffer as ArrayBuffer,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch{throw Object.assign(new Error('Game preview is unavailable.'),{status:502});}
}

/** An authenticated social stream has its own short lease and no playback commands. */
export async function coreSocialStream(input: unknown, signal: AbortSignal) {
 const origin=coreUrl(), key=(env as unknown as {ADMIN_BRIDGE_KEY?:string}).ADMIN_BRIDGE_KEY;
 if(!origin||!key)throw Object.assign(new Error('Concert extras need the Core service.'),{status:503});
 const response=await fetch(origin+'/v1/social',{method:'POST',
  headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(input),
  redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(70000)])});
 if(!response.ok){const data=await response.json().catch(()=>({})) as {error?:string};throw Object.assign(new Error(data.error??'Concert extras are unavailable.'),{status:response.status});}
 if(!response.body)throw Object.assign(new Error('Concert extras are unavailable.'),{status:502});
 return new Response(response.body,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
}
