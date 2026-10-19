import type {RoomTimeline} from '../src/protocol.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHmac,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import WebSocket from 'ws';
import {Store} from '../src/store.ts';
import {Providers} from '../src/providers.ts';
import {Engine} from '../src/engine.ts';
import {Commands} from '../src/commands.ts';
import {createServers} from '../src/server.ts';
import type {Sink} from '../src/audio.ts';
test('malformed WebSocket upgrade targets cannot crash Core before origin validation',()=>{
 // A child isolates an uncaught upgrade-listener exception from the test runner.
 const source=new URL('../src/',import.meta.url).href;
 const probe=spawnSync(process.execPath,['--input-type=module','--eval',`
  import assert from 'node:assert/strict';
  import net from 'node:net';
  import {once} from 'node:events';
  import WebSocket from ${JSON.stringify(import.meta.resolve('ws'))};
  import {Store} from ${JSON.stringify(source+'store.ts')};
  import {Providers} from ${JSON.stringify(source+'providers.ts')};
  import {Engine} from ${JSON.stringify(source+'engine.ts')};
  import {Commands} from ${JSON.stringify(source+'commands.ts')};
  import {createServers} from ${JSON.stringify(source+'server.ts')};
  const store=new Store(':memory:');
  const sink={onIdle:null,onError:null,play(){},pause(){},resume(){},stop(){},duration:()=>0,advancing:()=>false,buffering:()=>false};
  const engine=new Engine(store,new Providers(store,{}),sink),commands=new Commands(engine);
  const servers=await createServers(engine,commands,{key:'synthetic-key',origin:'https://site.example',passwordHash:'',hosts:[],publicPort:0,adminPort:false,host:'127.0.0.1',privateState:()=>({private:true})});
  const port=servers.publicServer.address().port;
  try {
   for(const origin of ['https://site.example','https://other.example']) {
    const response=await new Promise((resolve,reject)=>{
     const socket=net.connect(port,'127.0.0.1');let received='';
     socket.setTimeout(3000,()=>socket.destroy(new Error('Upgrade rejection timed out')));
     socket.on('error',reject);socket.on('data',chunk=>received+=chunk);socket.on('close',()=>resolve(received));
     socket.on('connect',()=>socket.write('GET //[ HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nOrigin: '+origin+'\\r\\n\\r\\n'));
    });
    assert(response.startsWith('HTTP/1.1 400 '));
   }
   assert.equal((await fetch('http://127.0.0.1:'+port+'/v1/jobs')).status,403);
   const ws=new WebSocket('ws://127.0.0.1:'+port+'/live',{origin:'https://site.example'});
   try {
    const [message]=await once(ws,'message');assert.equal(JSON.parse(String(message)).type,'state');
   } finally {ws.terminate();await once(ws,'close');}
  } finally {await servers.close();commands.close();engine.close();store.close();}
 `],{encoding:'utf8',timeout:15000});
 assert.equal(probe.status,0,probe.stderr||String(probe.error??'Probe failed'));
});
test('public transport is read only, admin stays private, commands are acknowledged once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gutta-api-')),store=new Store(join(dir,'db.sqlite'));
 const sink:Sink={onIdle:null,onError:null,play(){},pause(){},resume(){},stop(){},duration:()=>0,advancing:()=>false,buffering:()=>false};
 const engine=new Engine(store,new Providers(store,{}),sink),commands=new Commands(engine);engine.connected=true;engine.ready=true;engine.current={id:'abcdefghijk',entryId:'entry',title:'Song',artist:'Artist',image:'',duration:100,live:false,embeddable:true,concert:true,requestedBy:'private-id'};
 const servers=await createServers(engine,commands,{key:'test-key',origin:'https://site.example',passwordHash:'',hosts:['127.0.0.1'],publicPort:0,adminPort:0,host:'127.0.0.1',privateState:()=>({private:true})});
 const publicPort=(servers.publicServer.address() as {port:number}).port,adminPort=(servers.adminServer.address() as {port:number}).port,base=`http://127.0.0.1:${publicPort}`;
 try{
  assert.equal((await fetch(base+'/v1/jobs?diagnostics=1')).status,403);const diagnostics=await fetch(base+'/v1/jobs?diagnostics=1',{headers:{Authorization:'Bearer test-key'}});assert.equal(diagnostics.status,200);assert.equal((await diagnostics.json() as {clients:number}).clients,0);
  assert.equal((await fetch(base+'/api/state')).status,404);assert.equal((await fetch(`http://127.0.0.1:${adminPort}/api/state`)).status,401);
  const input={id:'public:'+randomUUID(),scope:'public',action:'pause',playbackKey:'core:entry'};
  assert.equal((await fetch(base+'/v1/command',{method:'POST',body:JSON.stringify(input)})).status,403);
  const request=()=>fetch(base+'/v1/command',{method:'POST',headers:{Authorization:'Bearer test-key','Content-Type':'application/json'},body:JSON.stringify(input)}).then(r=>r.json()) as Promise<{id:string}>;
  const first=await request(),again=await request();assert.equal(first.id,again.id);assert.equal(store.jobs().length,1);assert.equal(engine.paused,true);
  const blocked=await fetch(base+'/v1/command',{method:'POST',headers:{Authorization:'Bearer test-key'},body:JSON.stringify({id:'public:'+randomUUID(),scope:'public',action:'stop'})});assert.equal(blocked.status,403);
  const claims={id:'public:'+randomUUID(),scope:'public',action:'resume',playbackKey:'core:entry',aud:'gutta-krutt-core',exp:Date.now()+30000};const encoded=Buffer.from(JSON.stringify(claims)).toString('base64url'),ticket=encoded+'.'+createHmac('sha256','test-key').update(encoded).digest('base64url');const signed=()=>fetch(base+'/v1/ticket',{method:'POST',headers:{Origin:'https://site.example','Content-Type':'application/json'},body:JSON.stringify({ticket})});const executed=await signed();assert.equal(executed.status,200);assert.equal(executed.headers.get('access-control-allow-origin'),'https://site.example');assert.equal((await executed.json() as {command:{status:string}}).command.status,'done');await signed();assert.equal(store.jobs().length,2);assert.equal((await fetch(base+'/v1/ticket',{method:'POST',headers:{Origin:'https://evil.example'},body:JSON.stringify({ticket})})).status,403);
  const callRoom=(input:unknown,authorized=true)=>fetch(base+'/v1/rooms',{method:'POST',headers:authorized?{Authorization:'Bearer test-key','Content-Type':'application/json'}:{},body:JSON.stringify(input)});
  assert.equal((await callRoom({operation:'read',code:'TESTROOM'},false)).status,403);
  const demo={id:'M7lc1UVf-VE',title:'Room video',artist:'Artist',image:'',duration:100,live:false,embeddable:true};
  await callRoom({operation:'import',code:'TESTROOM',name:'Room',owner_hash:'a'.repeat(64),state:{current:demo,queue:[],playing:false,position:0},version:1,updated_at:Date.now(),expires_at:Date.now()+60000});
  const streams=await Promise.all([1,2].map(()=>fetch(base+'/events?room=TESTROOM',{headers:{Origin:'https://site.example'}})));const readers=streams.map(r=>r.body!.getReader());for(const reader of readers){const frame=await reader.read();const raw=Buffer.from(frame.value!).toString();assert(raw.includes('"type":"room"'));assert(!raw.includes('ownerHash'));}
  const scheduled=await callRoom({operation:'mutate',code:'TESTROOM',action:'play',version:1,actorHash:'a'.repeat(64)});const same=(await scheduled.json() as {room:RoomTimeline}).room;assert(same.startsAt !== undefined && same.startsAt>same.serverTime);for(const reader of readers){const frame=await reader.read();const raw=Buffer.from(frame.value!).toString();assert(raw.includes('"version":2'));assert(raw.includes('"startsAt":'+same.startsAt));await reader.cancel();}
  const blockedStream=await fetch(base+'/events',{headers:{Origin:'https://evil.example'}});assert.equal(blockedStream.status,403);const liveStream=await fetch(base+'/events',{headers:{Origin:'https://site.example'}});assert.equal(liveStream.status,200);assert.equal(liveStream.headers.get('access-control-allow-origin'),'https://site.example');const reader=liveStream.body!.getReader();const firstFrame=await reader.read();assert(String(Buffer.from(firstFrame.value!)).includes('data: {'));assert(!String(Buffer.from(firstFrame.value!)).includes('private-id'));await reader.cancel();const clock=await fetch(base+'/v1/clock',{headers:{Origin:'https://site.example'}});assert.equal(clock.status,200);assert(Number.isFinite((await clock.json() as {serverTime:number}).serverTime));
  const ws=new WebSocket(`ws://127.0.0.1:${publicPort}/live`,{origin:'https://site.example'});const [message]=await once(ws,'message');const frame=JSON.parse(String(message));assert.equal(frame.type,'state');assert(!String(message).includes('private-id'));const pong=new Promise<[unknown]>((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',receive);reject(new Error('Timed out waiting for pong'));},3000);const receive=(raw:unknown)=>{if(JSON.parse(String(raw)).type==='pong'){clearTimeout(timer);ws.off('message',receive);resolve([raw]);}};ws.on('message',receive);});ws.send(JSON.stringify({type:'ping',sent:123}));const [raw]=await pong;assert.equal(JSON.parse(String(raw)).sent,123);const close=once(ws,'close');ws.close();await close;
  const wrong=new WebSocket(`ws://127.0.0.1:${publicPort}/live`,{origin:'https://evil.example'});await once(wrong,'error');if(wrong.readyState!==WebSocket.CLOSED)await once(wrong,'close');assert.equal(wrong.readyState,WebSocket.CLOSED);
 }finally{await servers.close();commands.close();engine.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('the authenticated own-room bridge advances radio without a Discord connection',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gutta-room-radio-api-')),store=new Store(join(dir,'db.sqlite'));
 const sink:Sink={onIdle:null,onError:null,play(){},pause(){},resume(){},stop(){},duration:()=>0,advancing:()=>false,buffering:()=>false};
 const providers=new Providers(store,{}),engine=new Engine(store,providers,sink),commands=new Commands(engine);
 const seed={id:'seed1234567',title:'Syn Cole - Feel Good | Future House | NCS - Copyright Free',artist:'NCS',image:'',duration:200,live:false,embeddable:true};
 let lookups=0;providers.search=async(query,count,musicOnly)=>{lookups++;assert(['future house audio -"Feel Good"','Syn Cole music audio'].includes(query));assert.equal(count,20);assert.equal(musicOnly,true);return [{...seed,id:'next1234567',title:'Other Artist - Synthetic next | Future House',entryId:'synthetic'}];};
 const servers=await createServers(engine,commands,{key:'synthetic-key',origin:'https://site.example',passwordHash:'',hosts:['127.0.0.1'],publicPort:0,adminPort:false,host:'127.0.0.1',privateState:()=>({})});
 const base=`http://127.0.0.1:${(servers.publicServer.address() as {port:number}).port}`;
 const request=(input:unknown)=>fetch(base+'/v1/rooms',{method:'POST',headers:{Authorization:'Bearer synthetic-key','Content-Type':'application/json'},body:JSON.stringify(input)});
 try{
  const imported=await request({operation:'import',code:'TESTROOM',name:'Synthetic room',owner_hash:'a'.repeat(64),state:{current:seed,queue:[],playing:true,position:199},version:1,updated_at:Date.now(),expires_at:Date.now()+60000});assert.equal(imported.status,200);
  const guest=await request({operation:'mutate',code:'TESTROOM',action:'next',version:1,actorHash:'b'.repeat(64)});assert.equal(guest.status,403);assert.equal(lookups,0);
  const response=await request({operation:'mutate',code:'TESTROOM',action:'next',version:1,actorHash:'a'.repeat(64)});assert.equal(response.status,200);
  const {room}=await response.json() as {room:RoomTimeline};assert.equal(room.current?.id,'next1234567');assert.equal(room.playing,true);assert.equal(room.version,2);assert.equal(lookups,2);
  assert.equal(engine.current,null);assert.equal(engine.connected,false);assert.equal(store.history(10).length,0);
 }finally{await servers.close();commands.close();engine.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
