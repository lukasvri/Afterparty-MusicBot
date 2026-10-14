import type {Track} from './types.ts';
import type {CatalogSong} from './matching.ts';
import {radioArtist,radioTitle} from './radio.ts';
import type {Store} from './store.ts';
export class Recommendations{
 private store:Store;private key:string;private request:typeof fetch;
 constructor(store:Store,key:string,request:typeof fetch=fetch){this.store=store;this.key=key;this.request=request;}
 get enabled(){return Boolean(this.key);}
 async similar(seed:Track):Promise<CatalogSong[]>{
  if(!this.key)return [];
  const artist=seed.catalog?.artist??radioArtist(seed);
  const title=radioTitle(seed);
  if(!artist||!title)return [];
  const cacheKey='similar:'+JSON.stringify([artist,title]);const cached=this.store.get<{at:number;songs:CatalogSong[]}|null>(cacheKey,null);
  if(cached&&Date.now()-cached.at<86400000)return cached.songs;
  const url=new URL('https://ws.audioscrobbler.com/2.0/');url.search=new URLSearchParams({method:'track.getSimilar',artist,track:title,autocorrect:'1',limit:'15',api_key:this.key,format:'json'}).toString();
  const r=await this.request(url,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('Last.fm unavailable');
  const data=await r.json() as any;if(data.error)throw new Error('Last.fm unavailable');
  const songs:CatalogSong[]=(data.similartracks?.track??[]).filter((t:any)=>t.name&&t.artist?.name).map((t:any)=>({title:t.name,artist:t.artist.name,duration:0}));
  this.store.set(cacheKey,{at:Date.now(),songs});return songs;
 }
}
