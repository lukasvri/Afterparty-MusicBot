import {elapsedPlayingMs} from '../services/core/src/protocol.ts';
import type {Room} from './types.ts';
export function compensateDelivery(room:Room,roundTripMs:number):Room {
 const transit=Math.min(1500,Math.max(0,roundTripMs/2));
 return {...room,position:room.position+(room.playing?elapsedPlayingMs(room.serverTime,room.startsAt,transit)/1000:0),serverTime:room.serverTime+transit,...(room.syncValidForMs!==undefined?{syncValidForMs:Math.max(0,room.syncValidForMs-transit)}:{})};
}
export function playbackTarget(room:Room,receivedAt:number,now:number,offset=0){
 const age=Math.max(0,now-receivedAt);
 const tracked=room.mode==='discord'||room.syncSource==='live';
 const stale=tracked&&age>=(room.syncValidForMs??12000);
 const playing=room.playing&&!stale&&(!room.startsAt||room.serverTime+age>=room.startsAt);
 const advance=room.playing?elapsedPlayingMs(room.serverTime,room.startsAt,Math.min(age,tracked?(room.syncValidForMs??12000):age))/1000:0;
 const raw=room.position+advance+(room.mode==='discord'?offset:0);
 const position=Math.max(0,room.current&&!room.current.live?Math.min(Math.max(0,room.current.duration-.1),raw):raw);
 return {position,playing,stale};
}
export type SyncMode='stable'|'precise';
export function readSyncMode(saved:string|null):SyncMode{return saved==='stable'?'stable':'precise';}
export function syncRecoveryMs(mode:SyncMode){return mode==='precise'?1500:4000;}
export function roomPollMs(hidden:boolean){return hidden?4000:1000;}
export function shouldCorrect(position:number,current:number,now:number,lastCorrection:number,force=false,mode:SyncMode='precise'){
 const interval=mode==='precise'?1400:6000;
 const tolerance=mode==='precise'?.18:1.5;
 return Number.isFinite(current)&&(force||now-lastCorrection>=interval)&&Math.abs(position-current)>(force ? .15 : tolerance);
}
export function canCorrectPlayback(state:number,playing:boolean,now:number,settleUntil:number,force=false){
 // Seeking during buffering or immediately after recovery discards useful buffered data.
 return state!==3&&(force||!playing||now>=settleUntil);
}
export function isLocalSeek(previous:{position:number;at:number;playing:boolean}|null,position:number,now:number){
 if(!previous||!Number.isFinite(position)||now<previous.at)return false;
 const expected=previous.position+(previous.playing?(now-previous.at)/1000:0);
 return Math.abs(position-expected)>2;
}
