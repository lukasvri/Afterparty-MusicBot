import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {Store} from './store.ts';
import {UserError} from './types.ts';
import {ROOM_START_LEAD_MS,ROOM_LEASE_MS,readRoomTimeline,type RoomTimeline,type RoomVideo} from './protocol.ts';
import {roomRecommendation,roomRadioHistory} from './room-radio.ts';
type Saved={code:string;name:string;ownerHash:string;state:{current:RoomVideo|null;queue:RoomVideo[];playing:boolean;position:number;playbackKey?:string;startsAt?:number;radio?:boolean;radioHistory?:RoomVideo[]};version:number;updatedAt:number;expiresAt:number};
export class Rooms extends EventEmitter{
 readonly epoch=randomUUID();
 readonly store:Store;readonly now:()=>number;
 search:((query:string)=>Promise<RoomVideo[]>)|null=null;
 constructor(store:Store,now:()=>number=Date.now){super();this.store=store;this.now=now;store.db.exec('CREATE TABLE IF NOT EXISTS video_rooms(code TEXT PRIMARY KEY,data TEXT NOT NULL)');}
 load(code:string):Saved{if(!/^[A-Z0-9]{8}$/.test(code)||code==='DISCORD1')throw new UserError('Rommet finnes ikke.',404);const value=this.store.db.prepare('SELECT data FROM video_rooms WHERE code=?').get(code);if(!value)throw new UserError('Rommet finnes ikke.',404);const room=JSON.parse(String(value.data)) as Saved;if(room.expiresAt<=this.now())throw new UserError('Rommet er avsluttet.',404);return room;}
 save(room:Saved){this.store.db.prepare('INSERT INTO video_rooms VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data').run(room.code,JSON.stringify(room));}
 import(input:Record<string,unknown>){const code=String(input.code??'');try{return this.snapshot(code);}catch(error){if(!(error instanceof UserError)||error.status!==404)throw error;}
 const state=JSON.parse(typeof input.state==='string'?input.state:JSON.stringify(input.state??{}));const candidate={code,name:input.name,...state,version:input.version,serverTime:input.updated_at,position:state?.position,viewers:0,isHost:false,expiresAt:input.expires_at,syncSource:'live',syncEpoch:this.epoch,syncValidForMs:ROOM_LEASE_MS};if(!readRoomTimeline(candidate)||typeof input.owner_hash!=='string'||!/^[a-f0-9]{64}$/.test(input.owner_hash)||!Number.isFinite(input.expires_at)||Number(input.expires_at)<=this.now())throw new UserError('Ugyldig rom.');
 this.save({code,name:String(input.name),ownerHash:input.owner_hash,state,version:Number(input.version),updatedAt:Number(input.updated_at),expiresAt:Number(input.expires_at)});return this.snapshot(code);}
 snapshot(code:string):RoomTimeline{const r=this.load(code),now=this.now();const position=r.state.position+(r.state.playing?Math.max(0,now-Math.max(r.updatedAt,r.state.startsAt??r.updatedAt))/1000:0);return {code:r.code,name:r.name,current:r.state.current,queue:r.state.queue,radio:r.state.radio!==false,playing:r.state.playing,position:r.state.current&&!r.state.current.live?Math.min(Math.max(0,r.state.current.duration-.1),position):position,playbackKey:r.state.playbackKey,startsAt:r.state.startsAt,version:r.version,serverTime:now,viewers:0,isHost:false,expiresAt:r.expiresAt,syncSource:'live',syncEpoch:this.epoch,syncValidForMs:ROOM_LEASE_MS};}
 async control(code:string,input:Record<string,unknown>){
  if(input.action!=='next'||!this.search)return this.mutate(code,input);
  const saved=this.load(code);
  if(input.actorHash!==saved.ownerHash)throw new UserError('Bare verten kan styre avspillingen.',403);
  if(input.version!==saved.version)throw new UserError('Rommet er endret. Prøv igjen.',409);
  const recommended=await roomRecommendation(saved.state,this.search);
  // mutate rechecks the owner and version after the asynchronous lookup.
  return this.mutate(code,input,recommended);
 }
 mutate(code:string,input:Record<string,unknown>,recommended:RoomVideo|null=null){const r=this.load(code),host=typeof input.actorHash==='string'&&input.actorHash===r.ownerHash,action=String(input.action);if(action!=='add'&&!host)throw new UserError('Bare verten kan styre avspillingen.',403);if(input.version!==r.version)throw new UserError('Rommet er endret. Prøv igjen.',409);const now=this.now(),s={...r.state,queue:[...r.state.queue],position:this.snapshot(code).position};
 if(action==='add'||action==='play-video'){const video=input.video as RoomVideo;if(!readRoomTimeline({...this.snapshot(code),current:video})||!video?.embeddable)throw new UserError('Videoen kan ikke vises her.',422);if(action==='add'){if(s.queue.length>=50)throw new UserError('Køen er full.');if(s.current?.id===video.id||s.queue.some(v=>v.id===video.id))throw new UserError('Videoen er allerede i rommet.',409);if(!s.current){s.current=video;s.position=0;s.playing=false;s.playbackKey=randomUUID();}else s.queue.push(video);}else{s.current=video;s.position=0;s.playing=true;s.playbackKey=randomUUID();}}
 else if(action==='play'||action==='pause'){if(!s.current)throw new UserError('Legg til en video først.');s.playing=action==='play';}
 else if(action==='seek'){if(!s.current||s.current.live||typeof input.position!=='number'||!Number.isFinite(input.position))throw new UserError('Videoen kan ikke spoles.');s.position=Math.max(0,Math.min(Math.max(0,s.current.duration-1),input.position));}
 else if(action==='next'){s.radioHistory=roomRadioHistory(s);if(recommended&&(!recommended.embeddable||!readRoomTimeline({...this.snapshot(code),current:recommended})))throw new UserError('Videoen kan ikke vises her.',422);s.current=s.queue.shift()??recommended;s.position=0;s.playing=Boolean(s.current);s.playbackKey=randomUUID();}
 else if(action==='radio'){if(typeof input.enabled!=='boolean')throw new UserError('Velg radio på eller av.');s.radio=input.enabled;}
 else if(action==='remove'){if(!Number.isInteger(input.index)||Number(input.index)<0||Number(input.index)>=s.queue.length)throw new UserError('Køplassen finnes ikke.');s.queue.splice(Number(input.index),1);}
 else if(action==='clear')s.queue=[];else throw new UserError('Ukjent handling.');
 // Every client receives the change before the shared play deadline. Queue-only edits retain the existing deadline.
 if(['play','seek','next','play-video'].includes(action)&&s.playing)s.startsAt=now+ROOM_START_LEAD_MS;else if(!s.playing)delete s.startsAt;
 r.state=s;r.updatedAt=now;r.version++;this.save(r);const room=this.snapshot(code);this.emit('change',code);return room;}
 close(code:string){this.load(code);this.store.db.prepare('DELETE FROM video_rooms WHERE code=?').run(code);this.emit('change',code);}
}
