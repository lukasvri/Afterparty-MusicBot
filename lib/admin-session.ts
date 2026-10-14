import {env} from 'cloudflare:workers';
import {db,hash,fail,limit,body,api} from './server';
import {verifyPassword,randomToken,sessionCookie,cookieHeader} from './password';
const passwordHash=()=>String((env as unknown as {ADMIN_PASSWORD_HASH?:string}).ADMIN_PASSWORD_HASH??'');
export async function hasPasswordSession(request:Request){
 const token=sessionCookie(request);if(!token||!passwordHash())return false;
 const row=await db().prepare('SELECT password_revision FROM admin_sessions WHERE token_hash=? AND expires_at>?').bind(await hash(token),Date.now()).first<{password_revision:string}>();
 return row?.password_revision===await hash(passwordHash());
}
export async function login(request:Request){
 const response=await api(async()=>{
  const input=await body(request);await limit(request,'admin-login',5,900000);await limit(request,'admin-login-global',60,900000,true);
  if(!passwordHash())fail(503,'Passordinnlogging er ikke konfigurert.');
  if(typeof input.password!=='string'||!await verifyPassword(input.password,passwordHash()))fail(401,'Feil passord.');
  const token=randomToken(),now=Date.now();
  await db().batch([db().prepare('DELETE FROM admin_sessions WHERE expires_at<?').bind(now),db().prepare('INSERT INTO admin_sessions(token_hash,password_revision,expires_at) VALUES(?,?,?)').bind(await hash(token),await hash(passwordHash()),now+28800000)]);
  return {ok:true,token};
 });
 if(!response.ok)return response;
 const {token}=await response.json() as {token:string};return Response.json({authenticated:true},{headers:{'Set-Cookie':cookieHeader(request,token),'Cache-Control':'no-store'}});
}
export async function logout(request:Request){
 const response=await api(async()=>{await body(request);const token=sessionCookie(request);if(token)await db().prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await hash(token)).run();return {ok:true};});
 response.headers.set('Set-Cookie',cookieHeader(request,'',0));return response;
}
