import {UserError} from './types.ts';
import type {CatalogSong} from './matching.ts';
type SpotifySong = {id?:string; name?:string; is_local?:boolean; type?:string; artists?:{name:string}[]; external_ids?:{isrc?:string}; duration_ms?:number};
type SpotifyPage = {items?: (SpotifySong & {item?:SpotifySong|null; track?:SpotifySong|null})[]; next?:string|null; total?:number};
export type SpotifyLoadSummary = {items:CatalogSong[];total?:number;skipped:number;limited:boolean};
type EmbeddedSong = {uri?:string; title?:string; name?:string; subtitle?:string; artists?:{name:string}[]; duration?:number; duration_ms?:number};
type EmbedData = {props?:{pageProps?:{state?:{data?:{entity?: EmbeddedSong & {trackList?:EmbeddedSong[]}}}}}};
export function spotifyRef(query:string):{kind:string;id:string}|null{
 const uri=query.match(/^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/);if(uri)return {kind:uri[1],id:uri[2]};
 try{const u=new URL(query);if(u.protocol!=='https:'||u.hostname!=='open.spotify.com')return null;const m=u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([A-Za-z0-9]{22})\/?$/);return m?{kind:m[1],id:m[2]}:null;}catch{return null;}
}
function catalog(t:SpotifySong|null|undefined):CatalogSong|null{
 if(!t||t.is_local||t.type==='episode'||!t.name||!Array.isArray(t.artists)||!t.artists.length)return null;
 return {id:t.id,isrc:t.external_ids?.isrc,title:t.name,artist:t.artists.map((a)=>a.name).join(' '),duration:Number(t.duration_ms)/1000};
}
export class SpotifyCatalog{
 token={value:'',until:0};private refreshing:Promise<string>|null=null;
 private id:string;private secret:string;private request:typeof fetch;
 constructor(id:string,secret:string,request:typeof fetch=fetch){this.id=id;this.secret=secret;this.request=request;}
 async access(){
  if(Date.now()<this.token.until)return this.token.value;
  if(this.refreshing)return this.refreshing;
  this.refreshing=(async()=>{const r=await this.request('https://accounts.spotify.com/api/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(this.id+':'+this.secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new UserError('Could not verify Spotify access.',502);const t=await r.json() as {access_token:string;expires_in:number};this.token={value:t.access_token,until:Date.now()+t.expires_in*1000-60000};return this.token.value;})().finally(()=>{this.refreshing=null;});return this.refreshing;
 }
 async api<T=SpotifySong>(path:string,signal?:AbortSignal){
  const url=new URL(path,'https://api.spotify.com/v1/');if(url.origin!=='https://api.spotify.com'||!url.pathname.startsWith('/v1/'))throw new UserError('Invalid Spotify page.');
  for(let attempt=0;attempt<2;attempt++){signal?.throwIfAborted();const token=await this.access();signal?.throwIfAborted();const r=await this.request(url,{headers:{Authorization:'Bearer '+token},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});signal?.throwIfAborted();if(r.status===401&&!attempt){this.token.until=0;continue;}if(!r.ok)throw new UserError(r.status===429?'Spotify is busy. Try again shortly.':'This Spotify playlist is private or unavailable.',r.status===429?429:502);const value=await r.json() as T;signal?.throwIfAborted();return value;}throw new UserError('Spotify access has expired.',502);
 }
 async apiLoad(kind:string,id:string,limit:number):Promise<CatalogSong[]>{
  return (await this.apiLoadWithSummary(kind,id,limit)).items;
 }
 private async apiLoadWithSummary(kind:string,id:string,limit:number,signal?:AbortSignal):Promise<SpotifyLoadSummary>{
  signal?.throwIfAborted();
  if(!this.id||!this.secret)throw new UserError('Spotify API access is not configured.');
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw new UserError('Invalid Spotify playlist limit.');
  if(kind==='track'){const t=catalog(await this.api(`tracks/${id}`,signal));if(!t)throw new UserError('This Spotify track cannot be played.');return {items:[t],total:1,skipped:0,limited:false};}
  let path:string|null=kind==='playlist'?`playlists/${id}/items?limit=50`:`albums/${id}/tracks?limit=50`;
  const tracks:CatalogSong[]=[];const visited=new Set<string>();let skipped=0,observed=0,total:number|undefined,overflow=false;
  while(path&&tracks.length<limit&&!visited.has(path)&&visited.size<Math.ceil(limit/50)+1){
   signal?.throwIfAborted();visited.add(path);const data:SpotifyPage=await this.api<SpotifyPage>(path,signal);signal?.throwIfAborted();
   if(!Array.isArray(data.items)||data.items.length>50)throw new UserError('Invalid Spotify page.');
   observed+=data.items.length;
   if(total===undefined&&typeof data.total==='number'&&Number.isSafeInteger(data.total)&&data.total>=0)total=data.total;
   for(const item of data.items){const t=catalog(item?.item??item?.track??item);if(t){if(tracks.length<limit)tracks.push(t);else overflow=true;}else skipped++;}
   path=data.next??null;
  }
  if(!tracks.length)throw new UserError('This Spotify playlist has no available songs.');
  return {items:tracks,...(total!==undefined?{total}:{}),skipped,limited:overflow||Boolean(path)||total!==undefined&&total>observed};
 }
 async load(kind:string,id:string,limit:number):Promise<CatalogSong[]>{
  return (await this.loadWithSummary(kind,id,limit)).items;
 }
 async loadWithSummary(kind:string,id:string,limit:number,signal?:AbortSignal):Promise<SpotifyLoadSummary>{
  signal?.throwIfAborted();
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw new UserError('Invalid Spotify playlist limit.');
  try{return await this.apiLoadWithSummary(kind,id,limit,signal);}catch(error){
   signal?.throwIfAborted();
   if(error instanceof UserError&&error.status===429)throw error;
   // Preserve the former public-embed fallback for public playlists unavailable to the app.
   const r=await this.request(`https://open.spotify.com/embed/${kind}/${id}`,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});signal?.throwIfAborted();
   if(!r.ok)throw error;
   const html=await r.text();signal?.throwIfAborted();const match=html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
   if(!match)throw error;
   const entity=(JSON.parse(match[1]) as EmbedData).props?.pageProps?.state?.data?.entity;
   const songs:CatalogSong[]=(entity?.trackList??(entity?[entity]:[])).map((t)=>({id:t.uri?.split(':').at(-1),title:t.title??t.name??'',artist:t.subtitle??t.artists?.map((a)=>a.name).join(' ')??'',duration:Number(t.duration??t.duration_ms??0)/1000})).filter((t:CatalogSong)=>t.title&&t.artist);
   if(!songs.length)throw error;return {items:songs.slice(0,limit),skipped:0,limited:true};
  }
 }
 async enrich(song:CatalogSong){if(song.isrc||!song.id)return song;return catalog(await this.api(`tracks/${song.id}`))??song;}
}

function sharingUrl(value:string,base?:URL){
 if(/[\p{Cc}\p{Cf}\\]/u.test(value))throw new UserError('Invalid Spotify sharing link.');
 // Inspect raw authorities before URL removes an explicit default port.
 const authority=/^(?:https:)?\/\/([^/?#]+)/i.exec(value)?.[1];
 if(authority&&/[:@%\s]/.test(authority))throw new UserError('Invalid Spotify sharing link.');
 const url=new URL(value,base);
 if(url.protocol!=='https:'||url.username||url.password||url.port||!['spotify.link','open.spotify.com'].includes(url.hostname))throw new UserError('Invalid Spotify sharing link.');
 return url;
}
export async function expandSpotifyLink(value:string,request:typeof fetch=fetch,signal?:AbortSignal){
 let url=sharingUrl(value);
 for(let n=0;n<5;n++){
  signal?.throwIfAborted();
  if(url.protocol!=='https:'||url.username||url.password||!['spotify.link','open.spotify.com'].includes(url.hostname))throw new UserError('Invalid Spotify sharing link.');
  if(spotifyRef(url.href))return url.href;
  const r=await request(url,{redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});signal?.throwIfAborted();
  const location=r.headers.get('location');if(!location||r.status<300||r.status>=400)throw new UserError('Could not open the Spotify sharing link.');
  url=sharingUrl(location,url);
 }
 throw new UserError('The Spotify sharing link has too many redirects.');
}
