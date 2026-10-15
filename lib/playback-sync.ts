import {elapsedPlayingMs} from '../services/core/src/protocol.ts';
import type {Room} from './types.ts';
export function compensateDelivery(room:Room,roundTripMs:number):Room {
 const transit=Math.min(1500,Math.max(0,roundTripMs/2));
 return {...room,position:room.position+(room.playing&&!room.buffering?elapsedPlayingMs(room.serverTime,room.startsAt,transit)/1000:0),serverTime:room.serverTime+transit,...(room.syncValidForMs!==undefined?{syncValidForMs:Math.max(0,room.syncValidForMs-transit)}:{})};
}
export function playbackTarget(room:Room,receivedAt:number,now:number,offset=0){
 const age=Math.max(0,now-receivedAt);
 const tracked=room.mode==='discord'||room.syncSource==='live';
 const stale=tracked&&age>=(room.syncValidForMs??12000);
 const playing=room.playing&&!stale&&(!room.startsAt||room.serverTime+age>=room.startsAt);
 const advance=room.playing&&!room.buffering?elapsedPlayingMs(room.serverTime,room.startsAt,Math.min(age,tracked?(room.syncValidForMs??12000):age))/1000:0;
 const raw=room.position+advance+(room.mode==='discord'?offset:0);
 const position=Math.max(0,room.current&&!room.current.live?Math.min(Math.max(0,room.current.duration-.1),raw):raw);
 return {position,playing,stale};
}
export type SyncMode='stable'|'precise';
export function readSyncMode(saved:string|null):SyncMode{return saved==='stable'?'stable':'precise';}
export function syncRecoveryMs(mode:SyncMode){return mode==='precise'?2000:4000;}
export function roomPollMs(hidden:boolean){return hidden?4000:1000;}
export function shouldCorrect(position:number,current:number,now:number,lastCorrection:number,force=false,mode:SyncMode='precise'){
 const interval=mode==='precise'?3000:6000;
 const tolerance=mode==='precise'?.5:1.5;
 return Number.isFinite(current)&&(force||now-lastCorrection>=interval)&&Math.abs(position-current)>(force ? .15 : tolerance);
}
export function canCorrectPlayback(state:number,playing:boolean,now:number,settleUntil:number,force=false){
 // Seeking during buffering or immediately after recovery discards useful buffered data.
 return state!==3&&(force||!playing||now>=settleUntil);
}
/** Reject delayed polls/commands after a newer snapshot of the same timeline. */
export function isOlderSnapshot(previous:Room|null, next:Room){
 return Boolean(previous && previous.code===next.code && previous.syncSource===next.syncSource && previous.syncEpoch===next.syncEpoch &&
  (previous.version>next.version || (previous.version===next.version && previous.serverTime>next.serverTime)));
}

export function transportChanged(previous:Room|null,next:Room){
 if(previous?.buffering || next.buffering) return Boolean(previous && previous.playing!==next.playing);
 if(!previous || previous.code!==next.code || previous.current?.id!==next.current?.id || next.version<=previous.version)return false;
 const predicted=previous.position+(previous.playing?elapsedPlayingMs(previous.serverTime,previous.startsAt,Math.max(0,next.serverTime-previous.serverTime))/1000:0);
 return previous.playing!==next.playing || Math.abs(next.position-predicted)>.5;
}
