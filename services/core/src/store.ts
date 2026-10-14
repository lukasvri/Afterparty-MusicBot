import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaultSettings,type Settings,type Track,type PublicTrack} from './types.ts';
export class Store{
 db:DatabaseSync;
 constructor(file:string){mkdirSync(dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,video TEXT NOT NULL,at INTEGER NOT NULL,sent INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS favorites(id TEXT PRIMARY KEY,author TEXT NOT NULL,name TEXT NOT NULL,query TEXT NOT NULL,UNIQUE(author,name));
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL,result TEXT NOT NULL,at INTEGER NOT NULL,sent INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS history_at ON history(at); CREATE INDEX IF NOT EXISTS history_pending ON history(at) WHERE sent=0; CREATE INDEX IF NOT EXISTS jobs_at ON jobs(at); CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(at) WHERE sent=0 AND status IN ('done','failed','unknown'); UPDATE jobs SET status='unknown',result='Prosessen startet på nytt før resultatet var bekreftet.' WHERE status='processing';`);}
 get<T>(key:string,fallback:T):T{const row=this.db.prepare('SELECT value FROM kv WHERE key=?').get(key) as {value:string}|undefined;try{return row?JSON.parse(row.value):fallback;}catch{return fallback;}}
 set(key:string,value:unknown){this.db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
 transaction(fn:()=>void){this.db.exec('SAVEPOINT core_write');try{fn();this.db.exec('RELEASE core_write');}catch(error){this.db.exec('ROLLBACK TO core_write; RELEASE core_write');throw error;}}
 setMany(values:Record<string,unknown>){this.transaction(()=>{for(const [key,value] of Object.entries(values))this.set(key,value);});}
 settings():Settings{return {...defaultSettings,...this.get<Partial<Settings>>('settings',{})};}
 record(id:string,video:PublicTrack,at=Date.now()){this.db.prepare('INSERT OR IGNORE INTO history(id,video,at) VALUES(?,?,?)').run(id,JSON.stringify(video),at);}
 history(limit=20){return this.db.prepare('SELECT id,video,at FROM history ORDER BY at DESC LIMIT ?').all(limit).map(r=>({id:String(r.id),video:JSON.parse(String(r.video)) as PublicTrack,at:Number(r.at)}));}
 events(){return this.db.prepare('SELECT id,video,at FROM history WHERE sent=0 ORDER BY at LIMIT 20').all().map(r=>({id:String(r.id),video:JSON.parse(String(r.video)),at:Number(r.at)}));}
 acknowledge(ids:string[]){const q=this.db.prepare('UPDATE history SET sent=1 WHERE id=?');if(ids.length)this.transaction(()=>{for(const id of ids)q.run(id);});}
 favorites(author?:string){return this.db.prepare(`SELECT id,author,name,query FROM favorites ${author?'WHERE author=?':''} ORDER BY name`).all(...(author?[author]:[])) as {id:string;author:string;name:string;query:string}[];}
 favorite(author:string,name:string,query:string){this.db.prepare('INSERT INTO favorites VALUES(?,?,?,?) ON CONFLICT(author,name) DO UPDATE SET query=excluded.query').run(randomUUID(),author,name.slice(0,80),query.slice(0,2000));}
 removeFavorite(author:string,name:string){this.db.prepare('DELETE FROM favorites WHERE author=? AND name=?').run(author,name);}
 job(id:string,payload:unknown){const previous=this.db.prepare('SELECT status,result FROM jobs WHERE id=?').get(id);if(previous)return previous as {status:string;result:string};this.db.prepare("INSERT INTO jobs(id,payload,status,result,at) VALUES(?,?,'processing','',?)").run(id,JSON.stringify(payload),Date.now());return null;}
 finishJob(id:string,status:string,result:string){this.db.prepare('UPDATE jobs SET status=?,result=? WHERE id=?').run(status,result.slice(0,250),id);}
 bridgeResults(){return this.db.prepare("SELECT id,payload,status,result FROM jobs WHERE sent=0 AND status IN ('done','failed','unknown') ORDER BY at LIMIT 20").all().filter(r=>JSON.parse(String(r.payload)).bridge).map(r=>({id:String(r.id),ok:r.status==='done',message:String(r.result)}));}
 acknowledgeJobs(ids:string[]){const q=this.db.prepare('UPDATE jobs SET sent=1 WHERE id=?');if(ids.length)this.transaction(()=>{for(const id of ids)q.run(id);});}
 jobs(){return this.db.prepare('SELECT id,payload,status,result,at AS createdAt FROM jobs ORDER BY at DESC LIMIT 30').all().map(r=>({...r,payload:JSON.parse(String(r.payload))}));}
 importMuse(dir:string,guild:string){if(!guild)throw new Error('Discord-serveren mangler i datamigreringen.');if(this.get('muse-imported',false))return;const file=join(dir,'db.sqlite');if(!existsSync(file))return;const old=new DatabaseSync(file,{readOnly:true});try{const settings=old.prepare('SELECT * FROM Setting WHERE guildId=?').get(guild);if(settings){const clean:Record<string,unknown>={};for(const key of Object.keys(defaultSettings))if(key in settings)clean[key]=settings[key];for(const key of ['leaveIfNoListeners','queueAddResponseEphemeral','autoAnnounceNextSong','turnDownVolumeWhenPeopleSpeak'])if(key in clean)clean[key]=Boolean(clean[key]);this.set('settings',{...defaultSettings,...clean});}for(const r of old.prepare('SELECT * FROM FavoriteQuery WHERE guildId=?').all(guild))this.favorite(String(r.authorId),String(r.name),String(r.query));
 for(const [name,key] of [['admin-queue-snapshots.json','legacy-snapshots'],['crossfade-settings.json','legacy-crossfade']] as const){try{this.set(key,JSON.parse(readFileSync(join(dir,name),'utf8')));}catch{}}
 const legacy=this.get<any[]>('legacy-snapshots',[]);this.set('snapshots',legacy.filter(s=>s.guildId===guild).map(s=>({...s,tracks:s.songs.map((t:any)=>({id:t.url,title:t.title,artist:t.artist,image:t.thumbnailUrl??'',duration:t.length,live:t.isLive,embeddable:t.source===0,source:t.source===0?'youtube':'soundcloud',url:t.source===0?undefined:t.url,requestedBy:t.requestedBy,entryId:randomUUID(),offset:t.offset??0}))})));const crossfade=this.get<Record<string,number>>('legacy-crossfade',{});if(Number.isFinite(crossfade[guild]))this.set('settings',{...this.settings(),crossfade:crossfade[guild]});this.set('muse-imported',true);}finally{old.close();}}
 close(){this.db.close();}
}
