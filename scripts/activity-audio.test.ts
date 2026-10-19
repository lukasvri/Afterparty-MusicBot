import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectActivityOutput,applyOutputAudio,acceptsPlayerAudio} from '../lib/activity-audio.ts';
test('Activity requires an explicit local-bot mute confirmation before enabling its audio',()=>{
 assert.equal(selectActivityOutput('activity',false),'choose');assert.equal(selectActivityOutput('activity',true),'activity');
 assert.equal(selectActivityOutput('voice',true),'voice');
 const calls:unknown[]=[];const player={mute:()=>calls.push('mute'),unMute:()=>calls.push('unmute'),setVolume:(value:number)=>calls.push(value)};
 const preferences={level:60,muted:false,lastAudible:60};
 for(const output of ['choose','voice'] as const){calls.length=0;applyOutputAudio(player,preferences,output);assert.deepEqual(calls,['mute']);assert.equal(acceptsPlayerAudio(output),false);}
 for(const output of ['activity','site'] as const){calls.length=0;applyOutputAudio(player,preferences,output);assert.deepEqual(calls,[60,'unmute']);assert.equal(acceptsPlayerAudio(output),true);}
 calls.length=0;applyOutputAudio(player,{...preferences,muted:true},'activity');assert.deepEqual(calls,[60,'mute']);
 assert.deepEqual(preferences,{level:60,muted:false,lastAudible:60},'Output policy cannot overwrite stored preferences');
});
