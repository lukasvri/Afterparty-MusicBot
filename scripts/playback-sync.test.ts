import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canCorrectPlayback,isOlderSnapshot,transportChanged,compensateDelivery,playbackTarget,shouldCorrect,readSyncMode,syncRecoveryMs,roomPollMs} from '../lib/playback-sync.ts';
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
