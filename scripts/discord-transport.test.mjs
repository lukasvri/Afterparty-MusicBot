// Integration test using simulated bridge snapshots in the local database only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const base=process.env.MUSE_TEST_URL??'http://127.0.0.1:5173';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname),'This test must never target the live bot');
const values=Object.fromEntries(readFileSync('.dev.vars','utf8').split('\n').filter(line=>line.includes('=')).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));
const headers={'Content-Type':'application/json','X-Muse-Visitor':randomUUID()};
async function request(path,body,extra={}){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...headers,...extra},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});return {status:response.status,data:await response.json()};}
const original=(await request('/api/discord')).data.state;
const state={ready:true,connected:true,playing:true,position:40,volume:60,playbackKey:'core:local-fixture',current:{id:'M7lc1UVf-VE',title:'Local transport fixture',artist:'Test',image:'',duration:1344,live:false,embeddable:true,concert:true},queue:[],queueRevision:'local-transport-test'};
const bridge=(results=[])=>request('/api/bridge',{state,sampledAt:Date.now(),events:[],results},{Authorization:`Bearer ${values.ADMIN_BRIDGE_KEY}`});
try{
 assert.equal((await bridge()).status,200);
 const commandId=randomUUID();const pause=await request('/api/discord',{action:'pause',playbackKey:state.playbackKey,commandId});assert.equal(pause.status,200);assert.equal(pause.data.status,'pending');
 assert.equal((await request('/api/discord',{action:'pause',playbackKey:state.playbackKey,commandId})).data.id,pause.data.id);
 const claimed=(await bridge()).data.commands;assert.equal(claimed.filter(c=>c.id===pause.data.id).length,1);assert.equal(claimed.find(c=>c.id===pause.data.id).action,'pause');
 state.playing=false;await bridge([{id:pause.data.id,ok:true,message:'Local fixture paused'}]);assert.equal((await request(`/api/discord?command=${pause.data.id}`)).data.command.status,'done');assert.equal((await request('/api/rooms/DISCORD1')).data.playing,false);
 const resume=await request('/api/discord',{action:'resume',playbackKey:state.playbackKey,commandId:randomUUID()});assert.equal(resume.status,200);assert.equal((await bridge()).data.commands.find(c=>c.id===resume.data.id).action,'resume');
 state.playing=true;await bridge([{id:resume.data.id,ok:true,message:'Local fixture resumed'}]);assert.equal((await request('/api/rooms/DISCORD1')).data.playing,true);
 const noop=await request('/api/discord',{action:'resume',playbackKey:state.playbackKey,commandId:randomUUID()});assert.equal(noop.data.status,'done');assert.equal((await bridge()).data.commands.some(c=>c.id===noop.data.id),false);
 assert.equal((await request('/api/discord',{action:'stop',commandId:randomUUID()})).status,403);
 console.log('PASS local shared pause, resume, bridge acknowledgement, duplicate IDs, idempotent resume and restricted commands');
}finally{
 Object.assign(state,original??{ready:false,connected:false,playing:false,position:0,current:null,queue:[]});await bridge();
 console.log('Local bridge snapshot restored. Real Discord playback was not touched.');
}
