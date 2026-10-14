import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptPlayerAudio,readAudioPreferences,toggleAudioMute,changeAudioLevel,applyAudioPreferences,defaultAudio} from '../lib/audio-preferences.ts';
test('mute preserves a chosen level and unmute restores it',()=>{
 const original=changeAudioLevel(defaultAudio,23);const muted=toggleAudioMute(original);
 assert.equal(muted.level,23);assert.equal(muted.muted,true);assert.deepEqual(toggleAudioMute(muted),original);
});
test('muted settings survive storage and reload',()=>{
 const original=toggleAudioMute(changeAudioLevel(defaultAudio,37));const reloaded=readAudioPreferences(JSON.stringify(original),'60');
 assert.deepEqual(reloaded,original);assert.equal(toggleAudioMute(reloaded).level,37);
});
test('moving the volume slider while muted enables the new level',()=>{
 const muted=toggleAudioMute(changeAudioLevel(defaultAudio,23));const changed=changeAudioLevel(muted,41);
 assert.equal(changed.level,41);assert.equal(changed.muted,false);assert.equal(changed.lastAudible,41);
});
test('zero remembers the previous audible level for unmute',()=>{
 const zero=changeAudioLevel(changeAudioLevel(defaultAudio,17),0);
 assert.equal(zero.muted,true);assert.equal(toggleAudioMute(zero).level,17);
});
test('previous storage format migrates without changing its audible level',()=>{
 assert.equal(readAudioPreferences(null,'72').level,72);assert.equal(readAudioPreferences(null,'0').muted,true);
});
test('malformed or invalid preferences use a safe valid fallback',()=>{
 assert.equal(readAudioPreferences('{broken','34').level,34);
 assert.deepEqual(readAudioPreferences('{"level":999,"muted":false}','oops'),defaultAudio);
 assert.equal(changeAudioLevel(defaultAudio,Infinity),defaultAudio);
 assert.equal(changeAudioLevel(defaultAudio,101).level,100);
});
test('player receives both remembered volume and mute state',()=>{
 const calls=[];const player={setVolume:n=>calls.push(['volume',n]),mute:()=>calls.push(['mute']),unMute:()=>calls.push(['unmute'])};
 const muted=toggleAudioMute(changeAudioLevel(defaultAudio,19));applyAudioPreferences(player,muted);applyAudioPreferences(player,toggleAudioMute(muted));
 assert.deepEqual(calls,[['volume',19],['mute'],['volume',19],['unmute']]);
});

test('native player volume and mute preserve device preferences',()=>{const value={level:23,muted:false,lastAudible:23};assert.equal(adoptPlayerAudio(value,23,false),value);assert.deepEqual(adoptPlayerAudio(value,23,true),{...value,muted:true});assert.deepEqual(adoptPlayerAudio(value,0,false),{level:0,muted:true,lastAudible:23});assert.deepEqual(adoptPlayerAudio(value,40,false),{level:40,muted:false,lastAudible:40});assert.equal(adoptPlayerAudio(value,NaN,false),value);});
