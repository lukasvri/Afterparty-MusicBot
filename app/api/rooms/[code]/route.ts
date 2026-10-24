import {coreUrl,corePresence} from '@/lib/core-server';
import {readLiveState,liveRoom} from '@/lib/live-room';
import {api,body,row,publicRoom,mutate,limit} from '@/lib/server';
type Context={params:Promise<{code:string}>};
export const GET=(request:Request,context:Context)=>api(async()=>{await limit(request,'room-read',360,60000);const code=(await context.params).code;if((code==='DISCORD1'||/^D0[A-F0-9]{6}$/.test(code))&&coreUrl()){try{const live=readLiveState(await corePresence(undefined,code,request.signal));if(live)return liveRoom(live);}catch{/* Durable state is offline in negotiated mode. */}}return publicRoom(request,await row(code),true,true,true);});
export const POST=(request:Request,context:Context)=>api(async()=>mutate(request,(await context.params).code,await body(request)));
