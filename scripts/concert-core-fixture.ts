// Local Core integration with synthetic provider, audio sink and OAuth grant.
import assert from 'node:assert/strict';
import { Store } from '../services/core/src/store.ts';
import { Providers } from '../services/core/src/providers.ts';
import { Engine } from '../services/core/src/engine.ts';
import { Commands } from '../services/core/src/commands.ts';
import { Guilds, type GuildSession } from '../services/core/src/guilds.ts';
import { DiscordOAuth } from '../services/core/src/oauth.ts';
import { createServers } from '../services/core/src/server.ts';
import { liveRoom, readLiveState } from '../lib/live-room.ts';
import type { Track } from '../services/core/src/types.ts';
import type { Sink, PcmDecoder } from '../services/core/src/audio.ts';
import type { Route } from 'playwright';

export type CoreFixtureCommand = Record<string, unknown> & {action: string};
function record(value: unknown): Record<string, unknown> {
 assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected a Core fixture JSON object');
 return value as Record<string, unknown>;
}
function command(value: unknown): CoreFixtureCommand {
 const result = record(value);
 assert.equal(typeof result.action, 'string', 'Expected a command action');
 return {...result, action: String(result.action)};
}
function state(value: unknown) {
 const result = readLiveState(record(value).state);
 assert(result, 'Expected a valid Core live state');
 return result;
}

export async function concertCore() {
 const guildId = '123456789012345678', store = new Store(':memory:');
 let started = 0, elapsed = 0, running = false;
 const {promise: gate, resolve: release} = Promise.withResolvers<void>();
 const sink: Sink = { onIdle: null, onError: null,
  play() { elapsed = 0; started = Date.now(); running = true; },
  pause() { elapsed = this.duration(); running = false; },
  resume() { started = Date.now(); running = true; },
  stop() { elapsed = 0; running = false; },
  duration() { return elapsed + (running ? Date.now() - started : 0); },
  advancing() { return running; }, buffering() { return false; },
 };
 const providers = new Providers(store, {NODE_ENV:'test'}), engine = new Engine(store, providers, sink);
 const commands = new Commands(engine), guilds = new Guilds(guildId);
 const video: Track = {id:'seed1234567',entryId:'synthetic-entry',title:'Synthetic concert',artist:'Synthetic artist',image:'',duration:200,live:false,embeddable:true,source:'youtube'};
 providers.resolve = async () => [{...video}];
 engine.settings.radio = false;
 engine.ready = engine.connected = true;
 // The browser fixture never creates a decoder process. It supplies only the
 // frame and stop methods consumed by the mixer, at this explicit test boundary.
 const decoder: Pick<PcmDecoder, 'frame' | 'stop'> = {frame:async()=>null,stop(){}};
 engine.prepare = async track => { await gate; return {track,decoder:decoder as PcmDecoder}; };
 // HTTP admin state only asks the bot for this method; no Discord client is started.
 const bot = {privateState:()=>({})} as GuildSession['bot'];
 const session: GuildSession = {id:guildId,name:'Synthetic guild',roomCode:'TESTROOM',engine,commands,bot};
 guilds.register(session);
 const oauth = new DiscordOAuth('synthetic-key','synthetic-app','synthetic-secret','http://localhost',async()=>Response.json([{id:guildId,name:'Synthetic guild',permissions:'32'}]));
 const tokenCipher = oauth.seal({access:'synthetic-token',expiresAt:Date.now()+600000,user:{id:guildId,name:'Synthetic manager'}});
 const servers = await createServers(engine,commands,{key:'synthetic-key',origin:'http://localhost',hosts:['127.0.0.1'],passwordHash:'',privateState:()=>({}),guilds,oauth,publicPort:0,adminPort:false,host:'127.0.0.1'});
 const address = servers.publicServer.address();
 assert(address && typeof address === 'object');
 const base = 'http://127.0.0.1:'+address.port;
 const call = async (path: string, body?: Record<string, unknown>) => {
  const response = await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer synthetic-key','Content-Type':'application/json','X-Discord-Grant':tokenCipher},...(body?{body:JSON.stringify(body)}:{})});
  const result = await response.json(); assert.equal(response.status,200,JSON.stringify(result)); return record(result);
 };
 return {engine,video,release,room:()=>liveRoom(guilds.state(session)),
  addDiscord:()=>commands.add(video.id,'synthetic-discord-manager',{concert:true}),
  async route(route: Route, url: URL, requests: CoreFixtureCommand[], host: boolean) {
   const method=route.request().method(); let result: unknown;
   if(url.pathname==='/api/rooms/TESTROOM') result=method==='POST'?{ok:true}:liveRoom(state(await call('/v1/state?guildId='+guildId)));
   else if(url.pathname==='/api/search') result={videos:[video]};
   else if(url.pathname==='/api/discord/queue') result=await call('/v1/concert-queue',{guildId,action:'read',admin:host,...(host?{tokenCipher}:{})});
   else if(url.pathname==='/api/admin/control') {
    assert(host,'Guests must not send admin commands');
    if(method==='POST') {const input=record(route.request().postDataJSON());requests.push(command(input.command));result=await call('/v1/admin',{...input,tokenCipher});}
    else result=await call('/v1/admin?guildId='+guildId);
   } else if(url.pathname==='/api/discord') {
    if(method==='POST') {const input=command(route.request().postDataJSON());requests.push(input);result=await call('/v1/command',{...input,id:'public:'+input.commandId,scope:'public'});}
    else if(url.searchParams.has('command')) {const response=await call('/v1/jobs?id='+encodeURIComponent(url.searchParams.get('command') ?? '')+'&guildId='+guildId); result={...response,state:(await call('/v1/state?guildId='+guildId)).state};}
    else result=await call('/v1/state?guildId='+guildId);
   } else return false;
   await route.fulfill({contentType:'application/json',body:JSON.stringify(result)}); return true;
  },
  async verifyPermissions() {
   await assert.rejects(commands.execute({action:'seek',seconds:80},'public'),/administratortilgang/);
   await assert.rejects(commands.execute({action:'seek',seconds:80,queueRevision:'stale'},'admin'),/Køen er endret/);
  },
  async close() { release(); await servers.close(); commands.close();engine.close();store.close(); },
 };
}
