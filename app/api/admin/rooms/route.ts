import {api,body,adminRooms,closeRoom} from '@/lib/server';
export const GET=(request:Request)=>api(()=>adminRooms(request));
export const DELETE=(request:Request)=>api(async()=>closeRoom(request,String((await body(request)).code??'')));
