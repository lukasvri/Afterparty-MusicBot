import {api,body} from '@/lib/server';
import {commands,enqueueCommand} from '@/lib/party';
export const GET=(request:Request)=>api(()=>commands(request));
export const POST=(request:Request)=>api(async()=>enqueueCommand(request,await body(request)));
