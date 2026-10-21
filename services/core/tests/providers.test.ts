import type {YouTubeResponses} from '../src/external-types.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store} from '../src/store.ts';import {Providers} from '../src/providers.ts';
import {scoreMatch,mapLimited} from '../src/matching.ts';import {spotifyRef,SpotifyCatalog,expandSpotifyLink} from '../src/spotify.ts';
import {soundcloudUrl,resolveSoundcloud} from '../src/soundcloud.ts';import {Recommendations} from '../src/recommendations.ts';
import {audioBitrate} from '../src/audio.ts';import type {Track} from '../src/types.ts';
import {deferred} from './deferred.ts';
const source={id:'4uLU6hMCjMI75M1A2tKUQC',isrc:'GBARL9300135',title:'Example Song',artist:'Artist',duration:200};
const track=(title='Artist - Example Song',id='abcdefghijk'):Track=>({id,title,artist:'Artist - Topic',duration:200,entryId:id,image:'',live:false,embeddable:true,source:'youtube'});
const setup=()=>{const dir=mkdtempSync(join(tmpdir(),'gutta-provider-'));const store=new Store(join(dir,'db.sqlite'));return {store,close:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};};

test('concurrent identical searches share one lookup and return independent queue entry identities',async()=>{
 const t=setup(),gate=deferred<void>();try{
  const p=new Providers(t.store,{});let calls=0;
  p.youtube=async <K extends keyof YouTubeResponses>()=>{calls++;await gate.promise;return {items:[{id:{videoId:'abcdefghijk'}}]} as YouTubeResponses[K];};
  p.video=async()=>[track()];
  const pending=Array.from({length:20},()=>p.search('Artist audio',8,true));
  gate.resolve();const results=await Promise.all(pending);
  assert.equal(calls,1);assert(results.every(tracks=>tracks[0].id==='abcdefghijk'));
  assert.equal(new Set(results.map(tracks=>tracks[0].entryId)).size,20);
  await p.search('Artist audio',8,true);assert.equal(calls,1);
 }finally{gate.resolve();t.close();}
});
test('YouTube HTML entities decode without double-unescaping ampersands',async()=>{
 const t=setup();try{
  const p=new Providers(t.store,{});
  p.youtube=async <K extends keyof YouTubeResponses>(path: K)=>path==='search'
   ? {items:[{id:{videoId:'abcdefghijk'}}]} as YouTubeResponses[K]
   : {items:[{id:'abcdefghijk',snippet:{title:'&amp;quot;Quoted&amp;quot;',channelTitle:'A &amp; B',description:'',categoryId:'10',liveBroadcastContent:'none'},contentDetails:{duration:'PT3M'},status:{embeddable:true}}]} as YouTubeResponses[K];
  const [result]=await p.search('encoded entities',1);
  assert.equal(result.title,'&quot;Quoted&quot;');
  assert.equal(result.artist,'A & B');
 }finally{t.close();}
});
test('a failed shared search is released so the next request can recover',async()=>{
 const t=setup();try{
  const p=new Providers(t.store,{});let calls=0;
  p.youtube=async()=>{calls++;throw Error('synthetic unavailable API');};
  p.extract=async()=>{throw Error('synthetic unavailable extractor');};
  const failed=await Promise.allSettled([p.search('Artist audio'),p.search('Artist audio')]);
  assert(failed.every(result=>result.status==='rejected'));assert.equal(calls,1);
  p.youtube=async <K extends keyof YouTubeResponses>()=>{calls++;return {items:[{id:{videoId:'abcdefghijk'}}]} as YouTubeResponses[K];};p.video=async()=>[track()];
  assert.equal((await p.search('Artist audio'))[0].id,'abcdefghijk');assert.equal(calls,2);
 }finally{t.close();}
});
test('matching rejects different versions, substrings, wrong durations and supports ISRC metadata',()=>{
 assert(scoreMatch(source,track())>.9);
 for(const suffix of ['Live','Remix','Acoustic','Karaoke','Cover','Slowed','Sped Up','Instrumental'])assert.equal(scoreMatch(source,track('Artist - Example Song '+suffix)),0);
 assert.equal(scoreMatch({...source,artist:'Art'},track()),0);
 assert.equal(scoreMatch(source,{...track(),duration:240}),0);
 assert(scoreMatch({...source,title:'Example Song Remix'},track('Artist - Example Song Remix'))>.9);
});
test('Spotify references support URI and regional URLs without accepting spoofed hosts',async()=>{
 for(const url of ['spotify:track:'+source.id,'https://open.spotify.com/intl-no/track/'+source.id+'?si=x'])assert.equal(spotifyRef(url)?.id,source.id);
 assert.equal(spotifyRef('https://evil.test/open.spotify.com/track/'+source.id),null);
 assert.equal(spotifyRef('https://open.spotify.com.evil.test/track/'+source.id),null);
 await assert.rejects(expandSpotifyLink('https://spotify.link/test',async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1:3990'}})),/Invalid/);
});

test('version words in a title or artist credit cannot substitute for an explicit recording version',()=>{
 for(const title of ['Live Forever','Live Forever With A Long Completely Distinct Song Title']){
  const live={...source,title:title+' Live'};
  assert.equal(scoreMatch(live,track('Artist - '+title)),0);
  assert(scoreMatch(live,track('Artist - '+title+' (Live)'))>.9);
 }
 const liveArtist={...source,artist:'Live',title:'Live Forever Live'};
 assert.equal(scoreMatch(liveArtist,{...track('Live - Live Forever'),artist:'Live - Topic'}),0);
 assert(scoreMatch(liveArtist,{...track('Live - Live Forever (Live)'),artist:'Live - Topic'})>.9);
 assert(scoreMatch({...liveArtist,title:'Live Forever'},{...track('Live Forever'),artist:'Live - Topic'})>.9);
});
test('Spotify paginates in order and ignores episodes and local files',async()=>{
 const song=(id:string)=>({id,name:'Song '+id,artists:[{name:'Artist'}],duration_ms:200000,type:'track',external_ids:{isrc:source.isrc}});const calls:string[]=[];
 const fake=async(url:Parameters<typeof fetch>[0])=>{calls.push(String(url));if(String(url).includes('/api/token'))return Response.json({access_token:'test',expires_in:3600});if(String(url).includes('offset=2'))return Response.json({items:[{item:song('two')}],next:null});return Response.json({items:[{track:song('one')},{track:{...song('local'),is_local:true}},{track:{...song('podcast'),type:'episode'}}],next:'https://api.spotify.com/v1/playlists/list/items?offset=2'});};
 const p=new SpotifyCatalog('id','secret',fake as typeof fetch);const songs=await p.load('playlist','list',3);assert.deepEqual(songs.map(t=>t.id),['one','two']);assert.equal(songs[0].isrc,source.isrc);assert.equal(calls.filter(s=>s.includes('/api/token')).length,1);
});
test('matching uses ISRC first, verifies candidate and caches a fresh entry identity',async()=>{
 const t=setup();try{const p=new Providers(t.store,{});const queries:string[]=[];p.search=async q=>{queries.push(q);return [track()]};p.video=async()=>[track()];const a=await p.matchSong(source),b=await p.matchSong(source);assert.deepEqual(queries,['"'+source.isrc+'"']);assert.equal(a.catalog?.id,source.id);assert.notEqual(a.entryId,b.entryId);
 p.search=async q=>q.includes(source.isrc)?[track('Artist - Example Song Live')]:[track()];await p.matchSong({...source,id:'different'});
 }finally{t.close();}
});

test('Deezer metadata is opt-in and uses strict existing source matching without Spotify enrichment or preview playback',async t=>{
 const f=setup();try{
  let fetches=0,enrichments=0;const queries:string[]=[];
  t.mock.method(globalThis,'fetch',async()=>{fetches++;return Response.json({id:123,title:'Example Song',duration:200,readable:true,artist:{name:'Artist'},isrc:source.isrc,preview:'https://untrusted.example/secret.mp3'});});
  for(const value of [undefined,'0','true','yes'])for(const query of ['https://www.deezer.com/track/123','https://www.deezer.com/track/123?utm_source=user_sharing','https://link.deezer.com/s/synthetic?utm_medium=desktop'])await assert.rejects(new Providers(f.store,{DEEZER_METADATA:value}).resolve(query),/not enabled/);
  assert.equal(fetches,0,'disabled imports never contact the provider');
  const p=new Providers(f.store,{DEEZER_METADATA:'1'});
  t.mock.method(p.spotifyCatalog,'enrich',async()=>{enrichments++;throw Error('must not enrich Deezer as Spotify');});
  p.search=async query=>{queries.push(query);return [track('Artist - Example Song Live'),track()];};p.video=async()=>[track()];
  const first=await p.resolve('https://www.deezer.com/track/123'),second=await p.resolve('https://www.deezer.com/track/123');
  assert.equal(first[0].id,'abcdefghijk');assert.equal(first[0].source,'youtube');
  assert.equal(first[0].catalog?.isrc,source.isrc);assert.equal(first[0].catalog?.id,undefined);assert.equal(enrichments,0);
  assert.deepEqual(queries,['"'+source.isrc+'"']);assert.notEqual(first[0].entryId,second[0].entryId);
  assert.equal(JSON.stringify(first).includes('secret.mp3'),false);assert.equal(fetches,2);
  p.search=async()=>[track('Artist - Different Song')];p.video=async()=>[];
  await assert.rejects(p.resolve('https://www.deezer.com/track/123'),/reliable audio match/);
  const before=fetches;await assert.rejects(p.resolve('https://www.deezer.com.evil.test/track/123'),/Use a/);assert.equal(fetches,before);
 }finally{f.close();}
});
test('enabled Deezer sharing links discard tracking and retain strict source matching after bounded expansion',async t=>{
 const f=setup();try{
  const requests:string[]=[],queries:string[]=[];
  t.mock.method(globalThis,'fetch',async(url:Parameters<typeof fetch>[0])=>{
   requests.push(String(url));
   if(String(url)==='https://link.deezer.com/s/synthetic')return new Response(null,{status:302,headers:{location:'https://www.deezer.com/en/track/123?utm_source=user_sharing'}});
   assert.equal(String(url),'https://api.deezer.com/track/123');
   return Response.json({id:123,title:'Example Song',duration:200,readable:true,artist:{name:'Artist'},isrc:source.isrc,preview:'https://untrusted.example/secret.mp3'});
  });
  const p=new Providers(f.store,{DEEZER_METADATA:'1'});
  t.mock.method(p.spotifyCatalog,'enrich',async()=>{throw Error('Deezer must not use Spotify identifiers');});
  p.search=async query=>{queries.push(query);return [track('Artist - Example Song Live'),track()];};p.video=async()=>[track()];
  const [matched]=await p.resolve('https://link.deezer.com/s/synthetic?utm_campaign=clipboard-generic');
  assert.deepEqual(requests,['https://link.deezer.com/s/synthetic','https://api.deezer.com/track/123']);
  assert.deepEqual(queries,['"'+source.isrc+'"']);assert.equal(matched.id,'abcdefghijk');assert.equal(matched.catalog?.id,undefined);assert(!JSON.stringify(matched).includes('secret.mp3'));
  requests.length=0;await p.resolve('https://www.deezer.com/track/123?utm_source=deezer&utm_content=track-123');assert.deepEqual(requests,['https://api.deezer.com/track/123']);
  const before=requests.length;await assert.rejects(p.resolve('https://link.deezer.com.evil.test/s/synthetic'),/Use a/);assert.equal(requests.length,before);
 }finally{f.close();}
});
test('Deezer playlist imports preserve order and keep at most three recording matches active',async t=>{
 const f=setup(),gates=Array.from({length:4},()=>deferred<void>()),firstThree=deferred<void>(),fourth=deferred<void>();
 try{
  t.mock.method(globalThis,'fetch',async()=>Response.json({data:Array.from({length:4},(_,i)=>({id:i+1,title:'Song '+i,artist:{name:'Artist'},duration:200})),total:4}));
  const p=new Providers(f.store,{DEEZER_METADATA:'1'}),started:number[]=[];let active=0,maxActive=0;
  p.matchSong=async song=>{
   const index=Number(song.title.slice(5));started.push(index);active++;maxActive=Math.max(maxActive,active);
   if(started.length===3)firstThree.resolve();if(index===3)fourth.resolve();
   try{await gates[index].promise;return track('Artist - '+song.title);}finally{active--;}
  };
  const pending=p.resolve('https://www.deezer.com/playlist/123?utm_source=user_sharing');
  await firstThree.promise;assert.deepEqual(started,[0,1,2]);assert.equal(active,3);
  gates[2].resolve();await fourth.promise;assert.deepEqual(started,[0,1,2,3]);
  gates[3].resolve();gates[1].resolve();gates[0].resolve();
  assert.deepEqual((await pending).map(song=>song.title),['Artist - Song 0','Artist - Song 1','Artist - Song 2','Artist - Song 3']);assert.equal(maxActive,3);
 }finally{gates.forEach(gate=>gate.resolve());f.close();}
});
test('bounded matching preserves playlist order despite out-of-order completion',async()=>{const out=await mapLimited([20,0,5],2,async n=>{await new Promise(r=>setTimeout(r,n));return n;});assert.deepEqual(out,[20,0,5]);});
const sc=(id:string)=>({id,title:'Sound '+id,uploader:'Artist',duration:180,webpage_url:'https://soundcloud.com/artist/'+id,thumbnail:'https://example.test/image'});
test('SoundCloud supports search, share URLs and sets with a bounded ordered playlist',async()=>{
 assert(soundcloudUrl('https://on.soundcloud.com/test'));assert(!soundcloudUrl('https://soundcloud.com.evil.test/test'));
 const args:string[][]=[];const extract=async(a:string[])=>{args.push(a);return {entries:[sc('one'),sc('two')]}};
 const songs=await resolveSoundcloud('https://soundcloud.com/artist/sets/set',2,extract);assert.deepEqual(songs.map(t=>t.id),['one','two']);assert(songs.every(t=>t.source==='soundcloud'&&!t.embeddable));
 const search=await resolveSoundcloud('sc: some music',50,extract);assert.equal(search.length,1);assert(args.at(-1)?.includes('scsearch5:some music'));
 await assert.rejects(resolveSoundcloud('https://soundcloud.com/artist/blocked',1,async()=>({...sc('blocked'),is_preview:true})),/preview/);
});
test('Last.fm uses a bounded cached lookup and preserves metadata-only privacy',async()=>{
 const t=setup();try{let calls=0;const r=new Recommendations(t.store,'test',async()=>{calls++;return Response.json({similartracks:{track:[{name:'Other Song',artist:{name:'Other Artist'},match:'0.8'}]}})});const seed={...track(),catalog:source};assert.equal((await r.similar(seed))[0].artist,'Other Artist');await r.similar(seed);assert.equal(calls,1);assert.deepEqual(await new Recommendations(t.store,'').similar(seed),[]);}finally{t.close();}
});
test('audio bitrate follows requested quality and the actual voice channel ceiling',()=>{
 assert.equal(audioBitrate(256000,192),192000);assert.equal(audioBitrate(64000,192),64000);assert.equal(audioBitrate(384000,384),384000);assert.equal(audioBitrate(NaN,192),64000);
});

test('public Spotify embed fallback is retained while rate limits are not retried through it',async()=>{
 let embeds=0;
 const fake=async(url:Parameters<typeof fetch>[0])=>{if(String(url).includes('/embed/')){embeds++;return new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{state:{data:{entity:{trackList:[{title:'Song',subtitle:'Artist',duration:200000}]}}}}}})+'</script>');}return new Response('',{status:403});};
 const p=new SpotifyCatalog('','',fake as typeof fetch);assert.equal((await p.load('playlist','test',5))[0].title,'Song');assert.equal(embeds,1);
 const rateLimited=new SpotifyCatalog('id','secret',async(url:Parameters<typeof fetch>[0])=>String(url).includes('/api/token')?Response.json({access_token:'test',expires_in:3600}):new Response('',{status:429}));await assert.rejects(rateLimited.load('playlist','test',5),/busy/);
});

test('radio uses Last.fm, prioritizes favorites, excludes skipped suggestions and falls back on provider failure',async()=>{
 const t=setup();try{
  const p=new Providers(t.store,{LASTFM_API_KEY:'test'}),seed=track();
  p.search=async()=>[];p.recommendations.topTracks=async()=>[];
  p.recommendations.similar=async()=>[{title:'Other',artist:'Artist',duration:200},{title:'Favorite',artist:'Artist',duration:200}];
  p.matchSong=async song=>track('Artist - '+song.title,song.title==='Favorite'?'favorite001':'other000001');
  t.store.favorite('listener','Artist - Favorite','https://youtube.com/watch?v=favorite001');
  assert.equal((await p.radio(seed,[]))?.id,'favorite001');
  t.store.set('radio-skips',{favorite001:Date.now()});assert.equal((await p.radio(seed,[]))?.id,'other000001');
  p.recommendations.similar=async()=>{throw Error('Last.fm unavailable')};p.search=async()=>[track('Artist - Fallback','fallback001')];
  assert.equal((await p.radio(seed,[]))?.id,'fallback001');
 }finally{t.close();}
});

test('concert radio falls back past incompatible recommendations to an embeddable video',async()=>{
 const t=setup();try{
  const p=new Providers(t.store,{LASTFM_API_KEY:'synthetic-key'}),seed={...track(),concert:true};
  p.recommendations.topTracks=async()=>[];
  p.recommendations.similar=async()=>[{title:'Audio only',artist:'Artist',duration:200}];
  p.matchSong=async()=>({...track('Artist - Audio only','audio'),source:'soundcloud',embeddable:false});
  p.search=async()=>[{...track('Artist - Blocked','blocked'),embeddable:false},track('Artist - Next','next')];
  assert.equal((await p.radio(seed,[]))?.id,'next');
 }finally{t.close();}
});

test('Last.fm handles Topic tracks whose titles omit the artist',async()=>{
 const t=setup();try{let queried='';const r=new Recommendations(t.store,'test',async(url:Parameters<typeof fetch>[0])=>{queried=String(url);return Response.json({similartracks:{track:[]}})});await r.similar(track('Example Song'));const query=new URL(queried);assert.equal(query.searchParams.get('track'),'Example Song');assert.equal(query.searchParams.get('artist'),'Artist');}finally{t.close();}
});

test('Last.fm preserves a hyphenated Topic title while using the actual artist',async()=>{
 const t=setup();try{
  let queried='';const r=new Recommendations(t.store,'synthetic-key',async(url:Parameters<typeof fetch>[0])=>{queried=String(url);return Response.json({similartracks:{track:[]}});});
  await r.similar(track('Example Song - Remastered'));
  const query=new URL(queried);assert.equal(query.searchParams.get('artist'),'Artist');assert.equal(query.searchParams.get('track'),'Example Song - Remastered');
 }finally{t.close();}
});

test('YouTube search falls back on quota failure and preserves literal query semantics in its cache',async()=>{
 const t=setup();try{const p=new Providers(t.store,{});let searches=0;p.youtube=async <K extends keyof YouTubeResponses>(path:K)=>{if(path==='search')throw Error('quota');return {items:[{id:'abcdefghijk',snippet:{title:'Song',channelTitle:'Artist'},contentDetails:{duration:'PT3M20S'},status:{embeddable:true}}]} as YouTubeResponses[K];};p.extract=async args=>{searches++;assert(args.some(a=>a.startsWith('ytsearch')));return {entries:[{id:'abcdefghijk'}]};};
 assert.equal((await p.search('Artist audio -"Song"',5))[0].id,'abcdefghijk');await p.search('Artist audio -"Song"',5);assert.equal(searches,1);await p.search('Artist audio Song',5);assert.equal(searches,2);
 }finally{t.close();}
});

test('bounded extractor queue releases slots when a waiting request is cancelled',async()=>{
 const {runJson}=await import('../src/providers.ts');
 const occupied=Array.from({length:4},()=>runJson(process.execPath,['-e','setTimeout(()=>process.stdout.write("{}"),150)']));
 const controller=new AbortController(),queued=runJson(process.execPath,['-e','process.stdout.write("{}")'],controller.signal);controller.abort();await assert.rejects(queued,/cancelled|busy/);await Promise.all(occupied);assert.deepEqual(await runJson(process.execPath,['-e','process.stdout.write("{}")']),{});
});

test('radio search survives an unavailable candidate in the no-key extractor fallback',async()=>{
 const t=setup();try{
  const p=new Providers(t.store,{}),seed={...track('Syn Cole - Feel Good | Future House | NCS - Copyright Free','seed1234567'),artist:'NCS',concert:true};
  p.youtube=async()=>{throw Error('API unavailable');};
  p.extract=async args=>{
   if(args.some(arg=>arg.startsWith('ytsearch')))return {entries:[{id:'next1234567'},{id:'other123456'},{id:'blocked1234'}]};
   const id=new URL(args.at(-1)!).searchParams.get('v');
   if(id==='blocked1234')throw Error('Video unavailable');
   return {title:'Other Artist - Synthetic '+id+' | Future House',artist:'Syn Cole',duration:200,playable_in_embed:true};
  };
  const next=await p.radio(seed,[]);assert.equal(next?.id,'next1234567');assert.equal(next?.embeddable,true);
  await assert.rejects(p.video(['blocked1234']),/Video unavailable/);
 }finally{t.close();}
});

test('empty cached searches are refreshed so a radio retry can recover',async()=>{
 const t=setup();try{
  const p=new Providers(t.store,{}),query='Syn Cole audio -"Feel Good"';let calls=0;
  t.store.set('search:v2:'+JSON.stringify([query.toLowerCase(),20,true]),{at:Date.now(),tracks:[]});
  p.youtube=async <K extends keyof YouTubeResponses>()=>{calls++;return {items:[{id:{videoId:'next1234567'}}]} as YouTubeResponses[K];};
  p.video=async()=>[track('Syn Cole - Synthetic Next','next1234567')];
  assert.equal((await p.search(query,20,true))[0]?.id,'next1234567');assert.equal(calls,1);
  await p.search(query,20,true);assert.equal(calls,1);
 }finally{t.close();}
});

test('video metadata retains explicit genre tags for unlabelled song titles',async()=>{
 const t=setup();try{
  const p=new Providers(t.store,{});
  p.youtube=async <K extends keyof YouTubeResponses>()=>({items:[{id:'abcdefghijk',snippet:{title:'Artist - Song',channelTitle:'Publisher',tags:['future house'],description:'Genre: Future House\nNew release'},contentDetails:{duration:'PT3M20S'},status:{embeddable:true}}]} as YouTubeResponses[K]);
  const [video]=await p.video(['abcdefghijk']);
  assert.deepEqual(video.genres,['future house']);
 }finally{t.close();}
});
