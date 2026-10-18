import {db,hash,fail,isAdmin,limit} from './server';
import {coreRequest} from './core-server';
import {ownerUpdateUrl} from './owner-update';
export type GuildChoice={id:string;name:string;roomCode:string;installed:boolean};
type Application={clientId:string;defaultGuildId:string;oauthReady:boolean;guilds:GuildChoice[]};
const cookie=(request:Request,name:string)=>request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)??'';
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const header=(name:string,value:string,seconds:number)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
export async function application(){return coreRequest<Application>('/v1/application');}
export async function discordSession(request:Request){const value=cookie(request,'gk-discord');if(!/^[a-f0-9]{64}$/.test(value))return null;return db().prepare('SELECT token_cipher FROM discord_admin_sessions WHERE token_hash=? AND expires_at>?').bind(await hash(value),Date.now()).first<{token_cipher:string}>();}
export async function adminGuilds(request:Request){const app=await application(),session=await discordSession(request);const permissions=3230720;const invite=`https://discord.com/oauth2/authorize?client_id=${app.clientId}&scope=bot%20applications.commands&permissions=${permissions}`;
 const updateUrl=await ownerUpdateUrl(request),ownerUpdate=updateUrl?{ownerUpdateUrl:updateUrl}:{};
 if(session){const access=await coreRequest<{user:{name:string};guilds:Array<{id:string;name:string}>}>('/v1/oauth','POST',{operation:'guilds',tokenCipher:session.token_cipher});return {authenticated:true,method:'discord',globalAdmin:await isAdmin(request),user:access.user,guilds:access.guilds.map(g=>({...g,roomCode:app.guilds.find(s=>s.id===g.id)?.roomCode??'',installed:app.guilds.some(s=>s.id===g.id)})),invite,oauthReady:app.oauthReady,...ownerUpdate};}
 const owner=await isAdmin(request);return {authenticated:owner,globalAdmin:owner,method:owner?'owner':'discord',guilds:owner?app.guilds.filter(s=>s.id===app.defaultGuildId).map(g=>({...g,installed:true})):[],invite,oauthReady:app.oauthReady,...ownerUpdate};
}
export async function adminContext(request:Request,value:unknown){
 const explicit=typeof value==='string'&&value?value:undefined;
 if(explicit&&!/^\d{14,22}$/.test(explicit))fail(400,'Velg en Discord-server.');
 const app=explicit?undefined:await application();
 const id=explicit??app!.defaultGuildId;
 if(!/^\d{14,22}$/.test(id))fail(400,'Velg en Discord-server.');
 // A selected guild needs no application metadata. Core still validates its
 // Discord grant on every operation; no permissions or sessions are cached.
 const session=await discordSession(request);
 if(session)return {guildId:id,tokenCipher:session.token_cipher};
 if(!await isAdmin(request))fail(403,'Logg inn med Discord for å administrere denne serveren.');
 const ownerApplication=app??await application();
 if(id!==ownerApplication.defaultGuildId)fail(403,'Logg inn med Discord for å administrere denne serveren.');
 return {guildId:id};
}
export async function adminState(request:Request,id?:string){const context=await adminContext(request,id);return coreRequest<unknown>('/v1/admin?guildId='+context.guildId,'GET',undefined,context.tokenCipher?{'X-Discord-Grant':context.tokenCipher}:{});}
export async function oauthStart(request:Request){await limit(request,'discord-login',10,900000);const app=await application();if(!app.oauthReady||!/^\d+$/.test(app.clientId))fail(503,'Discord-innlogging er ikke konfigurert ennå.');const state=token(),now=Date.now();await db().batch([db().prepare('DELETE FROM discord_oauth_states WHERE expires_at<?').bind(now),db().prepare('INSERT INTO discord_oauth_states VALUES(?,?)').bind(await hash(state),now+600000)]);const url=new URL('https://discord.com/oauth2/authorize');url.search=new URLSearchParams({client_id:app.clientId,response_type:'code',scope:'identify guilds',state,redirect_uri:new URL('/api/auth/discord/callback',request.url).href}).toString();return new Response(null,{status:302,headers:{Location:url.href,'Set-Cookie':header('gk-oauth-state',state,600),'Cache-Control':'no-store'}});}
export async function oauthCallback(request:Request){const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code'),saved=cookie(request,'gk-oauth-state');if(!state||state!==saved||!/^[a-f0-9]{64}$/.test(state)||!code)fail(400,'Discord-innloggingen mangler gyldig tilstand. Prøv igjen.');const valid=await db().prepare('DELETE FROM discord_oauth_states WHERE token_hash=? AND expires_at>? RETURNING token_hash').bind(await hash(state),Date.now()).first();if(!valid)fail(400,'Innloggingen er utløpt eller allerede brukt.');const grant=await coreRequest<{tokenCipher:string;expiresAt:number}>('/v1/oauth','POST',{operation:'exchange',code});const session=token();await db().batch([db().prepare('DELETE FROM discord_admin_sessions WHERE expires_at<?').bind(Date.now()),db().prepare('INSERT INTO discord_admin_sessions VALUES(?,?,?)').bind(await hash(session),grant.tokenCipher,grant.expiresAt)]);const headers=new Headers({Location:'/admin','Cache-Control':'no-store'});headers.append('Set-Cookie',header('gk-discord',session,Math.floor((grant.expiresAt-Date.now())/1000)));headers.append('Set-Cookie',header('gk-oauth-state','',0));return new Response(null,{status:302,headers});}
export async function discordLogout(request:Request){const saved=cookie(request,'gk-discord');if(saved)await db().prepare('DELETE FROM discord_admin_sessions WHERE token_hash=?').bind(await hash(saved)).run();return new Response(null,{status:204,headers:{'Set-Cookie':header('gk-discord','',0)}});}
