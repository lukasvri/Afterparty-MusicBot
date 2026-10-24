import {env} from 'cloudflare:workers';
import {db,hash,fail,isAdmin,limit} from './server';
import {coreUrl,commandTicket,coreRequest,corePresence,legacyBridgeOverride} from './core-server';
import {adminState} from './discord-auth';
import {constantEqual} from './password';
import type {Video,DiscordState} from './types';
import {CORE_PRESENCE_CAPABILITY, CORE_PRESENCE_DEADLINE_MS, BRIDGE_RECONCILIATION_REQUIRED, sameBridgeIntent, validBridgeIntent, validBridgeCheckpoint} from '../services/core/src/bridge-checkpoint.ts';
export const botActions=['pause','resume','skip','stop','shuffle','clear','volume','seek','enqueue'] as const;
function cleanVideo(value:unknown):Video|null{
 if(value===null)return null;if(!value||typeof value!=='object')fail(400,'Ugyldig videodata.');const v=value as Video;
 if(!/^[\w-]{11}$/.test(v.id)||typeof v.title!=='string'||typeof v.artist!=='string'||!Number.isFinite(v.duration)||v.duration<0)fail(400,'Ugyldig videodata.');
 return {id:v.id,title:v.title.slice(0,220),artist:v.artist.slice(0,120),duration:Math.min(v.duration,172800),image:`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,live:v.live===true,embeddable:v.embeddable!==false,concert:v.concert===true};
}
export async function recordPlay(id:string,video:Video,source:'web'|'discord',at:number){await db().prepare('INSERT OR IGNORE INTO playback_history(event_id,video_id,video,source,played_at) VALUES(?,?,?,?,?)').bind(id,video.id,JSON.stringify(video),source,at).run();}
export async function history(sort='recent'){
 const rows=await db().prepare(`SELECT video,source,COUNT(*) AS plays,MAX(played_at) AS lastPlayed FROM playback_history WHERE source='web' OR json_extract(video,'$.concert')=1 GROUP BY video_id ORDER BY ${sort==='popular'?'plays DESC,lastPlayed DESC':'lastPlayed DESC'} LIMIT 12`).all<{video:string;source:string;plays:number;lastPlayed:number}>();
 return {videos:rows.results.map(r=>({...JSON.parse(r.video),plays:r.plays,lastPlayed:r.lastPlayed,source:r.source}))};
}
export async function discord(all=false,guildId?:string,signal?:AbortSignal){
 if(coreUrl()){try{return {state: all
   ? (await coreRequest<{state:DiscordState}>('/v1/state?'+new URLSearchParams({all:'1',...guildId?{guildId}:{}}),'GET',undefined,{},signal?AbortSignal.any([signal,AbortSignal.timeout(CORE_PRESENCE_DEADLINE_MS)]):AbortSignal.timeout(CORE_PRESENCE_DEADLINE_MS))).state
   : await corePresence(guildId,undefined,signal)};}catch{/* durable negotiated presence is offline without fresh Core */}}
 // The default room points at its guild's canonical heartbeat. Legacy unscoped
 // bridges retain their original key; a missing guild row never uses that alias.
 const row=await db().prepare("SELECT state,updated_at FROM bot_state WHERE key=COALESCE(?,(SELECT 'discord:'||guild_id FROM rooms WHERE code='DISCORD1'),'discord')").bind(guildId?'discord:'+guildId:null).first<{state:string;updated_at:number}>();
 if(!row)return {state:null};const state=JSON.parse(row.state) as DiscordState & {presenceCapability?:string};const authority=state.presenceCapability===CORE_PRESENCE_CAPABILITY;return {state:{...state,...authority?{playing:false}:{},lastSeen:row.updated_at,online:!authority&&Date.now()-row.updated_at<15000}};
}
export async function bridge(request:Request,input:Record<string,unknown>){
 const key=(env as unknown as {ADMIN_BRIDGE_KEY?:string}).ADMIN_BRIDGE_KEY;
 const provided=(request.headers.get('authorization')??'').replace(/^Bearer /,'');
 if(!key||!constantEqual(await hash(provided),await hash(key)))fail(403,'Brokoblingen har ikke tilgang.');
 const checkpointed=input.bridgeRevision!==undefined||input.checkpointRevision!==undefined;
 if(checkpointed&&!validBridgeCheckpoint(input))fail(400,'Ugyldig publiseringsrevisjon.');
 const bridgeRevision=checkpointed?Number(input.bridgeRevision):null;
 const checkpointRevision=checkpointed?Number(input.checkpointRevision):null;
 const guildId=typeof input.guildId==='string'?input.guildId:null,roomCode=typeof input.roomCode==='string'?input.roomCode:'DISCORD1';if(guildId&&!/^\d{14,22}$/.test(guildId)||!/^[A-Z0-9]{8}$/.test(roomCode))fail(400,'Ugyldig serverkobling.');const botKey=guildId?'discord:'+guildId:'discord';
 let raw=input.state as Record<string,unknown>;
 const optedIn=input.presenceCapability===CORE_PRESENCE_CAPABILITY;
 if(input.presenceCapability!==undefined&&!optedIn)fail(400,'Ugyldig nærværskontrakt.');
 let authority=false,canWriteState=true;
 if(optedIn){
  if(!checkpointed||!guildId||!raw||!validBridgeIntent(raw))fail(400,'Core-nærvær krever server, spillerintensjon og publiseringsrevisjon.');
  const stored=await db().prepare('SELECT state FROM bot_state WHERE key=?').bind(botKey).first<{state:string}>();
  const savedRoom=await db().prepare("SELECT state FROM rooms WHERE guild_id IS ? AND json_extract(state,'$.presenceCapability')=? ORDER BY COALESCE(json_extract(state,'$.bridgeRevision'),json_extract(state,'$.checkpointRevision'),0) DESC LIMIT 1").bind(guildId,CORE_PRESENCE_CAPABILITY).first<{state:string}>();
  const durableRoom=savedRoom?JSON.parse(savedRoom.state) as Record<string,unknown>:null;
  const heartbeat=stored?JSON.parse(stored.state) as Record<string,unknown>:null;
  const old=durableRoom?.presenceCapability===CORE_PRESENCE_CAPABILITY&&Number(durableRoom.bridgeRevision??durableRoom.checkpointRevision)>Number(heartbeat?.bridgeRevision??0)
   ? {...durableRoom,bridgeRevision:durableRoom.bridgeRevision??durableRoom.checkpointRevision}:heartbeat;
  if(old&&old.epoch!==raw.epoch&&Number(old.bridgeRevision)>=Number(bridgeRevision))
   throw Object.assign(new Error('Publiseringen krever manuell avstemming av lagret tilstand.'),{status:409,code:BRIDGE_RECONCILIATION_REQUIRED});
  let fresh:Record<string,unknown>|null=null;
  try{fresh=await corePresence(guildId,roomCode,request.signal);}catch{/* receipts remain durable even while direct presence is unavailable */}
  canWriteState=Boolean(fresh);
  if(fresh){
   if(!sameBridgeIntent(raw,fresh))fail(409,'Publiseringen tilhører ikke gjeldende Core-tilstand.');
   raw={...fresh,current:fresh.current&&/^[\w-]{11}$/.test(String((fresh.current as Video).id))?fresh.current:null,
    queue:(fresh.queue as Video[]).filter(video=>/^[\w-]{11}$/.test(video.id))};
   authority=!legacyBridgeOverride();
  }
 }

 if(!raw||typeof raw!=='object'||!Array.isArray(raw.queue)||raw.queue.length>40||typeof raw.ready!=='boolean'||typeof raw.connected!=='boolean'||typeof raw.playing!=='boolean'||!Number.isFinite(raw.position)||Number(raw.position)<0||!Number.isFinite(raw.volume)||Number(raw.volume)<0||Number(raw.volume)>100||typeof raw.queueRevision!=='string'||raw.queueRevision.length>100)fail(400,'Ugyldig spillerstatus.');
 const concert=cleanVideo(raw.current);
 const state={buffering:raw.buffering===true,ready:raw.ready,connected:raw.connected,playing:Boolean(concert?.concert)&&raw.playing,position:concert?.concert?Number(raw.position):0,volume:Number(raw.volume),current:concert?.concert?concert:null,queue:raw.queue.map(cleanVideo).filter((v):v is Video=>Boolean(v?.concert)),queueRevision:raw.queueRevision};
 const now=Date.now();const age=!optedIn&&Number.isFinite(input.sampledAt)?Math.max(0,Math.min(12000,now-Number(input.sampledAt))):0;const playbackKey=typeof raw.playbackKey==='string'?raw.playbackKey.slice(0,160):undefined;const position=state.position+(state.playing&&!state.buffering?age/1000:0);const serialized=JSON.stringify({...state,position,playbackKey,...checkpointed?{bridgeRevision,checkpointRevision}:{},...optedIn?{epoch:raw.epoch,sequence:raw.sequence}:{},...authority?{presenceCapability:CORE_PRESENCE_CAPABILITY}:{},...guildId?{guildId,roomCode,guildName:String(input.guildName??'Discord').slice(0,80)}:{}});
 // bot_state owns the live heartbeat. Persist unchanged room snapshots only
 // when their 48-hour lease needs renewal, keeping polls free of room writes.
 const roomState=JSON.stringify({current:state.current,queue:state.queue,playing:state.playing,buffering:state.buffering,position,playbackKey,...checkpointed?{bridgeRevision,checkpointRevision}:{},...optedIn?{epoch:raw.epoch,sequence:raw.sequence}:{},...authority?{presenceCapability:CORE_PRESENCE_CAPABILITY}:{}});
 const roomName='Discord · '+String(input.guildName??'Afterparty').slice(0,80);
 // A newer publication must win before its room checkpoint can be installed.
 // The same transaction keeps delayed retries from restoring an older pause,
 // seek or queue. Legacy publishers retain the existing rolling-upgrade path.
 const roomStatement=checkpointed
  ?db().prepare("INSERT INTO rooms(code,name,owner_hash,state,version,updated_at,expires_at,guild_id) SELECT ?,?,'private-discord',?,1,?,?,? WHERE EXISTS(SELECT 1 FROM bot_state WHERE key=? AND state=? AND json_extract(state,'$.bridgeRevision')=? AND json_extract(state,'$.checkpointRevision')=?) ON CONFLICT(code) DO UPDATE SET state=excluded.state,version=version+1,updated_at=excluded.updated_at,expires_at=excluded.expires_at,guild_id=excluded.guild_id WHERE rooms.guild_id IS NOT excluded.guild_id OR COALESCE(json_extract(rooms.state,'$.checkpointRevision'),0)<json_extract(excluded.state,'$.checkpointRevision')").bind(roomCode,roomName,roomState,now,now+172800000,guildId,botKey,serialized,bridgeRevision,checkpointRevision)
  :db().prepare("INSERT INTO rooms(code,name,owner_hash,state,version,updated_at,expires_at,guild_id) SELECT ?,?,'private-discord',?,1,?,?,? WHERE NOT EXISTS(SELECT 1 FROM bot_state WHERE key=? AND json_extract(state,'$.presenceCapability') IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM rooms WHERE (guild_id IS ? OR (? IS NULL AND code='DISCORD1')) AND json_extract(state,'$.presenceCapability') IS NOT NULL) ON CONFLICT(code) DO UPDATE SET state=excluded.state,version=version+1,updated_at=excluded.updated_at,expires_at=excluded.expires_at,guild_id=excluded.guild_id WHERE rooms.state IS NOT excluded.state OR rooms.guild_id IS NOT excluded.guild_id OR rooms.expires_at<=excluded.updated_at+86400000").bind(roomCode,roomName,roomState,now,now+172800000,guildId,botKey,guildId,guildId);
 const statements=canWriteState?[db().prepare("INSERT INTO bot_state(key,state,updated_at) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM rooms WHERE (guild_id IS ? OR (? IS NULL AND code='DISCORD1')) AND json_extract(state,'$.presenceCapability')=? AND (?=0 OR COALESCE(json_extract(state,'$.checkpointRevision'),0)>?)) ON CONFLICT(key) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at WHERE (? IS NULL OR (COALESCE(json_extract(bot_state.state,'$.bridgeRevision'),0)<? AND COALESCE(json_extract(bot_state.state,'$.checkpointRevision'),0)<=?)) AND (json_extract(bot_state.state,'$.presenceCapability') IS NULL OR ?=1) AND (?=0 OR COALESCE(json_extract(bot_state.state,'$.checkpointRevision'),0)<?) AND (json_extract(bot_state.state,'$.presenceCapability') IS NULL OR COALESCE(json_extract(bot_state.state,'$.checkpointRevision'),0)<?)").bind(botKey,serialized,now,guildId,guildId,CORE_PRESENCE_CAPABILITY,optedIn?1:0,checkpointRevision,bridgeRevision,bridgeRevision,checkpointRevision,optedIn?1:0,authority?1:0,checkpointRevision,checkpointRevision),roomStatement]:[];
 if(input.events!==undefined&&!Array.isArray(input.events))fail(400,'Ugyldig historikk.');
 for(const event of (input.events as Record<string,unknown>[]??[]).slice(0,20)){
  if(!event||typeof event.id!=='string'||event.id.length>160||typeof event.at!=='number'||!Number.isFinite(event.at)||event.at>now+60000||event.at<now-7776000000)fail(400,'Ugyldig spillehendelse.');const video=cleanVideo(event.video);if(video?.concert)statements.push(db().prepare('INSERT OR IGNORE INTO playback_history(event_id,video_id,video,source,played_at) VALUES(?,?,?,?,?)').bind(`discord:${event.id}`,video.id,JSON.stringify(video),'discord',event.at));
 }
 if(input.results!==undefined&&!Array.isArray(input.results))fail(400,'Ugyldig kommandosvar.');
 for(const result of (input.results as Record<string,unknown>[]??[]).slice(0,20))if(typeof result?.id==='string'&&typeof result.ok==='boolean')statements.push(db().prepare("UPDATE bot_commands SET status=?,result=? WHERE id=? AND status='processing' AND (guild_id=? OR (guild_id IS NULL AND ?))").bind(result.ok?'done':'failed',typeof result.message==='string'?result.message.slice(0,250):'',result.id,guildId,roomCode==='DISCORD1'));
 statements.push(db().prepare("UPDATE bot_commands SET status=CASE WHEN status='processing' THEN 'unknown' ELSE 'expired' END,result='Boten bekreftet ikke kommandoen innen fristen.' WHERE expires_at<? AND status IN ('pending','processing')").bind(now),db().prepare('DELETE FROM playback_history WHERE played_at<?').bind(now-7776000000),db().prepare('DELETE FROM bot_commands WHERE created_at<?').bind(now-86400000));
 await db().batch(statements);
 if(optedIn&&!canWriteState)return {serverTime:Date.now(),commands:[]};
 const jobs=await db().prepare("UPDATE bot_commands SET status='processing' WHERE id IN (SELECT id FROM bot_commands WHERE status='pending' AND expires_at>? AND (guild_id=? OR (guild_id IS NULL AND ?)) AND (?=1 OR (NOT EXISTS(SELECT 1 FROM bot_state WHERE key=? AND json_extract(state,'$.presenceCapability')=?) AND NOT EXISTS(SELECT 1 FROM rooms WHERE (guild_id IS ? OR (? IS NULL AND code='DISCORD1')) AND json_extract(state,'$.presenceCapability')=?))) ORDER BY created_at LIMIT 5) RETURNING id,payload,expires_at").bind(now,guildId,roomCode==='DISCORD1',optedIn&&canWriteState?1:0,botKey,CORE_PRESENCE_CAPABILITY,guildId,guildId,CORE_PRESENCE_CAPABILITY).all<{id:string;payload:string;expires_at:number}>();
 return {serverTime:Date.now(),commands:jobs.results.map(j=>({id:j.id,...JSON.parse(j.payload),expiresAt:j.expires_at}))};
}
export async function commands(request:Request){if(!await isAdmin(request))fail(403,'Logg inn for å styre boten.');if(coreUrl()){try{return {...await coreRequest<{commands:unknown[]}>('/v1/jobs'),serverTime:Date.now()};}catch{/* retain the durable bridge as fallback */}}const jobs=await db().prepare('SELECT id,payload,status,result,created_at AS createdAt FROM bot_commands ORDER BY created_at DESC LIMIT 15').all();return {serverTime:Date.now(),commands:jobs.results.map(j=>({...j,payload:JSON.parse(String(j.payload))}))};}
export async function enqueueCommand(request:Request,input:Record<string,unknown>,publicControl=false){
 const action=String(input.action);
 if(publicControl){if(!['enqueue','skip','pause','resume'].includes(action))fail(403,'Du kan legge til, hoppe over, pause og fortsette musikken her.');if(typeof input.commandId!=='string'||!/^[a-f0-9-]{36}$/.test(input.commandId))fail(400,'Ugyldig kommando-ID.');const previous=await db().prepare('SELECT status,guild_id FROM bot_commands WHERE id=?').bind(`public:${input.commandId}`).first<{status:string;guild_id:string|null}>();if(previous&&previous.guild_id!==(typeof input.guildId==='string'?input.guildId:null))fail(409,'Kommandoen tilhører en annen server.');if(previous)return {id:`public:${input.commandId}`,status:previous.status};const group=['pause','resume'].includes(action)?'transport':action;await limit(request,`public-bot-${group}`,action==='enqueue'?15:action==='skip'?3:6,60000);await limit(request,`public-bot-global-${group}`,action==='enqueue'?30:action==='skip'?6:12,60000,true);}
 else {if(!await isAdmin(request))fail(403,'Logg inn for å styre boten.');await limit(request,'bot-control',30,60000);}
 const guildId=typeof input.guildId==='string'?input.guildId:undefined;if(!publicControl&&guildId)await adminState(request,guildId);const {state}=await discord(!publicControl,guildId,request.signal);if(!state?.online||!state.ready)fail(503,'Boten er frakoblet. Kommandoen ble ikke sendt.');
 if(!botActions.includes(action as typeof botActions[number]))fail(400,'Ukjent botkommando.');
 const payload:Record<string,unknown>={action,...guildId?{guildId}:{}};
 if(publicControl&&['pause','resume','skip'].includes(action)){if(typeof input.playbackKey!=='string'||input.playbackKey!==(state as DiscordState&{playbackKey?:string}).playbackKey)fail(409,'Konserten er endret. Oppdater siden før du prøver igjen.');payload.playbackKey=input.playbackKey;}
 if(action==='enqueue'){if(typeof input.videoId!=='string'||!/^[\w-]{11}$/.test(input.videoId))fail(400,'Velg en YouTube-video.');if(!state.connected)fail(409,'Start boten i en talekanal i Discord først.');if(state.queue.length>=40)fail(409,'Discord-køen er full.');if(state.queue.some(v=>v.id===input.videoId))fail(409,'Sangen ligger allerede i Discord-køen.');payload.videoId=input.videoId;}
 if(['pause','resume'].includes(action)&&(!state.connected||!state.current))fail(409,'Ingen sang er klar i Discord.');
 if(action==='volume'){if(!Number.isInteger(input.value)||Number(input.value)<0||Number(input.value)>100)fail(400,'Velg volum fra 0 til 100.');payload.value=input.value;}
 if(action==='seek'){if(!state.current||state.current.live||!Number.isFinite(input.seconds)||Number(input.seconds)<0||Number(input.seconds)>=state.current.duration)fail(400,'Ugyldig posisjon.');payload.seconds=input.seconds;payload.queueRevision=state.queueRevision;}
 if(action==='skip'){if(!state.connected||!state.current)fail(409,'Ingen sang spiller i Discord.');if(typeof input.queueRevision==='string'&&input.queueRevision!==state.queueRevision)fail(409,'Sangen er allerede byttet.');payload.queueRevision=state.queueRevision;}
 const id=publicControl?`public:${input.commandId}`:crypto.randomUUID(),now=Date.now();const alreadyApplied=!coreUrl()&&publicControl&&(action==='pause'&&!state.playing||action==='resume'&&state.playing);const status=alreadyApplied?'done':'pending';await db().prepare("INSERT OR IGNORE INTO bot_commands(id,payload,status,created_at,expires_at,guild_id) VALUES(?,?,?,?,?,?)").bind(id,JSON.stringify(payload),status,now,now+30000,guildId??null).run();if(coreUrl()&&!alreadyApplied){try{const receipt=await coreRequest<{id:string;status:string}>('/v1/command','POST',{id,scope:publicControl?'public':'admin',bridge:true,...payload});const result=await coreRequest<{command:{status:string;result:string}|null}>('/v1/jobs?id='+encodeURIComponent(id)+(guildId?'&guildId='+guildId:''));return {id,status:result.command?.status??receipt.status};}catch{/* the durable, idempotent bridge retains the same command ID */}}return {id,status,...(alreadyApplied?{}:await commandTicket({id,scope:publicControl?'public':'admin',...payload}))};
}

type PublicCommand = {id:string;status:string;result:string|null};
export async function publicCommand(id:string,guildId?:string,signal?:AbortSignal):Promise<PublicCommand|null>{
 if(!/^public:[a-f0-9-]{36}$/.test(id))fail(400,'Ugyldig kommando-ID.');
 if(guildId!==undefined&&!/^\d{14,22}$/.test(guildId))fail(400,'Ugyldig server.');
 if(coreUrl()){
  try{return (await coreRequest<{command:PublicCommand|null}>('/v1/jobs?id='+encodeURIComponent(id)+(guildId?'&guildId='+guildId:''),'GET',undefined,{},signal?AbortSignal.any([signal,AbortSignal.timeout(CORE_PRESENCE_DEADLINE_MS)]):AbortSignal.timeout(CORE_PRESENCE_DEADLINE_MS))).command;}
  catch{/* retain the same guild boundary when the direct transport is unavailable */}
 }
 // Legacy unscoped jobs belong only to the authenticated bridge's default guild.
 return db().prepare("SELECT id,status,result FROM bot_commands WHERE id=? AND (guild_id IS ? OR (guild_id IS NULL AND EXISTS (SELECT 1 FROM rooms WHERE code='DISCORD1' AND guild_id=?)))")
  .bind(id,guildId??null,guildId??null).first<PublicCommand>();
}
