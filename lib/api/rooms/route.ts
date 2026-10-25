import {api,body,createRoom,openRooms,fail} from '@/lib/server';
export const GET=(request:Request)=>api(()=>openRooms(request));
export const POST=(request:Request)=>api(async()=>{const input=await body(request);if(input.isPublic!==undefined&&typeof input.isPublic!=='boolean')fail(400,'Velg offentlig eller privat rom.');return createRoom(request,String(input.name??''),input.isPublic===true);});
