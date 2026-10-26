import {elapsedPlayingMs,roomSeekPosition} from '../services/core/src/protocol.ts';
import type {Room} from './types.ts';
export function compensateDelivery(room:Room,roundTripMs:number):Room {
 const transit=Number.isFinite(roundTripMs)?Math.min(1500,Math.max(0,roundTripMs/2)):0;
 return {...room,position:room.position+(room.playing&&!room.buffering?elapsedPlayingMs(room.serverTime,room.startsAt,transit)/1000:0),syncSampledAt:room.syncSampledAt??room.serverTime,serverTime:room.serverTime+transit,...(room.syncValidForMs!==undefined?{syncValidForMs:Math.max(0,room.syncValidForMs-transit)}:{})};
}
export function playbackTarget(room:Room,receivedAt:number,now:number,offset=0){
 const age=Math.max(0,now-receivedAt);
 const tracked=room.mode==='discord'||room.syncSource==='live';
 const stale=tracked&&age>=(room.syncValidForMs??12000);
 const playing=room.playing&&!stale&&(!room.startsAt||room.serverTime+age>=room.startsAt);
 const advance=room.playing&&!room.buffering?elapsedPlayingMs(room.serverTime,room.startsAt,Math.min(age,tracked?(room.syncValidForMs??12000):age))/1000:0;
 const position=calibratedPlaybackPosition(room,room.position+advance,offset);
 return {position,playing,stale};
}
export const SYNC_OFFSET_KEY='afterparty-sync-offset';
export const SYNC_MODE_KEY='afterparty-sync-mode-v1';
export const MAX_SYNC_OFFSET_SECONDS=5;
export function readSyncOffset(saved:string|null){
 const value=Number(saved??0);
 return Number.isFinite(value)?Math.max(-MAX_SYNC_OFFSET_SECONDS,Math.min(MAX_SYNC_OFFSET_SECONDS,value)):0;
}
/** Local video calibration never alters shared room clocks or own-room playback. */
export function calibratedPlaybackPosition(room:Pick<Room,'current'|'mode'>,position:number,offset=0){
 const raw=position+(room.mode==='discord'?offset:0);
 return Math.max(0,room.current&&!room.current.live?Math.min(Math.max(0,room.current.duration-.1),raw):raw);
}
/** Convert a local scrub to an achievable shared target before confirmation. */
export function sharedSeekPosition(room:Pick<Room,'current'|'mode'>,position:number,offset=0){
 const shared=calibratedPlaybackPosition(room,position,-offset);
 return room.mode==='discord'||!room.current?shared:roomSeekPosition(shared,room.current.duration);
}
export type SyncMode='stable'|'precise';
export const DEFAULT_SYNC_MODE:SyncMode='stable';
export function readSyncMode(saved:string|null):SyncMode{return saved==='precise'?'precise':DEFAULT_SYNC_MODE;}
export function syncRecoveryMs(mode:SyncMode){return mode==='precise'?2000:4000;}
export function roomPollMs(hidden:boolean){return hidden?4000:1000;}
export function shouldCorrect(position:number,current:number,now:number,lastCorrection:number,force=false,mode:SyncMode=DEFAULT_SYNC_MODE){
 const interval=mode==='precise'?3000:6000;
 const tolerance=mode==='precise'?.5:1.5;
 return Number.isFinite(current)&&(force||now-lastCorrection>=interval)&&Math.abs(position-current)>(force ? .15 : tolerance);
}
/** One delayed iframe reading must not discard a healthy video buffer.
 * Manual transport stays immediate; smaller automatic drift must persist. */
export function createPlaybackCorrection() {
  let candidate: {direction: number; since: number; last: number; mode: SyncMode} | null = null;
  const reset = () => { candidate = null; };
  return {
    reset,
    shouldCorrect(position: number, current: number, now: number, lastCorrection: number, force = false, mode: SyncMode = DEFAULT_SYNC_MODE) {
      if (!Number.isFinite(position) || !Number.isFinite(now) ||
          !shouldCorrect(position, current, now, lastCorrection, force, mode)) {
        reset();
        return false;
      }
      const drift = position - current;
      if (force || Math.abs(drift) >= (mode === 'precise' ? 2.5 : 4)) {
        reset();
        return true;
      }
      const direction = Math.sign(drift);
      if (!candidate || candidate.direction !== direction || candidate.mode !== mode ||
          now < candidate.last || now - candidate.last > 1000) {
        candidate = {direction, since: now, last: now, mode};
      } else {
        candidate.last = now;
      }
      if (now - candidate.since < (mode === 'precise' ? 750 : 1500)) return false;
      reset();
      return true;
    },
  };
}

export function canCorrectPlayback(state:number,playing:boolean,now:number,settleUntil:number,force=false){
 // Seeking during buffering or immediately after recovery discards useful buffered data.
 return state!==3&&(force||!playing||now>=settleUntil);
}
/** Reject delayed polls/commands after a newer snapshot of the same timeline. */
export function isOlderSnapshot(previous:Room|null, next:Room){
 return Boolean(previous && previous.code===next.code && previous.syncSource===next.syncSource && previous.syncEpoch===next.syncEpoch &&
  (previous.version>next.version || (previous.version===next.version && (previous.syncSampledAt??previous.serverTime)>(next.syncSampledAt??next.serverTime))));
}
export function isDuplicateSnapshot(previous:Room|null,next:Room){
 return Boolean(previous && previous.code===next.code && previous.syncSource===next.syncSource && previous.syncEpoch===next.syncEpoch && previous.version===next.version &&
  (previous.syncSampledAt??previous.serverTime)===(next.syncSampledAt??next.serverTime));
}

/** Polls may update permissions/presence without replacing a newer live clock. */
export function roomPollUpdate(previous:Room|null,next:Room,liveFresh:boolean):{snapshot:Room;timeline:boolean}{
 const sameRoom=previous?.code===next.code;
 const keepTimeline=sameRoom && (isOlderSnapshot(previous,next) || isDuplicateSnapshot(previous,next) ||
  (liveFresh && previous.syncSource==='live' && (next.syncSource!=='live' || next.syncEpoch!==previous.syncEpoch)));
 if(!keepTimeline || !previous)return {snapshot:next,timeline:true};
 return {snapshot:{...previous,viewers:next.viewers,isHost:next.isHost,isOwner:next.isOwner??previous.isOwner,isPublic:next.isPublic??previous.isPublic},timeline:false};
}

export function transportChanged(previous:Room|null,next:Room){
 if(previous?.buffering || next.buffering) return Boolean(previous && previous.playing!==next.playing);
 if(!previous || previous.code!==next.code || previous.current?.id!==next.current?.id || next.version<=previous.version)return false;
 const predicted=previous.position+(previous.playing?elapsedPlayingMs(previous.serverTime,previous.startsAt,Math.max(0,next.serverTime-previous.serverTime))/1000:0);
 return previous.playing!==next.playing || Math.abs(next.position-predicted)>.5;
}
