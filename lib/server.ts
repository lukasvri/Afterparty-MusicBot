import {env as cloudEnv} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import type {Video, RoomState, Room} from './types';
import {hasPasswordSession} from './admin-session';
import {coreUrl,coreRequest} from './core-server';
import {recordPlay} from './party';
import {roomRecommendation,roomRadioHistory} from '../services/core/src/room-radio.ts';
type Env = Cloudflare.Env & {YOUTUBE_API_KEY?: string; OWNER_EMAIL?: string; ADMIN_BRIDGE_KEY?: string};
const env = () => cloudEnv as Env;
export class ApiError extends Error {constructor(public status: number, message: string){super(message);}}
export function fail(status: number, message: string): never {throw new ApiError(status,message);}
export const db = () => env().DB ?? fail(503,'Romtjenesten er ikke klar ennå.');
export const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
const bearer = (request: Request) => (request.headers.get('authorization') ?? '').replace(/^Bearer /,'');
export const isAdmin = async (request?: Request) => {
  if(request && env().ADMIN_BRIDGE_KEY && await hash(bearer(request)) === await hash(env().ADMIN_BRIDGE_KEY!))return true;
  if(request && await hasPasswordSession(request))return true;
  const user = await getChatGPTUser();
  return Boolean(user && env().OWNER_EMAIL && user.email.toLowerCase()===env().OWNER_EMAIL!.toLowerCase());
};
export async function limit(request: Request, scope: string, maximum: number, milliseconds: number, global=false){
  const identity = global ? 'global' : await hash(request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? 'shared');
  const now=Date.now();const key=`${scope}:${identity}`;
  const result=await db().prepare('INSERT INTO limits(key,count,until) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<? THEN 1 ELSE count+1 END, until=CASE WHEN until<? THEN ? ELSE until END WHERE until<? OR count<? RETURNING count').bind(key,now+milliseconds,now,now,now+milliseconds,now,maximum).first();
  if(!result)fail(429,'Ta en liten pause og prøv igjen. Grensen beskytter søket og rommene mot misbruk.');
}
export async function body(request: Request, maximum=16000){
  const origin=request.headers.get('origin');if(origin && origin!==new URL(request.url).origin)fail(403,'Forespørselen kommer fra en annen nettside.');
  if(!(request.headers.get('content-type')??'').startsWith('application/json'))fail(415,'Bruk JSON.');
  if(Number(request.headers.get('content-length')??0)>maximum)fail(413,'Forespørselen er for stor.');
  const reader=request.body?.getReader();let size=0;const parts:Uint8Array[]=[];if(reader){while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();fail(413,'Forespørselen er for stor.');}parts.push(value);}}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}const input=new TextDecoder().decode(bytes);
  let result;try{result=JSON.parse(input);}catch{fail(400,'Ugyldig forespørsel.');}
  if(!result || typeof result!=='object' || Array.isArray(result))fail(400,'Ugyldig forespørsel.');return result as Record<string,unknown>;
}
export async function api(operation: ()=>Promise<unknown>){try{return Response.json(await operation(),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch(error){const remote=error as Error&{status?:number};const status=error instanceof ApiError?error.status:Number.isInteger(remote?.status)&&remote.status!>=400&&remote.status!<=599?remote.status!:500;return Response.json({error:status!==500&&error instanceof Error?error.message:'Noe gikk galt. Prøv igjen.'},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}}
export function videoId(input: string){
  if(/^[\w-]{11}$/.test(input))return input;
  let url;try{url=new URL(input.trim());}catch{return fail(400,'Bruk en YouTube-lenke til en video.');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'].includes(url.hostname))fail(400,'Bruk en YouTube-lenke.');
  const parts=url.pathname.split('/').filter(Boolean);const id=url.hostname==='youtu.be'&&parts.length===1?parts[0]:url.pathname==='/watch'?url.searchParams.get('v'):parts.length===2&&['live','shorts','embed'].includes(parts[0])?parts[1]:null;
  if(!id||!/^[\w-]{11}$/.test(id))fail(400,'Lenken må peke til en video.');return id;
}
const inFlight = new Map<string,Promise<unknown>>();
async function cached<T>(key:string, provider:()=>Promise<T>):Promise<T>{
  const row=await db().prepare('SELECT data FROM cached WHERE key=? AND expires_at>?').bind(key,Date.now()).first<{data:string}>();
  if(row){try{return JSON.parse(row.data);}catch{/* refresh invalid cache */}}
  const existing=inFlight.get(key);if(existing)return existing as Promise<T>;
  const pending=(async()=>{const result=await provider();await db().prepare('INSERT INTO cached(key,data,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at').bind(key,JSON.stringify(result),Date.now()+3600000).run();return result;})();inFlight.set(key,pending);
  try{return await pending;}finally{inFlight.delete(key);}
}
async function youtube(path:string, params:Record<string,string>){
  const key=env().YOUTUBE_API_KEY;if(!key)fail(503,'Musikksøket er ikke konfigurert ennå.');
  const url=new URL(`https://www.googleapis.com/youtube/v3/${path}`);for(const [k,v]of Object.entries({...params,key}))url.searchParams.set(k,v);
  const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)fail(response.status===403?429:502,'YouTube-søket er midlertidig utilgjengelig. Prøv igjen senere.');return response.json() as Promise<any>;
}
function duration(input:string){const m=input?.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);return m?Number(m[1]??0)*86400+Number(m[2]??0)*3600+Number(m[3]??0)*60+Number(m[4]??0):0;}
function decode(input:string){return input.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
export async function videos(request:Request, ids:string[]):Promise<Video[]>{
  if(!ids.length)return [];
  return cached(`videos:${ids.join(',')}`,async()=>{if(coreUrl()){try{return (await coreRequest<{videos:Video[]}>('/v1/catalog?ids='+ids.join(','))).videos;}catch{/* retain the direct metadata API */}}await limit(request,'video-budget',1200,86400000,true);const data=await youtube('videos',{id:ids.join(','),part:'snippet,contentDetails,status'});return data.items.map((v:any)=>({id:v.id,title:decode(v.snippet.title),artist:decode(v.snippet.channelTitle),image:`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,duration:duration(v.contentDetails.duration),live:v.snippet.liveBroadcastContent==='live',embeddable:v.status.embeddable!==false}));});
}
export async function search(request:Request, query:string){
  query=query.trim();if(query.length<2||query.length>120)fail(400,'Skriv mellom 2 og 120 tegn.');
  await limit(request,'search-visitor',20,600000);
  if(/^https?:\/\//.test(query))return {videos:await videos(request,[videoId(query)])};
  const result=await cached(`search:${query.toLowerCase()}`,async()=>{if(coreUrl()){try{return (await coreRequest<{videos:Video[]}>('/v1/catalog?q='+encodeURIComponent(query))).videos;}catch{/* retain the direct metadata API */}}await limit(request,'search-budget',40,86400000,true);const data=await youtube('search',{part:'snippet',q:query,type:'video',maxResults:'8',videoEmbeddable:'true',safeSearch:'moderate'});return videos(request,data.items.map((v:any)=>v.id.videoId));});return {videos:result};
}
type Row={is_public?:number;guild_id?:string;code:string;name:string;owner_hash:string;state:string;version:number;updated_at:number;expires_at:number};
export async function row(code:string){if(!/^[A-Z0-9]{8}$/.test(code))fail(404,'Rommet finnes ikke.');const value=await db().prepare('SELECT * FROM rooms WHERE code=? AND expires_at>?').bind(code,Date.now()).first<Row>();if(!value)fail(404,'Rommet er avsluttet eller har gått ut. Lag et nytt rom.');return value;}
export async function publicRoom(request:Request, value:Row, heartbeat=true):Promise<Room>{
  const state=JSON.parse(value.state) as RoomState;const actor=request.headers.get('x-muse-visitor');const now=Date.now();
  const discord=Boolean(value.guild_id)||value.code==='DISCORD1';const discordOnline=discord&&now-value.updated_at<15000;
  if(discord&&!discordOnline)state.playing=false;
  const {radioHistory,...visibleState}=state;
  if(heartbeat && actor && /^[a-f0-9-]{32,40}$/.test(actor))await db().prepare('INSERT INTO visitors(key,room,until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<?').bind(`${value.code}:${actor}`,value.code,now+45000,now+30000).run();
  const viewers=await db().prepare('SELECT count(*) AS n FROM visitors WHERE room=? AND until>?').bind(value.code,now).first<{n:number}>();
  if(!discord&&coreUrl()){try{const data=await coreRequest<{room:Room}>('/v1/rooms','POST',{operation:'import',...value});return {...data.room,isPublic:value.is_public===1,viewers:viewers?.n??0,isHost:await hash(bearer(request))===value.owner_hash};}catch{fail(503,'Rommet venter på sanntidstjenesten. Prøv igjen.');}}
  const position=state.position+(state.playing?(discord?Math.min(12000,now-value.updated_at):now-value.updated_at)/1000:0);
  return {code:value.code,name:value.name,...visibleState,radio:state.radio!==false,isPublic:value.is_public===1,position:state.current&&!state.current.live?Math.min(state.current.duration,position):position,version:value.version,serverTime:now,viewers:viewers?.n??0,isHost:!discord&&await hash(bearer(request))===value.owner_hash,expiresAt:value.expires_at,...(discord?{mode:'discord' as const,guildId:value.guild_id,discordOnline,syncValidForMs:Math.max(0,12000-(now-value.updated_at))}:{})};
}
export async function createRoom(request:Request,name:string,isPublic=false){
  await limit(request,'create-room',5,3600000);await limit(request,'room-budget',100,86400000,true);
  name=String(name??'').trim();if(!name||name.length>48)fail(400,'Gi rommet et navn med 1 til 48 tegn.');
  const code=Array.from(crypto.getRandomValues(new Uint8Array(8))).map(v=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[v%32]).join('');const token=secret();const now=Date.now();
  await db().batch([db().prepare('DELETE FROM visitors WHERE until<?').bind(now),db().prepare('DELETE FROM rooms WHERE expires_at<?').bind(now),db().prepare('DELETE FROM cached WHERE expires_at<?').bind(now),db().prepare('DELETE FROM limits WHERE until<?').bind(now)]);
  await db().prepare('INSERT INTO rooms(code,name,owner_hash,state,version,updated_at,expires_at,is_public) VALUES(?,?,?,?,1,?,?,?)').bind(code,name,await hash(token),JSON.stringify({current:null,queue:[],playing:false,position:0}),now,now+172800000,isPublic?1:0).run();return {room:await publicRoom(request,await row(code)),token};
}
/** Explicitly listed user rooms only. No tokens, queue, guild or visitor identities. */
export async function openRooms(request:Request){
  await limit(request,'room-directory',60,60000);
  const now=Date.now();
  const result=await db().prepare(`SELECT r.code,r.name,r.expires_at,
    (SELECT count(*) FROM visitors v WHERE v.room=r.code AND v.until>?) AS viewers
    FROM rooms r WHERE r.is_public=1 AND r.expires_at>? AND r.guild_id IS NULL AND r.code!='DISCORD1'
    ORDER BY viewers DESC,r.updated_at DESC LIMIT 60`).bind(now,now).all<{code:string;name:string;expires_at:number;viewers:number}>();
  return {rooms:result.results.map(r=>({code:r.code,name:r.name,viewers:r.viewers,expiresAt:r.expires_at}))};
}
export async function mutate(request:Request,code:string,input:Record<string,unknown>){
  if(code==='DISCORD1'||(await row(code)).guild_id)fail(403,'Discord-rommet styres fra boten eller adminpanelet. Opprett et eget rom for video og kø.');
  await limit(request,'room-actions',40,60000);const value=await row(code);const state=JSON.parse(value.state) as RoomState;const host=await hash(bearer(request))===value.owner_hash;const now=Date.now();
  if(input.action==='visibility'){if(!host)fail(403,'Bare verten kan endre synligheten.');if(typeof input.isPublic!=='boolean')fail(400,'Velg offentlig eller privat rom.');await db().prepare('UPDATE rooms SET is_public=? WHERE code=?').bind(input.isPublic?1:0,code).run();return {room:await publicRoom(request,await row(code))};}
  if(coreUrl()){let live:Room;try{live=(await coreRequest<{room:Room}>('/v1/rooms','POST',{operation:'import',...value})).room;}catch{fail(503,'Rommet venter på sanntidstjenesten.');}if(input.action==='played'){if(!host||!live.playing||!live.current||input.videoId!==live.current.id)fail(403,'Spillehendelsen samsvarer ikke med rommet.');await recordPlay(live.playbackKey??`room:${code}:${live.version}`,live.current,'web',now);return {ok:true};}let video:Video|undefined;if(input.action==='add'||input.action==='play-video'){if(typeof input.videoId!=='string'||!/^[\w-]{11}$/.test(input.videoId))fail(400,'Velg en YouTube-video.');video=(await videos(request,[input.videoId]))[0];if(!video)fail(404,'Videoen er ikke tilgjengelig.');}try{const result=await coreRequest<{room:Room}>('/v1/rooms','POST',{...input,operation:'mutate',code,actorHash:await hash(bearer(request)),video});return {room:{...result.room,isHost:host}};}catch(error){const e=error as Error&{status?:number};fail(e.status??503,e.message);}}
  if(input.action==='played'){
    if(!host||!state.playing||!state.current||input.videoId!==state.current.id)fail(403,'Spillehendelsen samsvarer ikke med rommet.');
    await recordPlay(state.playbackKey??`room:${code}:existing:${state.current.id}`,state.current,'web',now);
    return {ok:true};
  }
  if(input.version!==value.version)fail(409,'Rommet er endret. Prøv igjen med den nye køen.');
  if(state.playing)state.position+=(now-value.updated_at)/1000;
  const action=input.action;
  if(action!=='add'&&!host)fail(403,'Bare verten kan styre avspillingen. Du kan legge sanger i køen.');
  if(action==='add'||action==='play-video'){
    if(typeof input.videoId!=='string'||!/^[\w-]{11}$/.test(input.videoId))fail(400,'Velg en YouTube-video.');const video=(await videos(request,[input.videoId]))[0];if(!video)fail(404,'Videoen er ikke tilgjengelig.');if(!video.embeddable)fail(422,'Eieren har blokkert avspilling på andre nettsider. Velg en annen video.');
    if(action==='add'){if(state.queue.length>=50)fail(400,'Køen har plass til 50 videoer.');if(state.current?.id===video.id||state.queue.some(v=>v.id===video.id))fail(409,'Videoen er allerede i rommet.');if(!state.current){state.current=video;state.position=0;state.playing=false;}else state.queue.push(video);}else{state.current=video;state.position=0;state.playing=true;}
  }else if(action==='play'||action==='pause'){if(!state.current)fail(400,'Legg til en video først.');state.playing=action==='play';}
  else if(action==='seek'){if(!state.current||state.current.live||typeof input.position!=='number'||!Number.isFinite(input.position))fail(400,'Denne videoen kan ikke spoles.');state.position=Math.max(0,Math.min(state.current.duration-1,input.position));}
  else if(action==='next'){const recommended=await roomRecommendation(state,async query=>(await search(request,query)).videos);state.radioHistory=roomRadioHistory(state);state.current=state.queue.shift()??recommended;state.position=0;state.playing=Boolean(state.current);}
  else if(action==='radio'){if(typeof input.enabled!=='boolean')fail(400,'Velg radio på eller av.');state.radio=input.enabled;}
  else if(action==='remove'){if(!Number.isInteger(input.index)||Number(input.index)<0||Number(input.index)>=state.queue.length)fail(400,'Køplassen finnes ikke.');state.queue.splice(Number(input.index),1);}
  else if(action==='clear'){state.queue=[];}else fail(400,'Ukjent handling.');
  if(state.current&&(!state.playbackKey||action==='next'||action==='play-video'))state.playbackKey=`room:${code}:${value.version+1}`;
  const updatedAt=action==='next'||action==='play-video'?Date.now():now;
  const result=await db().prepare('UPDATE rooms SET state=?,version=version+1,updated_at=? WHERE code=? AND version=?').bind(JSON.stringify(state),updatedAt,code,value.version).run();if(!result.meta.changes)fail(409,'En annen endring kom først. Prøv igjen.');
  return {room:await publicRoom(request,await row(code))};
}
export async function adminRooms(request:Request){if(!await isAdmin(request))fail(403,'Denne siden er bare for administratoren.');const all=await db().prepare('SELECT * FROM rooms WHERE expires_at>? ORDER BY updated_at DESC LIMIT 100').bind(Date.now()).all<Row>();return {rooms:await Promise.all(all.results.map(r=>publicRoom(request,r,false)))};}
export async function closeRoom(request:Request,code:string){if(!await isAdmin(request))fail(403,'Bare administratoren kan avslutte rom.');if(code==='DISCORD1'||(await row(code)).guild_id)fail(400,'Discord-rommet følger boten og kan ikke avsluttes her.');if(coreUrl()){await coreRequest('/v1/rooms','POST',{operation:'import',...await row(code)});await coreRequest('/v1/rooms','POST',{operation:'close',code});}await db().batch([db().prepare('DELETE FROM rooms WHERE code=?').bind(code),db().prepare('DELETE FROM visitors WHERE room=?').bind(code)]);return {ok:true};}
