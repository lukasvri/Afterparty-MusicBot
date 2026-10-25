import {api,videos,videoId,limit,fail} from '@/lib/server';
export const GET=(request:Request)=>api(async()=>{await limit(request,'video-requests',30,60000);const ids=(new URL(request.url).searchParams.get('ids')??'').split(',');if(ids.length>8||!ids[0])fail(400,'Vel mellom 1 og 8 videoar.');return {videos:await videos(request,ids.map(videoId))};});
