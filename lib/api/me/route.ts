import {api,isAdmin} from '@/lib/server';
export const GET=(request:Request)=>api(async()=>({admin:await isAdmin(request)}));
