import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaultSettings} from './types.ts';
import type {Store} from './store.ts';

type PreviousSong={url:string;title:string;artist:string;thumbnailUrl?:string;length:number;isLive:boolean;source:number;requestedBy:string;offset?:number};
type PreviousSnapshot={guildId:string;songs:PreviousSong[];[key:string]:unknown};

// Persisted markers are read for upgrades; no old runtime is required.
export function previousDataImported(store:Store){
 return store.get('afterparty-imported',false)||store.get('muse-imported',false);
}

/** Import a read-only export atomically; a failed import remains safe to retry. */
export function importPreviousData(store:Store,dir:string,guild:string){
 if(!guild)throw new Error('Discord-serveren mangler i datamigreringen.');
 if(previousDataImported(store))return;
 const file=join(dir,'db.sqlite');
 if(!existsSync(file))return;
 const old=new DatabaseSync(file,{readOnly:true});
 try{
  store.transaction(()=>{
   const settings=old.prepare('SELECT * FROM Setting WHERE guildId=?').get(guild);
   if(settings){
    const clean:Record<string,unknown>={};
    for(const key of Object.keys(defaultSettings))if(key in settings)clean[key]=settings[key];
    for(const key of ['leaveIfNoListeners','queueAddResponseEphemeral','autoAnnounceNextSong','turnDownVolumeWhenPeopleSpeak'])if(key in clean)clean[key]=Boolean(clean[key]);
    store.set('settings',{...defaultSettings,...clean});
   }
   for(const row of old.prepare('SELECT * FROM FavoriteQuery WHERE guildId=?').all(guild)){
    store.favorite(String(row.authorId),String(row.name),String(row.query));
   }
   for(const [name,key] of [['admin-queue-snapshots.json','legacy-snapshots'],['crossfade-settings.json','legacy-crossfade']] as const){
    try{store.set(key,JSON.parse(readFileSync(join(dir,name),'utf8')));}catch{/* Optional exports may be absent; retain previously staged data. */}
   }
   const snapshots=store.get<PreviousSnapshot[]>('legacy-snapshots',[]);
   store.set('snapshots',snapshots.filter(s=>s.guildId===guild).map(s=>({...s,tracks:s.songs.map(t=>({
    id:t.url,title:t.title,artist:t.artist,image:t.thumbnailUrl??'',duration:t.length,
    live:t.isLive,embeddable:t.source===0,source:t.source===0?'youtube':'soundcloud',
    url:t.source===0?undefined:t.url,requestedBy:t.requestedBy,entryId:randomUUID(),offset:t.offset??0,
   }))})));
   const crossfade=store.get<Record<string,number>>('legacy-crossfade',{});
   if(Number.isFinite(crossfade[guild]))store.set('settings',{...store.settings(),crossfade:crossfade[guild]});
   store.set('afterparty-imported',true);
  });
 }finally{old.close();}
}
