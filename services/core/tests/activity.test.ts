import { Catalog } from '../src/catalog.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiscordOAuth } from '../src/oauth.ts';
import { Guilds } from '../src/guilds.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { Commands } from '../src/commands.ts';
import { Providers } from '../src/providers.ts';
import { createServers } from '../src/server.ts';
import type { Sink } from '../src/audio.ts';
const A = '100000000000000001', B = '100000000000000002', APP = '100000000000000003', USER = '100000000000000004';
function provider(overrides: { scope?: string; guilds?: unknown; fail?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (overrides.fail) throw Error('sensitive upstream error');
    if (String(url).endsWith('/oauth2/token')) return Response.json({ access_token: 'synthetic-access', token_type: 'Bearer', expires_in: 3600, scope: overrides.scope ?? 'identify guilds' });
    if (String(url).endsWith('/users/@me')) return Response.json({ id: USER, username: 'Verified member' });
    return Response.json(overrides.guilds ?? [{ id: A, permissions: '0' }, { id: B, permissions: '32' }]);
  };
  return { calls, oauth: new DiscordOAuth('test-key', APP, 'synthetic-secret', 'https://site.example', request) };
}
test('Activity exchange verifies identity and membership, binds grant and keeps standalone redirect exchange intact', async () => {
  const { oauth, calls } = provider();
  const result = await oauth.exchangeActivity('activity-code', A);
  assert.equal(result.user.id, USER); assert.equal(result.canManage, false);
  assert.equal(result.accessToken, 'synthetic-access');
  assert.equal(oauth.open(result.tokenCipher).activityGuildId, A);
  const sent = new URLSearchParams(String(calls[0].init?.body));
  assert.equal(sent.has('redirect_uri'), false);
  assert.equal(sent.get('client_id'), APP);
  assert.ok(calls.every(c => c.init?.signal instanceof AbortSignal));
  await assert.rejects(oauth.member(result.tokenCipher, B), /another server/);
  await assert.rejects(oauth.require(result.tokenCipher, B), /administrator/);
  await assert.rejects(oauth.exchangeActivity('activity-code', A), /already used/);
  await oauth.exchange('standalone-code');
  const standalone = calls.find(c => String(c.init?.body).includes('standalone-code'))!;
  assert.equal(new URLSearchParams(String(standalone.init?.body)).get('redirect_uri'), 'https://site.example/api/auth/discord/callback');
});
test('Activity exchange rejects missing scopes, malformed payloads, absent membership and sanitized provider failure', async () => {
  await assert.rejects(provider({ scope: 'identify' }).oauth.exchangeActivity('code', A), /Invalid Activity grant/);
  await assert.rejects(provider({ guilds: [{ id: B }] }).oauth.exchangeActivity('code', A), /not a member/);
  await assert.rejects(provider({ guilds: {} }).oauth.exchangeActivity('code', A), /Invalid Activity membership/);
  await assert.rejects(provider({ fail: true }).oauth.exchangeActivity('code', A), error => error instanceof Error && !error.message.includes('sensitive') && /unavailable/.test(error.message));
  const { oauth, calls } = provider();
  for (const code of ['', 'x'.repeat(2049), 'bad\ncode', {}]) await assert.rejects(oauth.exchangeActivity(code, A), /Invalid Activity authorization/);
  assert.equal(calls.length, 0);
});
test('Activity HTTP is default off and requires exact configured installed guild, verified identity and bridge auth', async () => {
  const guilds = new Guilds(A), store = new Store(':memory:');
  const sink: Sink = { onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false };
  const engine = new Engine(store, new Providers(store, {}), sink), commands = new Commands(engine);
  clearInterval(engine.timer);
  guilds.register({ id: A, name: 'Test server', roomCode: 'DISCORD1', engine, commands, bot: {} as never });
  const { oauth, calls } = provider();
  const configs = [undefined, { enabled: true, clientId: APP, testGuildIds: [] }, { enabled: true, clientId: B, testGuildIds: [A] }, { enabled: true, clientId: APP, testGuildIds: [A, B] }];
  const before = engine.snapshot();
  try {
    for (const activity of configs) {
      const server = await createServers(engine, commands, { key: 'test-key', origin: 'https://site.example', oauth, guilds, activity, publicPort: 0, host: '127.0.0.1' });
      const base = 'http://127.0.0.1:' + (server.publicServer.address() as { port: number }).port;
      const post = (input: unknown, auth = true) => fetch(base + '/v1/activity', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer test-key' } : {}) }, body: JSON.stringify(input) });
      try {
        assert.equal((await post({ operation: 'config' }, false)).status, 403);
        const config = await (await post({ operation: 'config' })).json() as { enabled: boolean };
        if (activity !== configs[3]) {
          assert.equal(config.enabled, false);
          assert.equal((await post({ operation: 'exchange', code: 'code', guildId: A })).status, 503);
          continue;
        }
        assert.equal(config.enabled, true);
        assert.equal((await post({ operation: 'exchange', code: 'not-installed', guildId: B })).status, 404);
        assert.equal((await post({ operation: 'exchange', code: 'not-allowed', guildId: USER })).status, 403);
        assert.equal(calls.length, 0);
        const response = await post({ operation: 'exchange', code: 'verified-code', guildId: A, userId: B, host: true });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const result = await response.json() as { tokenCipher: string; user: { id: string }; guild: { id: string; roomCode: string }; canManage: boolean };
        assert.equal(result.user.id, USER); assert.equal(result.guild.id, A); assert.equal(result.guild.roomCode, 'DISCORD1'); assert.equal(result.canManage, false);
        assert.equal((await post({ operation: 'exchange', code: 'verified-code', guildId: A })).status, 409);
        const verified = await post({ operation: 'verify', guildId: A, tokenCipher: result.tokenCipher });
        assert.equal(verified.status, 200);
        assert.equal((await verified.json() as { canManage: boolean }).canManage, false);
        const standaloneGrant = oauth.seal({ access: 'synthetic-access', expiresAt: Date.now() + 60000, user: { id: USER, name: 'Member' } });
        assert.equal((await post({ operation: 'verify', guildId: A, tokenCipher: standaloneGrant })).status, 403);
      } finally { await server.close(); }
    }
    assert.deepEqual(engine.snapshot().queue, before.queue);
    assert.equal(engine.snapshot().queueRevision, before.queueRevision);
    assert.equal(engine.snapshot().playbackKey, before.playbackKey);
  } finally { commands.close(); engine.close(); store.close(); }
});

test('Activity verification rechecks current membership and rejects standalone or cross-guild grants', async () => {
  const data: { guilds: unknown } = { guilds: [{ id: A, permissions: '32' }] };
  const { oauth } = provider(data);
  const result = await oauth.exchangeActivity('verify-code', A);
  assert.equal((await oauth.verifyActivity(result.tokenCipher, A)).canManage, true);
  data.guilds = [{ id: A, permissions: '0' }];
  assert.equal((await oauth.verifyActivity(result.tokenCipher, A)).canManage, false);
  data.guilds = [{ id: B, permissions: '32' }];
  await assert.rejects(oauth.verifyActivity(result.tokenCipher, A), /not a member/);
  await assert.rejects(oauth.verifyActivity(result.tokenCipher, B), /another server/);
  const standalone = oauth.seal({ access: 'synthetic-access', expiresAt: Date.now() + 60000, user: { id: USER, name: 'Member' } });
  await assert.rejects(oauth.verifyActivity(standalone, A), /login flow/);
});

test('Activity HTTP owns a private room while the bot stays disconnected; forged sessions and departed participants fail closed',async()=>{
 const guilds=new Guilds(A),store=new Store(':memory:');
 const sink:Sink={onIdle:null,onError:null,play(){throw Error('Voice playback must not start');},pause(){},resume(){},stop(){},duration:()=>0,advancing:()=>false,buffering:()=>false};
 const engine=new Engine(store,new Providers(store,{}),sink),commands=new Commands(engine);clearInterval(engine.timer);
 const state={guilds:[{id:A,permissions:'32'}]};const {oauth}=provider(state);
 let present=true;let proofs=0;
 const bot={async verifyActivityInstance(context:{guildId:string;channelId:string;instanceId:string},userId:string){proofs++;assert.equal(context.guildId,A);assert.equal(userId,USER);if(!present||context.channelId!==B||context.instanceId!=='i-synthetic')throw Object.assign(Error('Session left'),{status:403});}};
 guilds.register({id:A,name:'Test',roomCode:'DISCORD1',engine,commands,bot:bot as never});
 const catalog=new Catalog(store,{},()=>({search:async()=>[],video:async ids=>ids.map(id=>({id,title:'Verified',artist:'YouTube',image:'',duration:10,live:false,embeddable:true,source:'youtube',entryId:crypto.randomUUID()}))}));
 const server=await createServers(engine,commands,{catalog,key:'test-key',origin:'https://site.example',guilds,oauth,activity:{enabled:true,clientId:APP,testGuildIds:[A]},host:'127.0.0.1',publicPort:0});
 const base='http://127.0.0.1:'+(server.publicServer.address() as {port:number}).port;
 const post=(input:unknown,path='/v1/activity')=>fetch(base+path,{method:'POST',headers:{Authorization:'Bearer test-key','Content-Type':'application/json'},body:JSON.stringify(input)});
 try{
  const initial=await oauth.exchangeActivity('private-playback',A);
  const joined=await post({operation:'join',guildId:A,tokenCipher:initial.tokenCipher,channelId:B,instanceId:'i-synthetic'});assert.equal(joined.status,200);
  const binding=await joined.json() as {tokenCipher:string;roomCode:string};assert.match(binding.roomCode,/^A1[A-F0-9]{6}$/);
  const grant=oauth.open(binding.tokenCipher);assert.equal(grant.activityChannelId,B);assert.equal(grant.activityInstanceId,'i-synthetic');
  const read=()=>post({operation:'read',guildId:A,tokenCipher:binding.tokenCipher});assert.equal((await read()).status,200);
  assert.equal((await post({operation:'read',guildId:A,tokenCipher:initial.tokenCipher})).status,403);
  assert.equal((await post({operation:'join',guildId:A,tokenCipher:binding.tokenCipher,channelId:B,instanceId:'other'})).status>=400,true);
  assert.equal((await post({operation:'read',guildId:B,tokenCipher:binding.tokenCipher})).status,403);
  const publicRead=await post({operation:'read',code:binding.roomCode},'/v1/rooms');assert.equal(publicRead.status,404);
  const control=await post({operation:'control',guildId:A,tokenCipher:binding.tokenCipher,input:{action:'approval',enabled:true,version:1,host:true}});assert.equal(control.status,200);
  state.guilds=[{id:A,permissions:'0'}];const denied=await post({operation:'control',guildId:A,tokenCipher:binding.tokenCipher,input:{action:'approval',enabled:false,version:2,host:true}});assert.equal(denied.status,403);
  const added=await post({operation:'control',guildId:A,tokenCipher:binding.tokenCipher,input:{action:'add',videoId:'abcdefghijk',version:2,video:{title:'FORGED',duration:999},host:true}});assert.equal(added.status,200);
  const addedRoom=await added.json() as {room:{requests:{title:string}[]}};assert.equal(addedRoom.room.requests[0].title,'Verified');
  present=false;assert.ok((await read()).status>=400);
  assert.equal(engine.connected,false);assert.equal(engine.current,null);assert.deepEqual(engine.queue,[]);
  await assert.rejects(commands.execute({action:'enqueue',videoId:'abcdefghijk'},'public'),/voice channel/);
  assert.ok(proofs>=4);
 }finally{await server.close();commands.close();engine.close();store.close();}
});
