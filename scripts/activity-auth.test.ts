import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { pbkdf2Sync } from "node:crypto";

interface FixtureStatement {
  bind(...values: SQLInputValue[]): FixtureStatement;
  first(): Promise<Record<string, SQLOutputValue> | null>;
  run(): Promise<{ meta: { changes: number } }>;
  all(): Promise<{ results: Record<string, SQLOutputValue>[] }>;
}
interface FixtureDatabase {
  prepare(sql: string): FixtureStatement;
  batch(statements: FixtureStatement[]): Promise<unknown[]>;
}
type FixtureEnvironment = {
  DB?: FixtureDatabase;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_BRIDGE_KEY?: string;
  DISCORD_ACTIVITY_ENABLED?: string;
  DISCORD_ACTIVITY_CLIENT_ID?: string;
  OWNER_EMAIL?: string;
  OWNER_UPDATE_URL?: string;
};
const context: { grantOverride: Record<string, unknown> | null; env: FixtureEnvironment; coreCalls: unknown[][]; rejectAdmin: boolean; coreFailure: "none" | "offline" | "unconfigured" | "oauth-rejected" } = { grantOverride: null, env: {}, coreCalls: [], rejectAdmin: false, coreFailure: "none" };
const globals = globalThis as typeof globalThis & { __afterpartyAuthTest: typeof context };
globals.__afterpartyAuthTest = context;
const root = new URL("../", import.meta.url);
const moduleUrl = (source: string) => "data:text/javascript," + encodeURIComponent(source);
const hooks = registerHooks({
  resolve(specifier, options, next) {
    if (specifier === "cloudflare:workers") return {
      url: moduleUrl("export const env=globalThis.__afterpartyAuthTest.env;"), shortCircuit: true,
    };
    if (specifier.endsWith("core-server")) return {
      url: moduleUrl(`
        const c=globalThis.__afterpartyAuthTest;
        export const coreUrl=()=> 'https://core.example';
        export const commandTicket=async()=>({ticket:'must-not-return',url:'https://core.example/v1/ticket'});
        export const coreSocialStream=async(input)=>{c.coreCalls.push(['social-stream',input]);return new Response('data: {}\\n\\n');};
        export const coreRequest=async(...args)=>{
          c.coreCalls.push(args);const [path,method,input]=args;
          if(c.coreFailure==='offline')throw Object.assign(new Error('sensitive upstream failure'),{status:503});
          if(path==='/v1/activity'){
            if(input.operation==='config')return {enabled:c.coreFailure!=='unconfigured',clientId:'111111111111111111'};
            if(input.operation==='verify')return {canManage:!c.rejectAdmin,user:{id:'444444444444444444'}};
            return {accessToken:'synthetic-access',tokenCipher:'private-cipher',expiresAt:Date.now()+1800000,user:{id:'444444444444444444'},guild:{id:c.coreFailure==='oauth-rejected'?'333333333333333333':input.guildId,roomCode:'DISCORD1'},...(c.grantOverride??{})};
          }
          if(path.startsWith('/v1/state'))return {state:{online:true,ready:true,connected:true,playing:true,current:{id:'abcdefghijk'},queue:[],playbackKey:'playback',queueRevision:'revision'}};
          if(path==='/v1/command')throw new Error('synthetic ticket fallback');
          if(path==='/v1/social')return {social:{revision:1},canManage:false};
          if(path==='/v1/concert-queue')return {state:{queue:[],revision:'synthetic'},canManage:input.admin===true};
          throw new Error('Unexpected upstream call');
        };
      `),shortCircuit:true,
    };
    if (specifier.startsWith("@/")) return next(new URL(specifier.slice(2) + ".ts", root).href, options);
    if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) {
      const url = new URL(specifier + ".ts", options.parentURL);
      if (existsSync(url)) return next(url.href, options);
    }
    return next(specifier, options);
  },
  load(url, options, next) {
    if (url.startsWith(root.href) && url.endsWith(".ts")) return {
      format: "module", source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }), shortCircuit: true,
    };
    return next(url, options);
  },
});
const {isAdmin}=await import('../lib/server.ts');
const {login}=await import('../lib/admin-session.ts');
const {discordSession}=await import('../lib/discord-auth.ts');
const {activityGrant,bindActivityGrant}=await import('../lib/request-grant.ts');
const {activityResponse,activitySession}=await import('../lib/activity-server.ts');
const activity=await import('../app/api/activity/route.ts');
const auth=await import('../app/api/activity/auth/route.ts');
const bridge=await import('../app/api/activity/bridge/route.ts');
const logout=await import('../app/api/activity/logout/route.ts');
hooks.deregister();
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter(n => n.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(new URL("../drizzle/" + name, import.meta.url), "utf8"));
  return sqlite;
}
// Reset fields without replacing the imported environment object.
const env = context.env;
function setup() {
  for (const key of Object.keys(env)) Reflect.deleteProperty(env, key);
  context.coreCalls.length = 0;
  context.grantOverride = null;
  context.rejectAdmin = false;
  context.coreFailure = "none";
  const sqlite = fixture();
  const prepare = (sql: string, args: SQLInputValue[] = []): FixtureStatement => ({
    bind(...values) { return prepare(sql, values); },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  env.DB = { prepare, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  }};
  const salt = "a1".repeat(16);
  env.ADMIN_PASSWORD_HASH = `pbkdf2$100000$${salt}$${pbkdf2Sync("synthetic-password", Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex")}`;
  env.ADMIN_BRIDGE_KEY = "synthetic-bridge";
  const request = (cookie = "", method = "GET", input?: Record<string, unknown>) => new Request("https://afterparty.example/admin", {
    method, headers: { cookie, "Content-Type": "application/json" },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const signIn = async () => {
    const response = await login(request("", "POST", { password: "synthetic-password" }));
    assert.equal(response.status, 200);
    return response.headers.getSetCookie()[0].split(";")[0];
  };
  return { sqlite, request, signIn };
}

const APP='111111111111111111',GUILD='222222222222222222',OTHER='333333333333333333';
const ORIGIN=`https://${APP}.discordsays.com`;
function enabled(){const f=setup();env.DISCORD_ACTIVITY_ENABLED='true';env.DISCORD_ACTIVITY_CLIENT_ID=APP;return f;}
function req(path='/api/activity',method='GET',input?:unknown,cookie='',origin:string|undefined=ORIGIN){return new Request('https://afterparty.example'+path,{method,headers:{'Content-Type':'application/json',cookie,...(origin?{Origin:origin}:{})},...(input===undefined?{}:{body:JSON.stringify(input)})});}
async function start(){const response=await activity.GET(req());assert.equal(response.status,200);const data=await response.json() as {state:string};return {state:data.state,cookie:response.headers.getSetCookie()[0].split(';')[0]};}
async function signIn(){const state=await start();const response=await auth.POST(req('/api/activity/auth','POST',{...state,code:'synthetic-code',guildId:GUILD},state.cookie));assert.equal(response.status,200);return {response,cookie:response.headers.getSetCookie().find(c=>c.startsWith('gk-activity='))!.split(';')[0],state};}
function routed(path:string,cookie:string,method='GET',input?:unknown){return bridge.GET(req('/api/activity/bridge?path='+encodeURIComponent(path),method,input,cookie));}
test('Activity auth requires configured exact origin and one-use cookie-bound state; private grant stays server-side',async()=>{
 const f=enabled();try{
  const s=await start();
  assert.equal((await auth.POST(req('/api/activity/auth','POST',{state:s.state,code:'code',guildId:GUILD}))).status,403);
  assert.equal((await auth.POST(req('/api/activity/auth','POST',{state:s.state,code:'code',guildId:GUILD},s.cookie,'https://evil.example'))).status,403);
  const response=await auth.POST(req('/api/activity/auth','POST',{state:s.state,code:'code',guildId:GUILD},s.cookie));assert.equal(response.status,200);
  const text=await response.text();assert.ok(text.includes('synthetic-access'));assert.ok(!text.includes('private-cipher'));assert.ok(!text.includes('tokenCipher'));
  const cookies=response.headers.getSetCookie().join(';');for(const flag of ['HttpOnly','Secure','SameSite=None','Partitioned','Path=/api/activity'])assert.ok(cookies.includes(flag));
  assert.equal(f.sqlite.prepare('SELECT token_cipher FROM activity_test_sessions').get()!.token_cipher,'private-cipher');
  assert.equal((await auth.POST(req('/api/activity/auth','POST',{state:s.state,code:'code',guildId:GUILD},s.cookie))).status,409);
 }finally{f.sqlite.close();}
});
test('Activity auth fails closed for disabled mode, expired state, malformed and oversized bodies and mismatched upstream guild',async()=>{
 const f=enabled();try{
  env.DISCORD_ACTIVITY_ENABLED='false';assert.equal((await activity.GET(req())).status,503);env.DISCORD_ACTIVITY_ENABLED='true';
  context.coreFailure='unconfigured';assert.equal((await activity.GET(req())).status,503);context.coreFailure='none';
  const s=await start();f.sqlite.prepare('UPDATE discord_oauth_states SET expires_at=0').run();
  assert.equal((await auth.POST(req('/api/activity/auth','POST',{state:s.state,code:'code',guildId:GUILD},s.cookie))).status,409);
  const fresh=await start();
  assert.equal((await auth.POST(req('/api/activity/auth','POST',{state:fresh.state,code:{},guildId:GUILD},fresh.cookie))).status,400);
  assert.equal((await auth.POST(req('/api/activity/auth','POST',{state:fresh.state,code:'x'.repeat(5000),guildId:GUILD},fresh.cookie))).status,413);
  context.coreFailure='oauth-rejected';assert.equal((await auth.POST(req('/api/activity/auth','POST',{state:fresh.state,code:'code',guildId:GUILD},fresh.cookie))).status,502);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM activity_test_sessions').get()!.n,0);
 }finally{f.sqlite.close();}
});
test('Activity sessions cannot grant ordinary admin and only Request identity binds internal grants',async()=>{
 const f=enabled();try{
  const s=await signIn(),request=req('/api/admin/session','GET',undefined,s.cookie);
  assert.equal(await isAdmin(request),false);assert.equal(await discordSession(request),null);
  request.headers.set('X-Discord-Grant','forged-cipher');request.headers.set('X-Activity-Grant','forged-cipher');request.headers.set('Authorization','Bearer private-cipher');
  assert.equal(activityGrant(request),undefined);assert.equal(await discordSession(request),null);
  bindActivityGrant(request,'internal-grant');assert.equal((await discordSession(request))!.token_cipher,'internal-grant');assert.equal(activityGrant(new Request(request)),undefined);
  f.sqlite.prepare('UPDATE activity_test_sessions SET expires_at=0').run();assert.equal((await activityResponse(async()=>Response.json(await activitySession(req('/api/activity/bridge','GET',undefined,s.cookie))))).status,401);
 }finally{f.sqlite.close();}
});
test('Activity bridge rejects cross-guild routes, social scope changes, admin/auth paths and forged caller roles',async()=>{
 const f=enabled();try{
  const s=await signIn();
  for(const path of ['/api/admin/session','/api/auth/discord','/api/activity/auth','/api/rooms/OTHERONE','/api/discord?guildId='+OTHER,'/api/../api/admin/session','//evil.example/api/me'])assert.ok((await routed(path,s.cookie)).status>=400,path);
  assert.equal((await routed('/api/social',s.cookie,'POST',{scope:'room',scopeId:'TESTROOM',action:'join'})).status,403);
  assert.equal((await routed('/api/social',s.cookie,'POST',{scope:'guild',scopeId:OTHER,action:'join'})).status,403);
  const response=await routed('/api/social',s.cookie,'POST',{scope:'guild',scopeId:GUILD,action:'join',host:true,tokenCipher:'forged'});assert.equal(response.status,200);
  const payload=context.coreCalls.find(c=>c[0]==='/v1/social')![2] as Record<string,unknown>;assert.equal(payload.tokenCipher,'private-cipher');assert.equal(payload.host,undefined);
  assert.equal((await routed('/api/me',s.cookie)).status,200);
 }finally{f.sqlite.close();}
});
test('Activity playback requires fresh manager verification and strips direct-Core ticket fallback',async()=>{
 const f=enabled();try{
  const s=await signIn();const input={action:'pause',commandId:crypto.randomUUID(),playbackKey:'playback',guildId:GUILD};
  context.rejectAdmin=true;assert.equal((await routed('/api/discord',s.cookie,'POST',input)).status,403);assert.equal(context.coreCalls.some(c=>c[0]==='/v1/command'),false);
  context.rejectAdmin=false;const response=await routed('/api/discord',s.cookie,'POST',input);assert.equal(response.status,200);const data=await response.json() as Record<string,unknown>;assert.equal(data.ticket,undefined);assert.equal(data.url,undefined);
  const verifications=context.coreCalls.filter(c=>c[0]==='/v1/activity'&&(c[2] as {operation:string}).operation==='verify');assert.equal(verifications.length,2);
  assert.equal((verifications[0][2] as {tokenCipher:string}).tokenCipher,'private-cipher');
 }finally{f.sqlite.close();}
});
test('ordinary Activity members vote through the public queue with deterministic verified identity',async()=>{
 const f=enabled();try{
  const s=await signIn();context.rejectAdmin=true;
  for(const action of ['vote','skip-vote']){
   const response=await routed('/api/discord/queue',s.cookie,'POST',{action,guildId:GUILD,videoId:'abcdefghijk',playbackKey:'playback',revision:'revision',host:true,participantHash:'forged'});
   assert.equal(response.status,200);
  }
  const calls=context.coreCalls.filter(c=>c[0]==='/v1/concert-queue').map(c=>c[2] as Record<string,unknown>);
  assert.equal(calls.length,2);
  for(const payload of calls){assert.equal(payload.admin,false);assert.equal(payload.tokenCipher,undefined);assert.equal(payload.guildId,GUILD);assert.notEqual(payload.participantHash,'forged');assert.match(String(payload.participantHash),/^[a-f0-9]{64}$/);}
  assert.equal(calls[0].participantHash,calls[1].participantHash);
 }finally{f.sqlite.close();}
});
test('Activity logout requires exact origin, revokes only its session and clears its partitioned cookie',async()=>{
 const f=enabled();try{
  const s=await signIn(),other=await signIn(),admin=await f.signIn();
  const cookies=s.cookie+'; '+admin;
  assert.equal(await isAdmin(req('/admin','GET',undefined,cookies)),true);
  assert.equal((await logout.POST(req('/api/activity/logout','POST',{},cookies,'https://evil.example'))).status,403);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM activity_test_sessions').get()!.n,2);
  const response=await logout.POST(req('/api/activity/logout','POST',{},cookies));assert.equal(response.status,204);
  const cleared=response.headers.getSetCookie()[0];for(const flag of ['gk-activity=;','Max-Age=0','Path=/api/activity','SameSite=None','Partitioned','HttpOnly','Secure'])assert.ok(cleared.includes(flag));
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM activity_test_sessions').get()!.n,1);
  assert.equal((await routed('/api/me',s.cookie)).status,401);
  assert.equal((await routed('/api/me',other.cookie)).status,200);
  assert.equal(await isAdmin(req('/admin','GET',undefined,admin)),true);
 }finally{f.sqlite.close();}
});
test('Activity authentication rejects malformed or oversized upstream tokens without storing or leaking them',async()=>{
 const f=enabled();try{
  for(const override of [{accessToken:''},{accessToken:42},{accessToken:'secret'.repeat(700)},{tokenCipher:''},{tokenCipher:{}},{tokenCipher:'cipher'.repeat(1400)}]){
   const s=await start();context.grantOverride=override;
   const response=await auth.POST(req('/api/activity/auth','POST',{state:s.state,code:'code',guildId:GUILD},s.cookie));assert.equal(response.status,502);
   const body=await response.text();assert.ok(!body.includes('secret'));assert.ok(!body.includes('cipher'));assert.ok(!body.includes('accessToken'));
  }
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM activity_test_sessions').get()!.n,0);
 }finally{f.sqlite.close();}
});
