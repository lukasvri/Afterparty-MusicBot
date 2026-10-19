import {activityBody,activitySession} from './activity-server';
import {bindActivityGrant} from './request-grant';
import {coreRequest} from './core-server';
import {fail,hash,limit} from './server';
import * as room from '../app/api/rooms/[code]/route';
import * as discord from '../app/api/discord/route';
import * as queue from '../app/api/discord/queue/route';
import * as social from '../app/api/social/route';
import * as socialStream from '../app/api/social/stream/route';
import * as search from '../app/api/search/route';
import * as videos from '../app/api/videos/route';
const json=(value:unknown)=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
export async function activityBridge(request:Request){
 const session=await activitySession(request);
 await limit(request,'activity-bridge',240,60000,true);
 if(!['GET','POST'].includes(request.method))fail(405,'Unsupported Activity method.');
 const path=new URL(request.url).searchParams.get('path');
 if(!path||path.length>2048||!path.startsWith('/api/')||path.includes('\\')||path.includes('#'))fail(400,'Invalid Activity route.');
 const target=new URL(path,'https://activity.internal');
 if(target.origin!=='https://activity.internal'||target.pathname.startsWith('/api/activity'))fail(403,'Unsupported Activity route.');
 const pathname=target.pathname;
 const allowed=['/api/discord','/api/discord/queue','/api/social','/api/social/stream','/api/search','/api/videos','/api/me','/api/rooms','/api/history','/api/realtime',`/api/rooms/${session.room_code}`];
 if(!allowed.includes(pathname))fail(403,'This route is unavailable in Activity tests.');
 const selected=target.searchParams.get('guildId');if(selected&&selected!==session.guild_id)fail(403,'Activity belongs to another server.');
 const headers=new Headers({'Content-Type':'application/json','Origin':target.origin,'X-Afterparty-Visitor':await hash('activity:'+session.guild_id+':'+session.user_id)});
 let input:Record<string,unknown>|undefined;
 let bindGrant=true;
 if(request.method==='POST'){
  if(!['/api/discord','/api/discord/queue','/api/social','/api/social/stream'].includes(pathname))fail(403,'This action is unavailable in Activity tests.');
  input=await activityBody(request);
  if(pathname.startsWith('/api/social')){
   if(input.scope!=='guild'||input.scopeId!==session.guild_id)fail(403,'Activity belongs to another server.');
  }else{
   if(input.guildId&&input.guildId!==session.guild_id)fail(403,'Activity belongs to another server.');
   input.guildId=session.guild_id;
   const verified=await coreRequest<{canManage:boolean}>('/v1/activity','POST',{operation:'verify',guildId:session.guild_id,tokenCipher:session.token_cipher});
   if(pathname==='/api/discord/queue'&&!verified.canManage&&['vote','skip-vote'].includes(String(input.action)))bindGrant=false;
   if(pathname==='/api/discord'&&!verified.canManage)fail(403,'A server manager must control playback.');
  }
 }
 if(pathname==='/api/discord'||pathname==='/api/discord/queue')target.searchParams.set('guildId',session.guild_id);
 const internal=new Request(target,{method:request.method,headers,signal:request.signal,...(input?{body:JSON.stringify(input)}:{})});
 if(bindGrant)bindActivityGrant(internal,session.token_cipher);
 let response:Response;
 if(pathname===`/api/rooms/${session.room_code}`)response=await room.GET(internal,{params:Promise.resolve({code:session.room_code})});
 else if(pathname==='/api/discord')response=await discord[request.method==='GET'?'GET':'POST'](internal);
 else if(pathname==='/api/discord/queue')response=await queue[request.method==='GET'?'GET':'POST'](internal);
 else if(pathname==='/api/social'&&request.method==='POST')response=await social.POST(internal);
 else if(pathname==='/api/social/stream'&&request.method==='POST')response=await socialStream.POST(internal);
 else if(pathname==='/api/search')response=await search.GET(internal);
 else if(pathname==='/api/videos')response=await videos.GET(internal);
 else if(pathname==='/api/me')return json({admin:false});
 else if(pathname==='/api/realtime')return json({url:null});
 else if(pathname==='/api/rooms')return json({rooms:[]});
 else if(pathname==='/api/history')return json({videos:[]});
 else return fail(405,'Unsupported Activity method.');
 // Tickets for direct Core access are not a supported proxy fallback in test mode.
 if(pathname==='/api/discord'&&request.method==='POST'&&response.ok){const data=await response.json() as Record<string,unknown>;delete data.ticket;delete data.url;return json(data);}
 return response;
}
