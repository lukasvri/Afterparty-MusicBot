// Integration test using simulated bridge snapshots in the local database only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
type BridgeResult = {id: string; ok: boolean; message: string};
function record(value: unknown): Record<string, unknown> {
 assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected a local API JSON object');
 return value as Record<string, unknown>;
}
function receiptId(value: Record<string, unknown>): string {
 assert(typeof value.id === 'string', 'Expected a command receipt ID');
 return value.id;
}
function commands(value: unknown) {
 assert(Array.isArray(value), 'Expected a bridge command list');
 return value.map((item: unknown) => {
  const job = record(item);
  assert(typeof job.id === 'string' && typeof job.action === 'string', 'Expected a bridge job with ID and action');
  return {...job, id: job.id, action: job.action};
 });
}
const base=process.env.AFTERPARTY_TEST_URL??process.env.MUSE_TEST_URL??'http://127.0.0.1:5173';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname),'This test must never target the live bot');
const values=Object.fromEntries(readFileSync('.dev.vars','utf8').split('\n').filter(line=>line.includes('=')).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));
const headers={'Content-Type':'application/json','X-Afterparty-Visitor':randomUUID()};
async function request(path: string,body?: Record<string, unknown>,extra: Record<string, string>={}){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...headers,...extra},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});return {status:response.status,data:record(await response.json())};}
const originalValue=(await request('/api/discord')).data.state;
const original=originalValue == null ? null : record(originalValue);
const state={ready:true,connected:true,playing:true,position:40,volume:60,playbackKey:'core:local-fixture',current:{id:'M7lc1UVf-VE',title:'Local transport fixture',artist:'Test',image:'',duration:1344,live:false,embeddable:true,concert:true},queue:[],queueRevision:'local-transport-test'};
const bridge=(results: BridgeResult[]=[])=>request('/api/bridge',{state,sampledAt:Date.now(),events:[],results},{Authorization:`Bearer ${values.ADMIN_BRIDGE_KEY}`});
try{
 assert.equal((await bridge()).status,200);
 const commandId=randomUUID();const pause=await request('/api/discord',{action:'pause',playbackKey:state.playbackKey,commandId});assert.equal(pause.status,200);assert.equal(pause.data.status,'pending');const pauseId=receiptId(pause.data);
 assert.equal((await request('/api/discord',{action:'pause',playbackKey:state.playbackKey,commandId})).data.id,pauseId);
 const claimed=commands((await bridge()).data.commands);assert.equal(claimed.filter(c=>c.id===pauseId).length,1);assert.equal(claimed.find(c=>c.id===pauseId)?.action,'pause');
 state.playing=false;await bridge([{id:pauseId,ok:true,message:'Local fixture paused'}]);assert.equal(record((await request(`/api/discord?command=${pauseId}`)).data.command).status,'done');assert.equal((await request('/api/rooms/DISCORD1')).data.playing,false);
 const resume=await request('/api/discord',{action:'resume',playbackKey:state.playbackKey,commandId:randomUUID()});assert.equal(resume.status,200);const resumeId=receiptId(resume.data);assert.equal(commands((await bridge()).data.commands).find(c=>c.id===resumeId)?.action,'resume');
 state.playing=true;await bridge([{id:resumeId,ok:true,message:'Local fixture resumed'}]);assert.equal((await request('/api/rooms/DISCORD1')).data.playing,true);
 const noop=await request('/api/discord',{action:'resume',playbackKey:state.playbackKey,commandId:randomUUID()});assert.equal(noop.data.status,'done');const noopId=receiptId(noop.data);assert.equal(commands((await bridge()).data.commands).some(c=>c.id===noopId),false);
 assert.equal((await request('/api/discord',{action:'stop',commandId:randomUUID()})).status,403);
 console.log('PASS local shared pause, resume, bridge acknowledgement, duplicate IDs, idempotent resume and restricted commands');
}finally{
 Object.assign(state,original??{ready:false,connected:false,playing:false,position:0,current:null,queue:[]});await bridge();
 console.log('Local bridge snapshot restored. Real Discord playback was not touched.');
}
