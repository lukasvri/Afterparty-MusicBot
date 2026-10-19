import {activityBody,activitySession} from './activity-server';
import {bindActivityGrant} from './request-grant';
import {coreRequest} from './core-server';
import {fail,hash,limit} from './server';
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
 if(target.origin!=='https://activity.internal')fail(403,'Unsupported Activity route.');
 const pathname=target.pathname, roomPath=`/api/rooms/${session.room_code}`;
 if(!['/api/social','/api/social/stream','/api/search','/api/videos','/api/me','/api/rooms','/api/history','/api/realtime',roomPath].includes(pathname))fail(403,'This route is unavailable in Activity tests.');
 const selected=target.searchParams.get('guildId');if(selected&&selected!==session.guild_id)fail(403,'Activity belongs to another server.');
 if(pathname===roomPath||pathname.startsWith('/api/social')){
  if(!/^A1[A-F0-9]{6}$/.test(session.room_code))fail(403,'Reopen the Activity to join its playback session.');
  if(pathname.startsWith('/api/social')&&request.method!=='POST')fail(405,'Unsupported Activity method.');
  const input=request.method==='POST'?await activityBody(request):undefined;
  if(input?.guildId&&input.guildId!==session.guild_id)fail(403,'Activity belongs to another server.');
  if(pathname.startsWith('/api/social')&&(input?.scope!=='room'||input.scopeId!==session.room_code))fail(403,'Activity belongs to another session.');
  if(pathname==='/api/social/stream')fail(503,'Activity social uses polling.');
  const control=pathname===roomPath&&request.method==='POST';
  const result=await coreRequest<{room:unknown}>(control?'/v1/activity?control=1':'/v1/activity','POST',{
   operation:pathname.startsWith('/api/social')?'social':control?'control':'read',
   guildId:session.guild_id,tokenCipher:session.token_cipher,...(input?{input}:{})}, {}, request.signal);
  return json(pathname===roomPath&&request.method==='GET'?result.room:result);
 }
 if(request.method!=='GET')fail(405,'Unsupported Activity method.');
 if(pathname==='/api/me')return json({admin:false});
 if(pathname==='/api/realtime')return json({url:null});
 if(pathname==='/api/rooms')return json({rooms:[]});
 if(pathname==='/api/history')return json({videos:[]});
 const headers=new Headers({'Content-Type':'application/json','Origin':target.origin,'X-Afterparty-Visitor':await hash('activity:'+session.guild_id+':'+session.user_id)});
 const internal=new Request(target,{method:'GET',headers,signal:request.signal});
 bindActivityGrant(internal,session.token_cipher);
 return pathname==='/api/search'?search.GET(internal):videos.GET(internal);
}
