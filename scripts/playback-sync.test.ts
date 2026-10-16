import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canCorrectPlayback,isDuplicateSnapshot,isOlderSnapshot,roomPollUpdate,transportChanged,compensateDelivery,playbackTarget,shouldCorrect,readSyncMode,syncRecoveryMs,roomPollMs} from '../lib/playback-sync.ts';
import {acceptsLiveState,DISCORD_LIVE_LEASE_MS,liveRoom,readLiveState,type LiveState} from '../lib/live-room.ts';
import type {Room} from '../lib/types.ts';
const room: Room={version:1,viewers:1,isHost:true,expiresAt:999999,code:'DISCORD1',mode:'discord',name:'Discord',current:{id:'abcdefghijk',title:'Test',artist:'Test',image:'',embeddable:true,duration:200,live:false},queue:[],playing:true,position:50,serverTime:100000,syncValidForMs:10000};
test('accounts for return transit and local monotonic time without trusting browser clock',()=>{const next=compensateDelivery(room,400);assert.equal(next.position,50.2);assert.equal(next.syncValidForMs,9800);assert.equal(playbackTarget(next,1000,3000).position,52.2);});
test('paused snapshots never advance even after transport delay',()=>{const next=compensateDelivery({...room,playing:false},500);assert.equal(playbackTarget(next,1000,6000).position,50);assert.equal(playbackTarget(next,1000,6000).playing,false);});
test('stale bot state freezes the video instead of inventing minutes of playback',()=>{const target=playbackTarget(room,1000,40000);assert.equal(target.position,60);assert.equal(target.playing,false);assert.equal(target.stale,true);});
test('normal rooms keep advancing and positions stay within the video',()=>{assert.equal(playbackTarget({...room,mode:undefined},1000,210000).position,199.9);});
test('local offset affects only Discord video and clamps below zero',()=>{assert.equal(playbackTarget(room,1000,1000,-1.3).position,48.7);assert.equal(playbackTarget({...room,mode:undefined},1000,1000,-1.3).position,50);assert.equal(playbackTarget({...room,position:1},1000,1000,-5).position,0);});
test('stable mode tolerates jitter and spaces automatic corrections',()=>{const correct=(a: number,b: number,c: number,d: number)=>shouldCorrect(a,b,c,d,false,'stable');assert.equal(correct(50,49.7,9000,0),false);assert.equal(correct(50,48.6,9000,0),false);assert.equal(correct(50,48,5000,0),false);assert.equal(correct(50,48,6000,0),true);});
test('precise mode remains available without changing manual correction',()=>{assert.equal(shouldCorrect(50,49,3000,0,false,'precise'),true);assert.equal(shouldCorrect(50,49,2999,0,false,'precise'),false);assert.equal(shouldCorrect(50,49.7,200,0,true),true);assert.equal(shouldCorrect(50,NaN,200,0,true),false);});
test('buffering never triggers seeks, including manual synchronization',()=>{assert.equal(canCorrectPlayback(3,true,10000,0),false);assert.equal(canCorrectPlayback(3,true,10000,0,true),false);});
test('recovery gets a settling period but host pause and manual sync are immediate',()=>{assert.equal(canCorrectPlayback(1,true,1000,5000),false);assert.equal(canCorrectPlayback(1,true,5000,5000),true);assert.equal(canCorrectPlayback(2,false,1000,5000),true);assert.equal(canCorrectPlayback(1,true,1000,5000,true),true);});

test('precise sync is the default while an explicit stable choice is retained',()=>{assert.equal(readSyncMode(null),'precise');assert.equal(readSyncMode('invalid'),'precise');assert.equal(readSyncMode('precise'),'precise');assert.equal(readSyncMode('stable'),'stable');assert.equal(shouldCorrect(50,49,3000,0),true);});
test('precise recovery is quicker without eliminating the buffering guard',()=>{assert.equal(syncRecoveryMs('precise'),2000);assert.equal(syncRecoveryMs('stable'),4000);assert.equal(canCorrectPlayback(1,true,1000,syncRecoveryMs('precise')),false);assert.equal(canCorrectPlayback(3,true,2000,syncRecoveryMs('precise')),false);});
test('visible rooms update every second and hidden rooms conserve requests',()=>{assert.equal(roomPollMs(false),1000);assert.equal(roomPollMs(true),4000);});

test('same-revision delayed snapshots cannot rewind a running timeline',()=>{
 const a: Room={...room,version:4,syncEpoch:'test',syncSource:'live'};
 assert.equal(isOlderSnapshot(a,{...a,serverTime:a.serverTime-500,position:49.5}),true);
 assert.equal(isOlderSnapshot(a,{...a,version:3,serverTime:a.serverTime+500}),true);
 assert.equal(isOlderSnapshot(a,{...a,version:5,position:10}),false);
 assert.equal(isOlderSnapshot(a,{...a,syncEpoch:'restart',version:1}),false);
});
test('explicit room seeks apply immediately but metadata changes do not',()=>{
 const a={...room,version:4};
 assert.equal(transportChanged(a,{...a,version:5,serverTime:101000,position:51}),false);
 assert.equal(transportChanged(a,{...a,version:5,serverTime:101000,position:80}),true);
 assert.equal(transportChanged(a,{...a,version:5,playing:false}),true);
});
test('subsecond iframe reporting jitter does not cause a hard seek',()=>{
 for(const jitter of [-.3,-.2,0,.2,.3]) assert.equal(shouldCorrect(50,50+jitter,9000,0),false);
 assert.equal(shouldCorrect(50,49,9000,0),true);
});

test('buffering freezes the authoritative position without turning it into a pause',()=>{
 const buffered: Room={...room,buffering:true,position:20,serverTime:1000,syncValidForMs:7000};
 const target=playbackTarget(buffered,1000,2000);assert.equal(target.position,20);assert.equal(target.playing,true);
 assert.equal(playbackTarget({...buffered,playing:false},1000,2000).playing,false);
});

test('network jitter cannot reorder source snapshots after presentation-time compensation',()=>{
 const source={...room,syncSource:'live' as const,syncEpoch:'core'};
 const slow=compensateDelivery(source,2000);
 const fast=compensateDelivery({...source,serverTime:source.serverTime+200,position:source.position+.2},20);
 assert(slow.serverTime>fast.serverTime);
 assert.equal(isOlderSnapshot(slow,fast),false);
 assert.equal(isOlderSnapshot(fast,slow),true);
 assert.equal(slow.syncSampledAt,source.serverTime);
 assert.equal(source.position,50);
});

test('a delayed fallback poll preserves live playback while updating authority and presence',()=>{
 const current={...room,version:8,position:90,syncSource:'live' as const,syncEpoch:'core'};
 const delayed={...room,version:9,syncSource:'bridge' as const,syncEpoch:'bridge',viewers:4,isHost:false,isPublic:true};
 const update=roomPollUpdate(current,delayed,true);
 assert.equal(update.timeline,false);
 assert.equal(update.snapshot.position,90);
 assert.equal(update.snapshot.version,8);
 assert.equal(update.snapshot.serverTime,current.serverTime);
 assert.equal(update.snapshot.syncValidForMs,current.syncValidForMs);
 assert.equal(update.snapshot.viewers,4);
 assert.equal(update.snapshot.isHost,false);
 assert.equal(update.snapshot.isPublic,true);
 assert.equal(roomPollUpdate(current,delayed,false).timeline,true);
});

test('duplicate samples cannot renew a lease through a poll or transit re-estimate',()=>{
 const source={...room,syncSource:'live' as const,syncEpoch:'core'};
 const original=compensateDelivery(source,200);
 const duplicate=compensateDelivery(source,1000);
 assert.equal(isDuplicateSnapshot(original,duplicate),true);
 const update=roomPollUpdate(original,duplicate,false);
 assert.equal(update.timeline,false);
 assert.equal(update.snapshot.position,original.position);
 assert.equal(update.snapshot.serverTime,original.serverTime);
 assert.equal(update.snapshot.syncValidForMs,original.syncValidForMs);
});

test('a live stream restart accepts new epoch revisions while late old-epoch polls wait for fallback',()=>{
 const old={...room,syncSource:'live' as const,syncEpoch:'old',version:50};
 const restarted={...old,syncEpoch:'new',version:1,serverTime:1};
 assert.equal(isOlderSnapshot(old,restarted),false);
 assert.equal(roomPollUpdate(restarted,old,true).timeline,false);
 assert.equal(roomPollUpdate(restarted,old,false).timeline,true);
});

const live:LiveState={engine:'gutta-krutt-core',epoch:'test-core',sequence:5,serverTime:100000,buffering:false,playbackKey:'core:test',guildId:'111111111111111111',roomCode:'DISCORD1',ready:true,connected:true,playing:true,position:50,volume:60,current:room.current,queue:[],queueRevision:'test-revision',lastSeen:100000,online:true};

test('Discord delivery age advances position and reference time together without mutating its raw sample',()=>{
 const delivered=liveRoom(live,2000);
 assert.equal(delivered.position,52);
 assert.equal(delivered.serverTime,102000);
 assert.equal(delivered.syncSampledAt,100000);
 assert.equal(delivered.syncValidForMs,5000);
 assert.equal(live.position,50);
 assert.equal(live.serverTime,100000);
 const next=liveRoom({...live,sequence:6,serverTime:103000,position:53},200);
 assert.equal(transportChanged(delivered,next),false);
 assert.equal(playbackTarget(delivered,1000,6000).stale,true);
 const expired=liveRoom(live,9000);
 assert.equal(expired.syncValidForMs,0);
 assert.equal(playbackTarget(expired,1000,1000).stale,true);
 assert.equal(expired.position,50+DISCORD_LIVE_LEASE_MS/1000);
 assert.equal(liveRoom({...live,buffering:true},2000).position,50);
});

test('Discord frame ordering uses revisions and scope and rejects duplicate heartbeats',()=>{
 assert.equal(acceptsLiveState(live,{...live,sequence:4,serverTime:101000},live.guildId),false);
 assert.equal(acceptsLiveState(live,{...live,serverTime:99000},live.guildId),false);
 assert.equal(acceptsLiveState(live,live,live.guildId),false);
 assert.equal(acceptsLiveState(live,{...live,serverTime:101000},live.guildId),true);
 assert.equal(acceptsLiveState(live,{...live,sequence:6,position:5},live.guildId),true);
 assert.equal(acceptsLiveState(live,{...live,epoch:'restart',sequence:0,serverTime:1},live.guildId),true);
 assert.equal(acceptsLiveState(null,live,'222222222222222222'),false);
 assert.equal(acceptsLiveState(live,{...live,guildId:undefined},live.guildId),false);
});

test('Discord live boundary rejects invalid buffering, timestamps, identities and media',()=>{
 assert.equal(readLiveState(live),live);
 for(const value of [{...live,buffering:undefined},{...live,serverTime:NaN},{...live,sequence:Number.MAX_SAFE_INTEGER+1},{...live,epoch:''},{...live,guildId:'another-server'},{...live,roomCode:'../other'},{...live,current:undefined},{...live,current:{...live.current,live:undefined}}]){
  assert.equal(readLiveState(value),null);
 }
});

test('scheduled starts remain stationary during transit before the agreed time',()=>{
 const scheduled=compensateDelivery({...room,serverTime:1000,startsAt:2500},1000);
 assert.equal(scheduled.position,50);
 assert.equal(playbackTarget(scheduled,1000,1500).position,50);
 assert.equal(playbackTarget(scheduled,1000,1500).playing,false);
 assert.equal(playbackTarget(scheduled,1000,2500).position,50.5);
});
