import {radioQuery,rankRadio} from './radio.ts';
import type {RoomVideo} from './protocol.ts';

export type RoomRadioState={current:RoomVideo|null;queue:RoomVideo[];radio?:boolean;radioHistory?:RoomVideo[]};
export async function roomRecommendation(state:RoomRadioState,search:(query:string)=>Promise<RoomVideo[]>):Promise<RoomVideo|null>{
 if(state.radio===false||!state.current||state.current.live||state.queue.length)return null;
 const track=(video:RoomVideo)=>({...video,entryId:video.id,source:'youtube' as const});
 const candidates=await search(radioQuery(state.current));
 const next=rankRadio(track(state.current),candidates.filter(video=>video.embeddable).map(track),state.radioHistory??[],[])[0];
 return next?{id:next.id,title:next.title,artist:next.artist,image:next.image,duration:next.duration,live:next.live,embeddable:next.embeddable}:null;
}
export function roomRadioHistory(state:RoomRadioState){
 return [...(state.radioHistory??[]),...(state.current?[state.current]:[])].slice(-20);
}
