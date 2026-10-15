import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.ts';
import {importPreviousData,previousDataImported} from '../src/data-import.ts';
import {isPlayerButton,playerAction} from '../src/player-compatibility.ts';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'afterparty-import-')),store=new Store(join(dir,'core.sqlite'));
 const old=new DatabaseSync(join(dir,'db.sqlite'));
 old.exec(`CREATE TABLE Setting(guildId TEXT,leaveIfNoListeners INTEGER); CREATE TABLE FavoriteQuery(guildId TEXT,authorId TEXT,name TEXT,query TEXT);
 INSERT INTO Setting VALUES('one',0),('two',1); INSERT INTO FavoriteQuery VALUES('one','listener','favorite','query-one'),('two','other','private','query-two');`);old.close();
 writeFileSync(join(dir,'admin-queue-snapshots.json'),JSON.stringify(['one','two'].map(guildId=>({guildId,name:'saved',songs:[{url:'video123456',title:'Synthetic',artist:'Artist',length:60,source:0,offset:12}]}))));
 writeFileSync(join(dir,'crossfade-settings.json'),JSON.stringify({one:4,two:9}));
 return {dir,store,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('offline import retains selected-server settings, favorites, saved queues and crossfade exactly once',()=>{
 const f=fixture();try{importPreviousData(f.store,f.dir,'one');assert(previousDataImported(f.store));assert.equal(f.store.settings().leaveIfNoListeners,false);assert.equal(f.store.settings().crossfade,4);assert.deepEqual(f.store.favorites().map(x=>x.query),['query-one']);const snapshots=f.store.get<{guildId:string;tracks:{offset:number;source:string}[]}[]>('snapshots',[]);assert.equal(snapshots.length,1);assert.equal(snapshots[0].guildId,'one');assert.equal(snapshots[0].tracks[0].offset,12);assert.equal(snapshots[0].tracks[0].source,'youtube');f.store.set('settings',{crossfade:7});importPreviousData(f.store,f.dir,'one');assert.equal(f.store.settings().crossfade,7);}finally{f.close();}
});
test('existing import marker prevents overwriting current user data',()=>{
 const f=fixture();try{f.store.set('muse-imported',true);f.store.set('settings',{crossfade:8});importPreviousData(f.store,f.dir,'one');assert.equal(f.store.settings().crossfade,8);assert.equal(f.store.favorites().length,0);}finally{f.close();}
});
test('failed import rolls back settings and favorites and can be retried',()=>{
 const f=fixture();try{writeFileSync(join(f.dir,'admin-queue-snapshots.json'),JSON.stringify([{guildId:'one',songs:null}]));assert.throws(()=>importPreviousData(f.store,f.dir,'one'));assert.equal(previousDataImported(f.store),false);assert.equal(f.store.favorites().length,0);assert.equal(f.store.get('settings',null),null);}finally{f.close();}
});
test('existing and current player buttons keep all actions',()=>{
 for(const prefix of ['muse','krutt'])for(const action of ['pause-resume','skip','stop','loop','shuffle','favorite','more','back10','forward30','queue']){assert(isPlayerButton(prefix+':'+action));assert.equal(playerAction(prefix+':'+action),action);}
 assert.equal(isPlayerButton('other:skip'),false);
});
