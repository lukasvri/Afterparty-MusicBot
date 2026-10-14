import {api,body,limit} from '@/lib/server';
import {discord,enqueueCommand,publicCommand} from '@/lib/party';
export const GET=(request:Request)=>api(async()=>{await limit(request,'discord-read',360,60000);const params=new URL(request.url).searchParams,id=params.get('command'),guildId=params.get('guildId')??undefined;return {...await discord(false,guildId),...(id?{command:await publicCommand(id,guildId)}:{})};});
export const POST=(request:Request)=>api(async()=>enqueueCommand(request,await body(request),true));
