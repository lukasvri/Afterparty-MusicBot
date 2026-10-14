import {api,search} from '@/lib/server';
export const GET=(request:Request)=>api(()=>search(request,new URL(request.url).searchParams.get('q')??''));
