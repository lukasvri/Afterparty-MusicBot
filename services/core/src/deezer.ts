import {UserError} from './types.ts';
import type {CatalogSong} from './matching.ts';

export type DeezerRef = {kind:'track'|'album'|'playlist';id:string};
const idPattern=/^[1-9][0-9]{0,19}$/;
const locales=new Set(['en','us','gb','fr','de','es','it','pt','br','nl','pl','no','sv','da','fi']);
const maxBytes=512*1024,maxPages=10,pageSize=50;
const unavailable=()=>new UserError('Deezer metadata is unavailable. Try again later.',502);
const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const tracking=new Set(['utm_source','utm_medium','utm_campaign','utm_content','utm_term']);
const control=/[\p{Cc}\p{Cf}]/u;
const sharingUnavailable=()=>new UserError('Could not open this Deezer sharing link. Try again later.',502);
let sharingRequests=0;

/** Tracking is inert metadata: validate it, then remove it before constructing any request. */
function cleanLink(value:string):string|null{
 if(value.length>2048||control.test(value)||value.includes('#'))return null;
 const question=value.indexOf('?');if(question<0)return value;
 const parts=value.slice(question+1).split('&'),seen=new Set<string>();
 if(parts.length>5)return null;
 for(const part of parts){
  const equal=part.indexOf('='),key=part.slice(0,equal);
  if(equal<1||!tracking.has(key)||seen.has(key)||/%(?![0-9a-f]{2})/i.test(part))return null;
  const decoded=new URLSearchParams(part).get(key);
  if(!decoded||decoded.length>256||control.test(decoded)||!decoded.trim())return null;
  seen.add(key);
 }
 return value.slice(0,question);
}

/** Only canonical public links are accepted, before URL normalization can hide traversal. */
export function deezerRef(query:string):DeezerRef|null{
 const clean=cleanLink(query);if(!clean)return null;
 const match=/^https:\/\/(?:www\.)?deezer\.com\/(?:(?<locale>[a-z]{2})\/)?(?<kind>track|album|playlist)\/(?<id>[1-9][0-9]{0,19})\/?$/.exec(clean);
 if(!match?.groups||match.groups.locale&&!locales.has(match.groups.locale))return null;
 return {kind:match.groups.kind as DeezerRef['kind'],id:match.groups.id};
}

export function deezerShareUrl(query:string):string|null{
 const clean=cleanLink(query);
 return clean&&/^https:\/\/link\.deezer\.com\/s\/[A-Za-z0-9_-]{1,128}$/.test(clean)?clean:null;
}

function sharingAbort<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(sharingUnavailable());};
  pending.then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(sharingUnavailable());else resolve(value);},()=>{signal.removeEventListener('abort',abort);reject(sharingUnavailable());});
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
 });
}

/** At most three GETs to the exact share endpoint. Canonical targets never need a web-page fetch. */
export async function expandDeezerLink(value:string,fetcher:typeof fetch=fetch,externalSignal?:AbortSignal):Promise<DeezerRef>{
 if(externalSignal?.aborted)throw sharingUnavailable();
 const direct=deezerRef(value);if(direct)return direct;
 let next=deezerShareUrl(value);if(!next)throw new UserError('Invalid Deezer sharing link.');
 if(sharingRequests>=4)throw new UserError('Deezer sharing links are busy. Try again shortly.',503);
 sharingRequests++;
 const controller=new AbortController(),overall=externalSignal?AbortSignal.any([controller.signal,externalSignal]):controller.signal;
 const timer=setTimeout(()=>controller.abort(),10000),visited=new Set<string>(),pending=new Set<Promise<Response>>();
 try{
  for(let hop=0;hop<3;hop++){
   if(overall.aborted||visited.has(next))throw sharingUnavailable();visited.add(next);
   const signal=AbortSignal.any([overall,AbortSignal.timeout(5000)]),endpoint=next;
   let response:Response|undefined;
   try{
    const raw=fetcher(endpoint,{redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'text/html'},signal});
    pending.add(raw);void raw.then(()=>pending.delete(raw),()=>pending.delete(raw));
    await sharingAbort(raw.then(result=>{response=result;if(signal.aborted)void result.body?.cancel().catch(()=>{});return result;}),signal);
    if(!response||signal.aborted||response.redirected||response.url&&response.url!==endpoint||![301,302,303,307,308].includes(response.status))throw sharingUnavailable();
    const location=response.headers.get('location');if(!location||location.length>2048)throw sharingUnavailable();
    const canonical=deezerRef(location);if(canonical)return canonical;
    // Only a raw, validated /s/token relative path can be resolved against the fixed share host.
    const sharing=deezerShareUrl(location.startsWith('/')&&!location.startsWith('//')?'https://link.deezer.com'+location:location);
    if(!sharing)throw sharingUnavailable();next=sharing;
   }finally{void response?.body?.cancel().catch(()=>{});}
  }
  throw sharingUnavailable();
 }catch{throw sharingUnavailable();}
 finally{
  controller.abort();clearTimeout(timer);
  if(pending.size)void Promise.allSettled([...pending]).then(()=>{sharingRequests--;});else sharingRequests--;
 }
}

function text(value:unknown,max:number):string|null{
 if(typeof value!=='string')return null;
 const clean=value.trim();
 return clean&&clean.length<=max&&!/[\p{Cc}\p{Cf}]/u.test(clean)?clean:null;
}

function song(value:unknown):{id:string;song:CatalogSong}|null{
 const track=object(value);if(!track||track.readable===false||track.playable===false||track.type!==undefined&&track.type!=='track')return null;
 const id=typeof track.id==='number'&&Number.isSafeInteger(track.id)?String(track.id):track.id;
 if(typeof id!=='string'||!idPattern.test(id))return null;
 const title=text(track.title,500),artist=text(object(track.artist)?.name,300),duration=track.duration;
 if(!title||!artist||typeof duration!=='number'||!Number.isFinite(duration)||duration<=0||duration>86400)return null;
 const version=text(track.title_version,200);
 if(track.title_version!==undefined&&track.title_version!==null&&track.title_version!==''&&!version)return null;
 const lowerTitle=title.toLocaleLowerCase('en'),lowerVersion=version?.toLocaleLowerCase('en');
 // A title word such as Alive, or the opening Live in Live Forever, is not a version annotation.
 const hasVersion=lowerVersion&&[` ${lowerVersion}`,`(${lowerVersion})`,`[${lowerVersion}]`].some(suffix=>lowerTitle.endsWith(suffix));
 const fullTitle=version&&!hasVersion?title+' '+version:title;
 if(fullTitle.length>500)return null;
 const result:CatalogSong={title:fullTitle,artist,duration};
 if(typeof track.isrc==='string'&&/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/i.test(track.isrc))result.isrc=track.isrc.toUpperCase();
 // Deezer identifiers and media URLs never enter the Spotify catalog contract.
 return {id,song:result};
}

async function metadata(endpoint:URL,fetcher:typeof fetch,overall:AbortSignal):Promise<Record<string,unknown>>{
 const signal=AbortSignal.any([overall,AbortSignal.timeout(10000)]);
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined;
 let onAbort:()=>void=()=>{};
 const cancelled=new Promise<never>((_,reject)=>{onAbort=()=>reject(unavailable());signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();});
 try{
  return await Promise.race([(async()=>{
   response=await fetcher(endpoint,{redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/json'},signal});
   if(signal.aborted){void response.body?.cancel().catch(()=>{});throw unavailable();}
   if(response.status===429)throw new UserError('Deezer is busy. Try again shortly.',429);
   if(!response.ok||response.redirected||response.url&&response.url!==endpoint.href)throw unavailable();
   const contentType=response.headers.get('content-type'),length=response.headers.get('content-length');
   if(contentType&&!/^application\/json(?:\s*;|$)/i.test(contentType)||length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>maxBytes)||!response.body)throw unavailable();
   reader=response.body.getReader();
   const chunks:Uint8Array[]=[];let size=0;
   while(true){const chunk=await reader.read();if(signal.aborted)throw unavailable();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBytes)throw unavailable();chunks.push(chunk.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   const data=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
   if(!data||data.error!==undefined)throw unavailable();
   return data;
  })(),cancelled]);
 }catch(error){if(error instanceof UserError&&error.status===429&&error.message==='Deezer is busy. Try again shortly.')throw error;throw unavailable();}
 finally{signal.removeEventListener('abort',onAbort);if(reader)void reader.cancel().catch(()=>{});else void response?.body?.cancel().catch(()=>{});}
}

/** Public metadata only. Pagination never trusts provider-supplied URLs. */
export async function loadDeezer(ref:DeezerRef,limit:number,fetcher:typeof fetch=fetch):Promise<CatalogSong[]>{
 if(!ref||!['track','album','playlist'].includes(ref.kind)||typeof ref.id!=='string'||!idPattern.test(ref.id))throw new UserError('Invalid Deezer link.');
 if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw new UserError('Deezer song limit must be between 1 and 500.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 const songs:CatalogSong[]=[],seen=new Set<string>();
 try{
  for(let page=0;page<(ref.kind==='track'?1:maxPages)&&songs.length<limit;page++){
   const endpoint=new URL(`https://api.deezer.com/${ref.kind}/${ref.id}${ref.kind==='track'?'':'/tracks'}`);
   if(ref.kind!=='track'){endpoint.searchParams.set('index',String(page*pageSize));endpoint.searchParams.set('limit',String(pageSize));}
   const data=await metadata(endpoint,fetcher,controller.signal);
   if(ref.kind!=='track'&&!Array.isArray(data.data))throw unavailable();
   const entries=ref.kind==='track'?[data]:data.data as unknown[];
   if(entries.length>pageSize)throw unavailable();
   for(const entry of entries){const candidate=song(entry);if(ref.kind==='track'&&candidate&&candidate.id!==ref.id)throw unavailable();if(candidate&&!seen.has(candidate.id)){seen.add(candidate.id);songs.push(candidate.song);}if(songs.length===limit)break;}
   if(ref.kind==='track'||entries.length<pageSize)break;
   if(typeof data.total==='number'&&Number.isSafeInteger(data.total)&&data.total>=0&&(page+1)*pageSize>=data.total)break;
  }
  if(!songs.length)throw new UserError('This Deezer link has no available songs.');
  return songs;
 }finally{clearTimeout(timer);controller.abort();}
}
