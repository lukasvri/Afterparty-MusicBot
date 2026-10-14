import type {Track} from './types.ts';
export type CatalogSong={id?:string;isrc?:string;title:string;artist:string;duration:number};
export const normalized=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const versions=['remix','live','acoustic','instrumental','karaoke','cover','sped up','slowed','remaster','radio edit','extended'];
export function scoreMatch(source:CatalogSong,track:Track){
 if(track.live||!Number.isFinite(track.duration)||track.duration<=0)return 0;
 if(source.duration>0&&Math.abs(track.duration-source.duration)>Math.max(12,Math.min(30,source.duration*.08)))return 0;
 const title=normalized(track.title),wanted=normalized(source.title),artist=normalized(track.artist);
 for(const version of versions)if(new RegExp(`\\b${version}\\b`).test(title)!==new RegExp(`\\b${version}\\b`).test(wanted))return 0;
 const words=wanted.split(' ').filter(w=>w.length>1&&!['feat','ft','official','audio','video'].includes(w));
 const artists=normalized(source.artist).split(' ').filter(w=>w.length>1);
 const actual=new Set((title+' '+artist).split(' ')),titleWords=new Set(title.split(' '));
 const titleScore=words.filter(w=>titleWords.has(w)).length/Math.max(1,words.length);
 const artistScore=artists.filter(w=>actual.has(w)).length/Math.max(1,artists.length);
 if(titleScore<.8||artistScore<.6)return 0;
 return titleScore*.55+artistScore*.35+(source.duration>0?1-Math.min(1,Math.abs(track.duration-source.duration)/30):.5)*.1;
}
export async function mapLimited<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{
 const result:R[]=new Array(items.length);let index=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(index<items.length){const i=index++;result[i]=await fn(items[i]);}}));
 return result;
}
