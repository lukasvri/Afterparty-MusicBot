import type {ExtractedMedia} from "./external-types.ts";
import {randomUUID} from 'node:crypto';
import {UserError,type Track} from './types.ts';
export function soundcloudUrl(value:unknown){try{if(typeof value!=="string")return null;const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['soundcloud.com','www.soundcloud.com','m.soundcloud.com','on.soundcloud.com','snd.sc'].includes(u.hostname)?u:null;}catch{return null;}}
export function soundcloudTrack(data:ExtractedMedia):Track{
 const url=data.webpage_url??data.url;
 if(!url||!soundcloudUrl(url)||!data.id||!data.title||data.availability==='premium_only'||data.is_preview||data.full_duration&&Number(data.duration)<data.full_duration-2)throw new UserError('This SoundCloud track is unavailable or only a preview.');
 return {id:String(data.id),entryId:randomUUID(),title:data.title,artist:data.uploader??data.artist??'SoundCloud',image:data.thumbnail??data.thumbnails?.at(-1)?.url??'',duration:Number(data.duration)||0,live:false,embeddable:false,source:'soundcloud',url};
}
export type Extractor=(args:string[])=>Promise<ExtractedMedia>;
export async function resolveSoundcloud(query:string,limit:number,extract:Extractor,searchCount=1){
 const search=/^sc(?:search)?:\s*(.+)$/i.exec(query);
 if(!search&&!soundcloudUrl(query))throw new UserError('Use a valid SoundCloud link.');
 const target=search?`scsearch5:${search[1]}`:query;
 const data=await extract(['--flat-playlist','--playlist-end',String(search?5:limit),'--dump-single-json','--skip-download',target]);
 const entries=data.entries??[data];const tracks:Track[]=[];
 for(const item of entries.slice(0,search?5:limit)){
  if(!item)continue;
  try{let full=item;
   if(!item.duration||!soundcloudUrl(item.webpage_url??item.url)){
    const url=item.webpage_url??item.url;
    // Only extractor-produced SoundCloud API URLs may need expanding.
    const trusted=soundcloudUrl(url)||typeof url==='string'&&/^https:\/\/api(?:-v2)?\.soundcloud\.com\/tracks\/[\w:%-]+(?:\?.*)?$/.test(url);
    if(!url||!trusted)throw new UserError('This SoundCloud track has no playable link.');
    full=await extract(['--no-playlist','--dump-single-json','--skip-download',url]);
   }
   tracks.push(soundcloudTrack(full));if(search&&tracks.length>=searchCount)break;
  }catch(error){if(!search)throw error;}
 }
 if(!tracks.length)throw new UserError('No playable SoundCloud tracks found.');
 return tracks;
}
