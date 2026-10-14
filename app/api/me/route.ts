import {api,isAdmin} from '@/lib/server';
export const GET=()=>api(async()=>({admin:await isAdmin()}));
