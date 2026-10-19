import type {AddressInfo} from 'node:net';
import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {Guilds} from '../src/guilds.ts';import {DiscordOAuth,canManageGuild} from '../src/oauth.ts';import {Store} from '../src/store.ts';import {Engine} from '../src/engine.ts';import {Commands} from '../src/commands.ts';import {Providers} from '../src/providers.ts';import {createServers} from '../src/server.ts';import type {Sink} from '../src/audio.ts';
const A='100000000000000001',B='100000000000000002';
test('Discord permissions and sealed grants reject missing rights, tampering and expired sessions',async()=>{
 assert(canManageGuild({permissions:'32'}));assert(canManageGuild({permissions:'8'}));assert(canManageGuild({owner:true}));assert(!canManageGuild({permissions:'16'}));assert(!canManageGuild({permissions:'broken'}));
 const oauth=new DiscordOAuth('key','app','secret','https://site.example',async()=>Response.json([{id:A,name:'A',permissions:'32'},{id:B,name:'B',permissions:'16'}]));
 const grant=oauth.seal({access:'token',expiresAt:Date.now()+60000,user:{id:A,name:'User'}});assert.equal((await oauth.require(grant,A)).id,A);await assert.rejects(oauth.require(grant,B),/do not have administrator access/);assert.throws(()=>oauth.open(grant.slice(0,-5)+'wrong'),/expired/);assert.throws(()=>oauth.open(oauth.seal({access:'token',expiresAt:0,user:{id:A,name:'User'}})),/expired/);
});
test('guilds isolate state, queue, settings, favorites, commands and streams with only the supported Core listener',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gutta-guild-')),guilds=new Guilds(A);const resources: Array<{store:Store;engine:Engine;commands:Commands}>=[];
 for(const id of [A,B]){const store=new Store(join(dir,id,'db.sqlite'));const sink:Sink={onIdle:null,onError:null,play(){},pause(){},resume(){},stop(){},duration:()=>0,advancing:()=>false,buffering:()=>false};const engine=new Engine(store,new Providers(store,{}),sink),commands=new Commands(engine);engine.ready=true;engine.connected=true;engine.current={id:'abcdefghijk',entryId:id,title:'Song '+id,artist:'Artist',image:'',duration:100,live:false,embeddable:true,concert:true};resources.push({store,engine,commands});guilds.register({id,name:id,roomCode:guilds.roomCode(id),engine,commands,bot:{privateState:()=>({settings:engine.settings})} as never});}
 const [one,two]=resources;one.engine.setSettings({radio:false});one.store.favorite('person','favorite','query');assert(two.engine.settings.radio);assert.equal(two.store.favorites().length,0);one.engine.enqueue([{...one.engine.current!,id:'bcdefghijkl',entryId:randomUUID()}]);assert.equal(two.engine.queue.length,0);
 const oauth=new DiscordOAuth('key','app','secret','https://site.example',async()=>Response.json([{id:A,name:'A',permissions:'32'}]));const grant=oauth.seal({access:'token',expiresAt:Date.now()+60000,user:{id:A,name:'User'}});
 const server=await createServers(one.engine,one.commands,{key:'key',origin:'https://site.example',guilds,oauth,publicPort:0,host:'127.0.0.1'});const base='http://127.0.0.1:'+(server.publicServer.address() as AddressInfo).port;
 try{
  assert.equal('adminServer' in server,false);const header={Authorization:'Bearer key','Content-Type':'application/json'};
  const state=await fetch(base+'/v1/state?guildId='+B).then(r=>r.json()) as {state:{guildId:string;current:{title:string};queue:unknown[]}};assert.equal(state.state.guildId,B);assert.equal(state.state.current.title,'Song '+B);assert.equal(state.state.queue.length,0);
  assert.equal((await fetch(base+'/v1/admin?guildId='+B,{headers:header})).status,403);
  assert.equal((await fetch(base+'/v1/admin?guildId='+B,{headers:{...header,'X-Discord-Grant':grant}})).status,403);
  const id='public:'+randomUUID(),input={id,scope:'public',guildId:B,action:'pause',playbackKey:'core:'+B};
  const invoke=()=>fetch(base+'/v1/command',{method:'POST',headers:header,body:JSON.stringify(input)});await invoke();await invoke();assert(two.engine.paused);assert(!one.engine.paused);assert.equal(two.store.jobs().length,1);assert.equal(one.store.jobs().length,0);
  const stream=await fetch(base+'/events?guildId='+B,{headers:{Origin:'https://site.example'}}),reader=stream.body!.getReader();const frame=Buffer.from((await reader.read()).value!).toString();assert(frame.includes(B));assert(!frame.includes('Song '+A));await reader.cancel();
  const settings=await fetch(base+'/v1/admin',{method:'POST',headers:header,body:JSON.stringify({guildId:A,tokenCipher:grant,operation:'settings',settings:{defaultVolume:50}})});assert.equal(settings.status,200);assert.equal(one.engine.settings.defaultVolume,50);assert.equal(two.engine.settings.defaultVolume,100);
  const queueCall=(input:Record<string,unknown>,authorized=true)=>fetch(base+'/v1/concert-queue',{method:'POST',headers:authorized?header:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await queueCall({guildId:A,action:'read'},false)).status,403);
  assert.equal((await queueCall({guildId:B,action:'clear',admin:true,tokenCipher:grant,revision:two.commands.concertQueue.revision()})).status,403);
  assert.equal((await queueCall({guildId:B,action:'clear',admin:true,revision:two.commands.concertQueue.revision()})).status,403);
  assert.equal((await queueCall({guildId:A,action:'clear',isHost:true,revision:one.commands.concertQueue.revision()})).status,403);
  const allowed=await queueCall({guildId:A,action:'approval',admin:true,tokenCipher:grant,enabled:true,revision:one.commands.concertQueue.revision()});assert.equal(allowed.status,200);assert(one.commands.concertQueue.read().approvalRequired);assert(!two.commands.concertQueue.read().approvalRequired);
  assert.throws(()=>guilds.get('999953157932843050'),/has not been added/);assert.notEqual(guilds.roomCode(A),guilds.roomCode(B));
 }finally{await server.close();for(const r of resources){r.commands.close();r.engine.close();r.store.close();}rmSync(dir,{recursive:true,force:true});}
});
