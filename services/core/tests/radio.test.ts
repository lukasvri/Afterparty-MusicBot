import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankRadio,radioArtist,radioQuery} from '../src/radio.ts';
import type {Track} from '../src/types.ts';
const track=(id:string,title:string,artist='NCS',duration=210):Track=>({id,entryId:id,title,artist,duration,image:'',live:false,embeddable:true,source:'youtube'});
const seed=track('seed','Cartoon - On & On [NCS Release]');
test('radio uses artist in title instead of an upload channel and rejects unrelated videos',()=>{
 assert.equal(radioArtist(seed),'Cartoon');
 const candidates=[track('wrong','Different Artist - Random'),track('reaction','Cartoon - Song reaction'),track('long','Cartoon - Full Set',undefined,3600),track('short','Cartoon - Teaser',undefined,30),track('same','Cartoon - On & On (Official Audio)'),track('right','Cartoon - Another Song (Official Audio)')];
 assert.deepEqual(rankRadio(seed,candidates,[],[]).map(t=>t.id),['right']);
});
test('radio excludes history, alternate uploads, blocked IDs and livestreams',()=>{
 const recent=track('old','Cartoon - Other (Music Video)');
 const candidates=[track('new-upload','Cartoon - Other (Audio)'),track('blocked','Cartoon - Third'),{...track('live','Cartoon - Live'),live:true},track('one','Cartoon - Fourth'),track('two','Cartoon - Fourth (Lyrics)')];
 assert.deepEqual(rankRadio(seed,candidates,[recent],['blocked']).map(t=>t.id),['one']);
});

test('real NCS naming variants cannot recommend the same song again',()=>{
 const original=track('seed','Cartoon, Jéja - On & On (feat. Daniel Levi) | Electronic Pop | NCS - Copyright Free Music');
 const duplicate=track('dup','Cartoon & Jéja - On & On 🎵 (feat. Daniel Levi) | Official Audio | By Audio PM');
 assert.equal(radioArtist(original),'Cartoon');assert.deepEqual(rankRadio(original,[duplicate],[],[]),[]);
});

test('radio search excludes the seed song before ranking',()=>{assert.equal(radioQuery(seed),'Cartoon audio -\"On & On\"');});

test('Topic song titles containing a dash do not become the radio artist',()=>{
 const topic=track('seed','Example Song - 2020 Remaster','Artist - Topic');
 assert.equal(radioArtist(topic),'Artist');
 assert.equal(radioQuery(topic),'Artist audio -"Example Song - 2020 Remaster"');
 assert.deepEqual(rankRadio(topic,[track('next','Another Song','Artist - Topic')],[],[]).map(t=>t.id),['next']);
});

test('radio uses matched catalog metadata rather than the uploader or video title',()=>{
 const matched={...track('seed','Promotional video title','Music uploads'),catalog:{title:'Example Song',artist:'Artist',duration:210}};
 assert.equal(radioArtist(matched),'Artist');
 assert.equal(radioQuery(matched),'Artist audio -"Example Song"');
 assert.deepEqual(rankRadio(matched,[track('next','Artist - Another Song')],[],[]).map(t=>t.id),['next']);
});

test('Topic and artist-prefixed uploads of the seed song are the same radio song',()=>{
 const topic=track('seed','Example Song','Artist - Topic');
 assert.deepEqual(rankRadio(topic,[track('duplicate','Artist - Example Song (Official Audio)')],[],[]),[]);
});
