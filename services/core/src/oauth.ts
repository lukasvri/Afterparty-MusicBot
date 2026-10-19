import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {UserError} from './types.ts';
export function canManageGuild(g:{owner?:boolean;permissions?:string}){try{return g.owner===true||(BigInt(g.permissions??'0')&40n)!==0n;}catch{return false;}}
type Grant={access:string;expiresAt:number;user:{id:string;name:string};activityGuildId?:string;activityChannelId?:string;activityInstanceId?:string;activityRoomCode?:string};
export class DiscordOAuth{
 private activityCodes=new Map<string,number>();
 private key:Buffer;readonly clientId:string;readonly secret:string;readonly origin:string;readonly request:typeof fetch;
 constructor(privateKey:string,clientId:string,secret:string,origin:string,request:typeof fetch=fetch){this.clientId=clientId;this.secret=secret;this.origin=origin;this.request=request;this.key=createHash('sha256').update('discord-oauth:'+privateKey).digest();}
 seal(value:Grant){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from('gutta-krutt-oauth-v1'));const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
 open(token:unknown):Grant{try{if(typeof token!=='string'||token.length>4096)throw Error();const raw=Buffer.from(token,'base64url');const cipher=createDecipheriv('aes-256-gcm',this.key,raw.subarray(0,12));cipher.setAAD(Buffer.from('gutta-krutt-oauth-v1'));cipher.setAuthTag(raw.subarray(12,28));const value=JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)),cipher.final()]).toString());if(value.expiresAt<=Date.now()||!value.access||!/^\d{14,22}$/.test(value.user?.id))throw Error();return value;}catch{throw new UserError('Your Discord sign-in has expired. Sign in again.',401);}}
 async exchange(code:unknown){if(!this.secret||typeof code!=='string'||code.length>2048)throw new UserError('Discord sign-in is not configured.',503);const r=await this.request('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.clientId,client_secret:this.secret,grant_type:'authorization_code',code,redirect_uri:this.origin+'/api/auth/discord/callback'}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new UserError('Could not complete Discord sign-in.',401);const t=await r.json() as {access_token:string;expires_in:number};const user=await this.user(t.access_token);const grant={access:t.access_token,expiresAt:Date.now()+Math.min(t.expires_in,28800)*1000,user};return {tokenCipher:this.seal(grant),expiresAt:grant.expiresAt,user};}
 /** SDK authorization codes use Discord's Activity exchange without a website redirect URI. */
 async exchangeActivity(code:unknown,guildId:string){
  if(!this.secret||!/^\d{14,22}$/.test(this.clientId))throw new UserError('Activity test mode is not configured.',503);
  if(typeof code!=='string'||!code||code.length>2048||/[\s\u0000-\u001f\u007f]/.test(code)||!/^\d{14,22}$/.test(guildId))throw new UserError('Invalid Activity authorization.',400);
  const now=Date.now();for(const [id,expires] of this.activityCodes)if(expires<=now)this.activityCodes.delete(id);
  const fingerprint=createHash('sha256').update(code).digest('hex');
  if(this.activityCodes.has(fingerprint))throw new UserError('Activity authorization was already used. Authorize again.',409);
  if(this.activityCodes.size>=128)throw new UserError('Activity authorization is busy. Try later.',429);
  // Reserve before awaiting Discord so concurrent exchanges cannot replay a code.
  this.activityCodes.set(fingerprint,now+600000);
  try{
   const signal=AbortSignal.timeout(10000);
   const response=await this.request('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.clientId,client_secret:this.secret,grant_type:'authorization_code',code}),signal});
   if(!response.ok)throw new UserError('Could not authorize Activity. Authorize again.',401);
   const value=await response.json() as {access_token?:unknown;expires_in?:unknown;token_type?:unknown;scope?:unknown};
   if(typeof value.access_token!=='string'||!value.access_token||value.access_token.length>2048||typeof value.expires_in!=='number'||!Number.isFinite(value.expires_in)||value.expires_in<=0||String(value.token_type).toLowerCase()!=='bearer'||typeof value.scope!=='string'||!['identify','guilds'].every(scope=>value.scope!.toString().split(' ').includes(scope)))throw new UserError('Invalid Activity grant.',401);
   const userResponse=await this.request('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+value.access_token},signal});
   if(!userResponse.ok)throw new UserError('Could not verify Activity identity.',401);
   const userValue=await userResponse.json() as {id?:unknown;username?:unknown;global_name?:unknown};
   if(typeof userValue.id!=='string'||!/^\d{14,22}$/.test(userValue.id)||typeof userValue.username!=='string'||!userValue.username||userValue.username.length>128)throw new UserError('Invalid Activity identity.',401);
   const user={id:userValue.id,name:typeof userValue.global_name==='string'?userValue.global_name.slice(0,128):userValue.username};
   const guildResponse=await this.request('https://discord.com/api/v10/users/@me/guilds?limit=200',{headers:{Authorization:'Bearer '+value.access_token},signal});
   if(!guildResponse.ok)throw new UserError('Could not verify Activity server membership.',401);
   const memberships=await guildResponse.json() as {id:string;owner?:boolean;permissions?:string}[];
   if(!Array.isArray(memberships)||memberships.length>200)throw new UserError('Invalid Activity membership response.',401);
   const guild=memberships.find(g=>g&&g.id===guildId);
   if(!guild)throw new UserError('You are not a member of this test server.',403);
   const expiresAt=now+Math.min(value.expires_in,1800)*1000;
   const tokenCipher=this.seal({access:value.access_token,expiresAt,user,activityGuildId:guildId});
   return {accessToken:value.access_token,tokenCipher,expiresAt,user,canManage:canManageGuild(guild)};
  }catch(error){if(error instanceof UserError)throw error;throw new UserError('Activity authorization is unavailable. Authorize again.',502);}
 }
 async user(access:string){const r=await this.request('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new UserError('Sign in with Discord again.',401);const u=await r.json() as {id:string;global_name?:string|null;username:string};return {id:u.id,name:u.global_name??u.username};}
 async guilds(token:unknown){const grant=this.open(token);const r=await this.request('https://discord.com/api/v10/users/@me/guilds?limit=200',{headers:{Authorization:'Bearer '+grant.access},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new UserError('Could not verify Discord access. Sign in again.',401);const all=await r.json() as {id:string;name:string;icon?:string|null;owner?:boolean;permissions?:string}[];return {user:grant.user,guilds:all.filter(g=>!grant.activityGuildId||g.id===grant.activityGuildId).filter(canManageGuild).map(g=>({id:g.id,name:g.name,icon:g.icon??null}))};}
 async verifyActivity(token:unknown,guildId:string){const grant=this.open(token);if(grant.activityGuildId!==guildId)throw new UserError('Activity session belongs to another server or login flow.',403);return this.member(token,guildId);}
 async member(token:unknown,guildId:string){const grant=this.open(token);if(grant.activityGuildId&&grant.activityGuildId!==guildId)throw new UserError('Activity session belongs to another server.',403);const r=await this.request('https://discord.com/api/v10/users/@me/guilds?limit=200',{headers:{Authorization:'Bearer '+grant.access},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new UserError('Could not verify Discord membership.',401);const guilds=await r.json() as {id:string;owner?:boolean;permissions?:string}[];const guild=guilds.find(g=>g.id===guildId);if(!guild)throw new UserError('You are not a member of this server.',403);return {user:grant.user,canManage:canManageGuild(guild)};}
 async require(token:unknown,guildId:string){const access=await this.guilds(token);if(!access.guilds.some(g=>g.id===guildId))throw new UserError('You do not have administrator access to this server.',403);return access.user;}
}
