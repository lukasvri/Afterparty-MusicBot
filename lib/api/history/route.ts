import {api} from '@/lib/server';
import {history} from '@/lib/party';
export const GET=(request:Request)=>api(()=>history(new URL(request.url).searchParams.get('sort')??'recent'));
