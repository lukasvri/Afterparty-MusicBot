import {api} from '@/lib/server';
import {coreUrl} from '@/lib/core-server';
export const GET=()=>api(async()=>{const origin=coreUrl();return {url:origin?origin.replace(/^https:/,'wss:')+'/live':null};});
