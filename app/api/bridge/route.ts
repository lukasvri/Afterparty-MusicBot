import {api,body} from '@/lib/server';
import {bridge} from '@/lib/party';
export const POST=(request:Request)=>api(async()=>bridge(request,await body(request,64000)));
