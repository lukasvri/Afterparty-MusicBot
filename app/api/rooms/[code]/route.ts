import {coreUrl,coreRequest} from '@/lib/core-server';
import {readLiveState,liveRoom} from '@/lib/live-room';
import {api,body,row,publicRoom,mutate,limit} from '@/lib/server';
type Context={params:Promise<{code:string}>};
export const GET=(request:Request,context:Context)=>api(async()=>{await limit(request,'room-read',360,60000);const code=(await context.params).code;if((code==='DISCORD1'||/^D0[A-F0-9]{6}$/.test(code))&&coreUrl()){try{const data=await coreRequest<{state:unknown}>('/v1/state?room='+code);const live=readLiveState(data.state);if(live)return liveRoom(live);}catch{/* Durable room state covers reconnects. */}}return publicRoom(request,await row(code));});
export const POST=(request:Request,context:Context)=>api(async()=>mutate(request,(await context.params).code,await body(request)));
