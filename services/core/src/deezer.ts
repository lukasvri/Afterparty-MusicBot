import {UserError} from './types.ts';
import type {CatalogSong} from './matching.ts';

export type DeezerRef = {kind:'track'|'album'|'playlist';id:string};
const idPattern=/^[1-9][0-9]{0,19}$/;
const locales=new Set(['en','us','gb','fr','de','es','it','pt','br','nl','pl','no','sv','da','fi']);
const maxBytes=512*1024,maxPages=10,pageSize=50;
const unavailable=()=>new UserError('Deezer metadata is unavailable. Try again later.',502);
const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** Only canonical public links are accepted, before URL normalization can hide traversal. */
export function deezerRef(query:string):DeezerRef|null{
 const match=/^https:\/\/(?:www\.)?deezer\.com\/(?:(?<locale>[a-z]{2})\/)?(?<kind>track|album|playlist)\/(?<id>[1-9][0-9]{0,19})\/?$/.exec(query);
 if(!match?.groups||match.groups.locale&&!locales.has(match.groups.locale))return null;
 return {kind:match.groups.kind as DeezerRef['kind'],id:match.groups.id};
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
 const fullTitle=version&&!title.toLocaleLowerCase('en').includes(version.toLocaleLowerCase('en'))?title+' '+version:title;
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
   for(const entry of entries){const candidate=song(entry);if(candidate&&!seen.has(candidate.id)){seen.add(candidate.id);songs.push(candidate.song);}if(songs.length===limit)break;}
   if(ref.kind==='track'||entries.length<pageSize)break;
   if(typeof data.total==='number'&&Number.isSafeInteger(data.total)&&data.total>=0&&(page+1)*pageSize>=data.total)break;
  }
  if(!songs.length)throw new UserError('This Deezer link has no available songs.');
  return songs;
 }finally{clearTimeout(timer);controller.abort();}
}
