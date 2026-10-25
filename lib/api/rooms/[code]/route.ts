import {coreUrl,coreRequest} from '@/lib/core-server';
import {readLiveState,liveRoom} from '@/lib/live-room';
import {api,body,row,publicRoom,mutate,limit} from '@/lib/server';
import {isDiscordRoomCode} from '@/services/core/src/concert-links';
type Context={params:Promise<{code:string}>};
export const GET=(request:Request,context:Context)=>api(async()=>{await limit(request,'room-read',360,60000);const code=(await context.params).code;if(isDiscordRoomCode(code)&&coreUrl()){try{const data=await coreRequest<{state:unknown}>('/v1/state?room='+code,'GET',undefined,{},request.signal);const live=readLiveState(data.state);if(live)return liveRoom(live);}catch(error){if(request.signal.aborted)throw error;/* Durable room state covers reconnects. */}}return publicRoom(request,await row(code));});
export const POST=(request:Request,context:Context)=>api(async()=>mutate(request,(await context.params).code,await body(request)));
