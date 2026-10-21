import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deezerRef,loadDeezer} from '../src/deezer.ts';
import type {DeezerRef} from '../src/deezer.ts';
import {UserError} from '../src/types.ts';
import {scoreMatch} from '../src/matching.ts';
import type {Track} from '../src/types.ts';

const track=(id:number|string=1,extra:Record<string,unknown>={})=>({id,type:'track',title:'Synthetic Song',artist:{name:'Lead & Artist'},duration:180,readable:true,...extra});
const ref:DeezerRef={kind:'track',id:'1'};
const fake=(data:unknown):typeof fetch=>async()=>Response.json(data);
const safeError=(error:unknown)=>error instanceof UserError&&!error.message.includes('private-provider-secret');

test('Deezer parser accepts canonical track, album and playlist links with supported locales',()=>{
 for(const kind of ['track','album','playlist'] as const){
  for(const prefix of ['https://deezer.com/','https://www.deezer.com/en/','https://www.deezer.com/us/','https://www.deezer.com/no/'])assert.deepEqual(deezerRef(prefix+kind+'/123/'),{kind,id:'123'});
 }
 assert.equal(deezerRef('https://www.deezer.com/track/12345678901234567890')?.id,'12345678901234567890');
});

test('Deezer parser rejects host confusion, credentials, redirects and URL normalization tricks',()=>{
 for(const url of [
  'http://www.deezer.com/track/1','https://deezer.com.evil.test/track/1','https://evil.test/deezer.com/track/1',
  'https://www.deezer.com@evil.test/track/1','https://user@www.deezer.com/track/1','https://user:pass@www.deezer.com/track/1',
  'https://www.deezer.com:443/track/1','https://www.deezer.com:8080/track/1','https://www.deezer.com./track/1',
  'https://www.deezer.com/track/1#track/2','https://www.deezer.com/track/1?redirect=https://evil.test',
  'https://www.deezer.com/track/1?','https://www.deezer.com/track/1#','https://www.deezer.com/track/1\n',
  'https://www.deezer.com/album/../track/1','https://www.deezer.com/%2e%2e/track/1','https://www.deezer.com/%65n/track/1',
  'https://www.deezer.com/track/%31','https://www.deezer.com/track/0','https://www.deezer.com/track/01',
  'https://www.deezer.com/track/-1','https://www.deezer.com/track/1.5','https://www.deezer.com/track/123456789012345678901',
  'https://www.deezer.com/zz/track/1','https://www.deezer.com/artist/1','https://deezer.page.link/synthetic',
  'https://link.deezer.com/synthetic','https:\\www.deezer.com\\track\\1',' https://www.deezer.com/track/1',
 ])assert.equal(deezerRef(url),null,url);
});

test('track lookup preserves lead artist and version metadata while discarding provider IDs and URLs',async()=>{
 let requested='',options:RequestInit|undefined;
 const result=await loadDeezer(ref,1,async(url,init)=>{requested=String(url);options=init;return Response.json(track(1,{title_version:'(Live)',isrc:'usabc1200001',preview:'https://media.invalid/preview.mp3',link:'https://deezer.com/track/1',contributors:[{name:'Other'}],unknown:'discard'}),{headers:{'content-type':'application/json; charset=utf-8'}});});
 assert.equal(requested,'https://api.deezer.com/track/1');
 assert.equal(options?.redirect,'manual');assert.equal(options?.credentials,'omit');assert.equal(options?.referrerPolicy,'no-referrer');
 assert.deepEqual(options?.headers,{Accept:'application/json'});assert(options?.signal instanceof AbortSignal);assert(options.signal.aborted);
 assert.deepEqual(result,[{title:'Synthetic Song (Live)',artist:'Lead & Artist',duration:180,isrc:'USABC1200001'}]);
 assert(!JSON.stringify(result).includes('https:'));assert(!('id' in result[0]));
 assert.equal((await loadDeezer(ref,1,fake(track(1,{title:'Synthetic Song (Live)',title_version:'(Live)',isrc:'bad'}))))[0].title,'Synthetic Song (Live)');
 assert(!('isrc' in (await loadDeezer(ref,1,fake(track(1,{isrc:'bad'}))))[0]));
});

test('album and playlist pagination use fixed offsets, retain order and discard duplicates and unavailable entries',async()=>{
 for(const kind of ['album','playlist'] as const){
  const calls:string[]=[];
  const first=Array.from({length:50},(_,i)=>track(i+1,{title:'Song '+(i+1)}));
  first[0]=track(1,{readable:false});first[1]=track(2,{playable:false});
  const result=await loadDeezer({kind,id:'9'},60,async url=>{calls.push(String(url));return Response.json(calls.length===1?{data:first,total:55,next:'http://127.0.0.1/private-provider-secret'}:{data:[track(3,{title:'Duplicate'}),track(51,{title:'Song 51'}),track(52,{artist:null}),track(53,{duration:0}),track(54,{title:'Song 54'})],next:'https://evil.test',total:55});});
  assert.deepEqual(calls,[`https://api.deezer.com/${kind}/9/tracks?index=0&limit=50`,`https://api.deezer.com/${kind}/9/tracks?index=50&limit=50`]);
  assert.equal(result.length,50);assert.deepEqual(result.map(s=>s.title),[...Array.from({length:48},(_,i)=>'Song '+(i+3)),'Song 51','Song 54']);
  assert(result.every(s=>s.artist==='Lead & Artist'&&!('id' in s)));
 }
});

test('metadata pagination caps both returned songs and repeated provider pages',async()=>{
 let calls=0;
 const page=Array.from({length:50},(_,i)=>track(i+1,{title:'Song '+(i+1)}));
 const songs=await loadDeezer({kind:'playlist',id:'5'},500,async()=>{calls++;return Response.json({data:page,next:'https://evil.test',total:1000000});});
 assert.equal(calls,10);assert.equal(songs.length,50);
 calls=0;const limited=await loadDeezer({kind:'album',id:'5'},2,async()=>{calls++;return Response.json({data:page,total:500});});
 assert.equal(calls,1);assert.deepEqual(limited.map(s=>s.title),['Song 1','Song 2']);
 calls=0;await loadDeezer({kind:'album',id:'5'},500,async()=>{calls++;return Response.json({data:page,total:50});});assert.equal(calls,1);
 calls=0;const full=await loadDeezer({kind:'playlist',id:'5'},500,async()=>{const offset=calls++*50;return Response.json({data:Array.from({length:50},(_,i)=>track(offset+i+1,{title:'Song '+(offset+i+1)})),total:1000});});
 assert.equal(calls,10);assert.equal(full.length,500);assert.equal(full[499].title,'Song 500');
});

test('invalid metadata entries are skipped and an empty playable catalog is a user error',async()=>{
 const invalid=[null,[],{},track(0),track('01'),track(Number.MAX_SAFE_INTEGER+1),track(1,{duration:'180'}),track(1,{duration:0}),track(1,{duration:-1}),track(1,{duration:86401}),track(1,{duration:NaN}),track(1,{artist:{name:''}}),track(1,{title:' '}),track(1,{title:'a'.repeat(501)}),track(1,{artist:{name:'a'.repeat(301)}}),track(1,{title:'Bad\u0000title'}),track(1,{type:'episode'}),track(1,{readable:false}),track(1,{playable:false})];
 await assert.rejects(loadDeezer({kind:'playlist',id:'1'},20,fake({data:invalid})),/no available songs/);
 const songs=await loadDeezer({kind:'album',id:'1'},20,fake({data:[...invalid,track('12345678901234567890',{title:'Valid',isrc:'GBABC9900001'})]}));
 assert.deepEqual(songs,[{title:'Valid',artist:'Lead & Artist',duration:180,isrc:'GBABC9900001'}]);
});

test('invalid references and limits cannot construct requests',async()=>{
 let calls=0;const request:typeof fetch=async()=>{calls++;return Response.json(track());};
 for(const bad of [{kind:'track',id:'1/../../evil'},{kind:'track',id:'0'},{kind:'evil',id:'1'},null])await assert.rejects(loadDeezer(bad as DeezerRef,1,request),/Invalid Deezer/);
 for(const limit of [0,-1,501,Infinity,NaN,1.5])await assert.rejects(loadDeezer(ref,limit,request),/limit/);
 assert.equal(calls,0);
});

test('HTTP failures, redirects, API errors and malformed bodies expose only safe user errors',async()=>{
 const responses=[
  ()=>new Response('private-provider-secret',{status:500}),
  ()=>new Response('private-provider-secret',{status:302,headers:{location:'http://127.0.0.1/secret'}}),
  ()=>Response.json({error:{message:'private-provider-secret'}}),
  ()=>new Response('{"private-provider-secret":',{headers:{'content-type':'application/json'}}),
  ()=>Response.json(null),()=>Response.json([]),
  ()=>new Response('<html>private-provider-secret</html>',{headers:{'content-type':'text/html'}}),
 ];
 for(const response of responses)await assert.rejects(loadDeezer(ref,1,async()=>response()),safeError);
 await assert.rejects(loadDeezer(ref,1,async()=>{throw Error('private-provider-secret');}),safeError);
 await assert.rejects(loadDeezer(ref,1,async()=>{throw new UserError('private-provider-secret');}),safeError);
 await assert.rejects(loadDeezer(ref,1,async()=>new Response('private-provider-secret',{status:429})),error=>safeError(error)&&(error as UserError).status===429);
 await assert.rejects(loadDeezer({kind:'album',id:'1'},1,fake({data:'private-provider-secret'})),safeError);
 await assert.rejects(loadDeezer({kind:'album',id:'1'},1,fake({data:Array(51).fill(track())})),safeError);
});

test('responses already redirected or reporting another response URL are rejected',async()=>{
 for(const property of ['redirected','url']){
  const response=Response.json(track());Object.defineProperty(response,property,{value:property==='redirected'?true:'https://evil.test/private-provider-secret'});
  await assert.rejects(loadDeezer(ref,1,async()=>response),safeError);
 }
});

test('oversized advertised and streamed bodies are bounded and cancelled',async()=>{
 let advertisedCancelled=false;
 await assert.rejects(loadDeezer(ref,1,async()=>new Response(new ReadableStream({cancel(){advertisedCancelled=true;}}),{headers:{'content-length':String(512*1024+1)}})),safeError);
 let streamedCancelled=false;
 await assert.rejects(loadDeezer(ref,1,async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(512*1024));controller.enqueue(new Uint8Array(1));},cancel(){streamedCancelled=true;}}))),safeError);
 assert(streamedCancelled);assert(advertisedCancelled);
});

test('timeouts bound a stalled fetch and stalled stream even when a mock ignores the fetch signal',async t=>{
 for(const stall of ['fetch','stream']){
  const timeout=new AbortController();t.mock.method(AbortSignal,'timeout',()=>timeout.signal);
  let streamCancelled=false;
  const pending=loadDeezer(ref,1,async()=>{
   if(stall==='fetch'){queueMicrotask(()=>timeout.abort());return await new Promise<Response>(()=>{});}
   return new Response(new ReadableStream({pull(){queueMicrotask(()=>timeout.abort());},cancel(){streamCancelled=true;}}));
  });
  await assert.rejects(pending,safeError);if(stall==='stream')assert(streamCancelled);
  t.mock.restoreAll();
 }
});

test('the overall deadline aborts requests independently of individual request timeouts',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});t.mock.method(AbortSignal,'timeout',()=>new AbortController().signal);
 let signal:AbortSignal|null|undefined;
 const pending=loadDeezer(ref,1,async(_url,init)=>{signal=init?.signal;return await new Promise<Response>(()=>{});});
 t.mock.timers.tick(30000);await assert.rejects(pending,safeError);assert(signal?.aborted);
});

test('version metadata stays bounded and malformed or hidden controls cannot alter matching',async()=>{
 for(const extra of [{title:'x'.repeat(499),title_version:'(Live)'},{title_version:'x'.repeat(201)},{title_version:123},{title:'Synthetic\u202e Song'},{artist:{name:'Artist\u200b'}}])await assert.rejects(loadDeezer(ref,1,fake(track(1,extra))),/no available songs/);
});

test('explicit live versions cannot be hidden inside the title or mistaken for an opening title word',async()=>{
 for(const title of ['Alive','Live Forever']){
  const [song]=await loadDeezer(ref,1,fake(track(1,{title,title_version:'Live'})));
  assert.equal(song.title,title+' Live');
  const studio:Track={id:'abcdefghijk',entryId:'synthetic',title,artist:'Lead & Artist',duration:180,image:'',live:false,embeddable:true,source:'youtube'};
  if(title==='Alive')assert.equal(scoreMatch(song,studio),0);
 }
 for(const [title,version] of [['Alive (Live)','(Live)'],['Alive (Live)','Live'],['Alive [Live]','Live'],['Alive Live','Live'],['Alive (Radio Edit)','(Radio Edit)']]){
  assert.equal((await loadDeezer(ref,1,fake(track(1,{title,title_version:version}))))[0].title,title);
 }
 await assert.rejects(loadDeezer(ref,1,fake(track(1,{title:'x'.repeat(496)+'Live',title_version:'Live'}))),/no available songs/);
});
