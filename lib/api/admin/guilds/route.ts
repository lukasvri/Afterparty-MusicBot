import {api} from '@/lib/server';import {adminGuilds} from '@/lib/discord-auth';
export const GET=(request:Request)=>api(()=>adminGuilds(request));
