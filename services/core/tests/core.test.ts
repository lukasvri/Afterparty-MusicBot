import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.ts';
import {Engine,positionFromSegments} from '../src/engine.ts';
import {Commands} from '../src/commands.ts';
import {Providers,scoreMatch,youtubeId} from '../src/providers.ts';
import {mixPcm,FRAME_BYTES,type Sink,type Prepared,type PcmDecoder} from '../src/audio.ts';
import {deferred} from './deferred.ts';
import type {Track} from '../src/types.ts';
import {parseTime} from '../src/discord.ts';
const track=(id='abcdefghijk',entryId=id):Track=>({id,entryId,title:'Example song',artist:'Artist',duration:200,image:'',live:false,embeddable:true,source:'youtube'});
class FakeSink implements Sink{ms=0;playing=true;onIdle:((id:string)=>void)|null=null;onError:((e:Error,id:string)=>void)|null=null;play(){this.ms=0;this.playing=true;}pause(){this.playing=false;}resume(){this.playing=true;}stop(){this.ms=0;this.playing=false;}duration(){return this.ms;}advancing(){return this.playing;}buffering(){return false;}}

test('a long-running mix releases consumed segments while retaining the audible and future clocks',()=>{
 const t=setup();try{
  t.engine.settings.radio=false;t.engine.connected=true;
  const segments=Array.from({length:1002},(_,i)=>({track:track('abcdefghijk','entry:'+i),startFrame:i*500,offset:i%7}));
  t.engine.segments=[...segments];t.sink.ms=(1000*500+100)*20;
  const expected=positionFromSegments(segments,t.sink.ms);
  t.engine.tick();
  assert.equal(t.engine.segments.length,2);
  assert.deepEqual(positionFromSegments(t.engine.segments,t.sink.ms),expected);
  assert.equal(t.engine.current?.entryId,'entry:1000');
  t.sink.ms=1001*500*20;t.engine.tick();
  assert.equal(t.engine.segments.length,1);
  assert.equal(t.engine.current?.entryId,'entry:1001');
  assert.deepEqual(positionFromSegments(t.engine.segments,t.sink.ms),positionFromSegments(segments,t.sink.ms));
 }finally{t.close();}
});

test('PCM fast paths preserve samples and never change the input during gain or fades',()=>{
 const input=Buffer.alloc(FRAME_BYTES);
 for(let i=0;i<FRAME_BYTES;i+=2)input.writeInt16LE((i*37)%65536-32768,i);
 const original=Buffer.from(input),other=Buffer.alloc(FRAME_BYTES);
 for(const volume of [0,25,50,100])for(const next of [null,other]){
  const out=mixPcm(input,next,.5,volume);
  for(let i=0;i<FRAME_BYTES;i+=2)assert.equal(out.readInt16LE(i),Math.round(input.readInt16LE(i)*(next?.5:1)*volume/100)||0);
  assert.deepEqual(input,original);
 }
});
function setup(){const dir=mkdtempSync(join(tmpdir(),'gutta-core-')),store=new Store(join(dir,'db.sqlite')),providers=new Providers(store,{}),sink=new FakeSink(),engine=new Engine(store,providers,sink);return {store,providers,sink,engine,close:()=>{engine.close();store.close();rmSync(dir,{recursive:true,force:true});}};}
test('media clock uses consumed audio, including incoming crossfade offset',()=>{const segments=[{track:track(),startFrame:0,offset:10},{track:track('bcdefghijkl'),startFrame:500,offset:0}];assert.equal(positionFromSegments(segments,9000).position,19);assert.equal(positionFromSegments(segments,10000).track?.id,'bcdefghijkl');assert.equal(positionFromSegments(segments,13000).position,3);});
test('public state excludes requester identity and private fields',()=>{const t=setup();try{t.engine.current={...track(),requestedBy:'private-member-id'};t.engine.queue=[{...track('bcdefghijkl'),requestedBy:'private-member-id'}];const text=JSON.stringify(t.engine.snapshot());assert(!text.includes('private-member-id'));assert(!text.includes('requestedBy'));}finally{t.close();}});
test('history records actual consumed audio once, not a cue or a retry',()=>{const t=setup();try{t.engine.connected=true;t.engine.current={...track(),concert:true};t.engine.segments=[{track:t.engine.current,startFrame:0,offset:0}];t.engine.tick();assert.equal(t.store.history().length,0);t.sink.ms=20;t.engine.tick();t.engine.tick();assert.equal(t.store.history().length,1);t.engine.pause();t.engine.resume();t.engine.tick();assert.equal(t.store.history().length,1);}finally{t.close();}});
test('public commands cannot reach admin controls',async()=>{const t=setup();try{const commands=new Commands(t.engine);await assert.rejects(commands.execute({action:'stop'},'public'),/administratortilgang/);await assert.rejects(commands.execute({action:'volume',value:10},'public'),/administratortilgang/);}finally{t.close();}});
test('stale queue revision cannot skip a newer song',async()=>{const t=setup();try{t.engine.connected=true;const commands=new Commands(t.engine);t.engine.current={...track(),concert:true};await assert.rejects(commands.execute({action:'skip',queueRevision:'old',playbackKey:'core:abcdefghijk'},'public'),/Køen er endret/);}finally{t.close();}});
test('late search results after stop cannot restart playback',async()=>{const t=setup();try{t.engine.connected=true;let resolve!:(tracks:Track[])=>void;t.providers.resolve=()=>new Promise(r=>resolve=r);const commands=new Commands(t.engine);const result=commands.add('song');t.engine.stop();resolve([track()]);await assert.rejects(result,/stoppet før søket/);assert.equal(t.engine.queue.length,0);}finally{t.close();}});
test('concurrent search completions retain request order',async()=>{const t=setup();try{t.engine.connected=true;t.engine.current=track();let first!:(tracks:Track[])=>void;t.providers.resolve=q=>q==='first'?new Promise(r=>first=r):Promise.resolve([track('cdefghijklm')]);const c=new Commands(t.engine);const one=c.add('first'),two=c.add('second');first([track('bcdefghijkl')]);await Promise.all([one,two]);assert.deepEqual(t.engine.queue.map(t=>t.id),['bcdefghijkl','cdefghijklm']);}finally{t.close();}});
test('duplicate enqueue is rejected at commit time',()=>{const t=setup();try{t.engine.enqueue([track()]);assert.throws(()=>t.engine.enqueue([track()]),/allerede/);assert.equal(t.engine.queue.length,1);}finally{t.close();}});
test('claimed jobs survive restart and are never blindly replayed',()=>{const t=setup();try{assert.equal(t.store.job('id',{action:'skip'}),null);assert.equal(t.store.job('id',{})?.status,'processing');t.store.finishJob('id','done','OK');assert.equal(t.store.job('id',{})?.status,'done');}finally{t.close();}});
test('volume mixing remains bounded and preserves chosen gain through a fade',()=>{const a=Buffer.alloc(FRAME_BYTES),b=Buffer.alloc(FRAME_BYTES);for(let i=0;i<FRAME_BYTES;i+=2){a.writeInt16LE(20000,i);b.writeInt16LE(10000,i);}assert.equal(mixPcm(a,b,.5,100).readInt16LE(0),15000);assert.equal(mixPcm(a,b,.5,50).readInt16LE(0),7500);assert.equal(mixPcm(a,null,0,0).readInt16LE(0),0);});
test('Spotify matching rejects wrong artists and compilation lengths',()=>{const source={title:'Example Song',artist:'Artist',duration:200};assert(scoreMatch(source,track())>.9);assert.equal(scoreMatch(source,{...track(),artist:'Different',title:'Different Example Song'}),0);assert.equal(scoreMatch(source,{...track(),duration:900}),0);});
test('only trusted YouTube forms produce video IDs',()=>{assert.equal(youtubeId('https://youtu.be/abcdefghijk'),'abcdefghijk');assert.equal(youtubeId('https://youtube.com/watch?v=abcdefghijk'),'abcdefghijk');assert.equal(youtubeId('https://youtube.com.evil.example/watch?v=abcdefghijk'),null);});
test('time input is parsed and invalid input rejected',()=>{assert.equal(parseTime('1:30'),90);assert.equal(parseTime('1h 2m 3s'),3723);assert.throws(()=>parseTime('NaN'));});
test('signed short-lived command tickets cannot be modified, expired, or signed with a different key',async()=>{const {createHmac,randomUUID}=await import('node:crypto');const {verifyTicket}=await import('../src/tickets.ts');const sign=(data:unknown,key='test')=>{const payload=Buffer.from(JSON.stringify(data)).toString('base64url');return payload+'.'+createHmac('sha256',key).update(payload).digest('base64url');};const claims={id:'public:'+randomUUID(),scope:'public',action:'pause',aud:'gutta-krutt-core',exp:Date.now()+30000};assert.equal(verifyTicket(sign(claims),'test').action,'pause');assert.throws(()=>verifyTicket(sign(claims,'wrong'),'test'));assert.throws(()=>verifyTicket(sign({...claims,exp:Date.now()-1}),'test'));assert.throws(()=>verifyTicket(sign({...claims,aud:'other'}),'test'));assert.throws(()=>verifyTicket(sign({...claims,exp:Date.now()+120000}),'test'));});
test('concert rejects non-embeddable media before changing the shared queue',async()=>{const t=setup();try{t.engine.connected=true;t.engine.current=track();t.providers.resolve=async()=>[{...track('bcdefghijkl'),embeddable:false}];const commands=new Commands(t.engine);await assert.rejects(commands.add('bcdefghijkl','listener',{concert:true}),/ikke vises/);assert.equal(t.engine.queue.length,0);t.providers.resolve=async()=>[track('bcdefghijkl')];await commands.add('bcdefghijkl','listener',{concert:true});assert.equal(t.engine.queue.length,1);assert.equal(t.engine.queue[0].requestedBy,'listener');}finally{t.close();}});

test('ordinary Discord music is absent from the website while concert intent survives persistence',async()=>{const t=setup();try{t.engine.connected=true;t.engine.current=track();t.providers.resolve=async()=>[track('bcdefghijkl')];const c=new Commands(t.engine);await c.add('song','listener',{concert:true});assert.equal(t.engine.websiteSnapshot().current,null);assert.equal(t.engine.websiteSnapshot().playing,false);assert.equal(t.engine.websiteSnapshot().queue.length,1);assert.equal(t.store.get<Track[]>('queue',[])[0]?.concert,true);await assert.rejects(c.execute({action:'pause',playbackKey:'core:abcdefghijk'},'public'),/Konserten er endret/);t.engine.current=t.engine.queue[0];assert.equal(t.engine.websiteSnapshot().current?.id,'bcdefghijkl');await c.execute({action:'pause',playbackKey:'core:'+t.engine.current.entryId},'public');assert.equal(t.engine.paused,true);}finally{t.close();}});

test('ordinary music retains Discord history without becoming a website concert',()=>{const t=setup();try{t.engine.connected=true;t.engine.current=track();t.engine.segments=[{track:t.engine.current,startFrame:0,offset:0}];t.sink.ms=20;t.engine.tick();assert.equal(t.store.history().length,1);assert.equal(t.store.history()[0].video.concert,false);assert.equal(t.engine.websiteSnapshot().current,null);}finally{t.close();}});

test('radio queues early, deduplicates concurrent lookups and yields to manual songs',async()=>{
 const t=setup();try{
  t.engine.connected=true;t.engine.current=track();let calls=0;
  t.providers.radio=async()=>{calls++;return track('radio123456');};
  t.engine.tick();await t.engine.ensureRadio();
  assert.equal(calls,1);assert.equal(t.engine.queue[0].radio,true);assert.equal(t.sink.duration(),0);
  t.engine.enqueue([track('manual12345')]);assert.deepEqual(t.engine.queue.map(t=>t.id),['manual12345']);
  t.engine.setSettings({radio:false});assert.deepEqual(t.engine.queue.map(t=>t.id),['manual12345']);
 }finally{t.close();}
});

test('radio continues website concerts with public embeddable YouTube tracks',async()=>{
 const t=setup();try{
  t.engine.connected=true;t.engine.current={...track(),concert:true};t.providers.radio=async()=>track('radio123456');
  await t.engine.ensureRadio();
  assert.equal(t.engine.queue[0]?.concert,true);assert.equal(t.engine.queue[0]?.radio,true);
  assert.equal(t.engine.websiteSnapshot().queue[0]?.id,'radio123456');
 }finally{t.close();}
});

test('website enqueue continues into radio while ordinary admin music stays private',async()=>{
 for(const scope of ['public','admin'] as const){
  const t=setup();try{
   t.engine.connected=true;t.providers.resolve=async()=>[track()];t.providers.radio=async()=>track('radio123456');
   t.engine.startTrack=async selected=>{t.engine.generation++;t.engine.current=selected;};
   await new Commands(t.engine).execute({action:'enqueue',videoId:'abcdefghijk'},scope);
   assert.equal(t.engine.current?.concert,scope==='public');
   await t.engine.ensureRadio();await t.engine.naturalNext();
   assert.equal(t.engine.current?.id,'radio123456');assert.equal(t.engine.current?.concert,scope==='public');
   assert.equal(t.engine.websiteSnapshot().current?.id,scope==='public'?'radio123456':undefined);
  }finally{t.close();}
 }
});

test('concert radio cannot introduce SoundCloud or unembeddable tracks',async()=>{
 for(const candidate of [{...track('radio123456'),source:'soundcloud' as const},{...track('radio123456'),embeddable:false}]){
  const t=setup();try{
   t.engine.connected=true;t.engine.current={...track(),concert:true};t.providers.radio=async()=>candidate;
   await t.engine.ensureRadio();assert.equal(t.engine.queue.length,0);assert(t.engine.radioError);
  }finally{t.close();}
 }
});
test('late radio result cannot survive stop, a manual selection or disabling radio',async()=>{
 for(const action of ['stop','manual','disable']){const t=setup();try{
  t.engine.connected=true;t.engine.current=track();let finish!:(track:Track)=>void;t.providers.radio=()=>new Promise(r=>finish=r);
  const job=t.engine.ensureRadio();
  if(action==='stop')t.engine.stop();else if(action==='manual')t.engine.enqueue([track('manual12345')]);else t.engine.setSettings({radio:false});
  finish(track('radio123456'));await job;
  assert(!t.engine.queue.some(t=>t.radio));assert.equal(t.engine.queue.length,action==='manual'?1:0);
 }finally{t.close();}}
});
test('radio lookup failure does not reject playback or retry every clock tick',async()=>{
 const t=setup();try{t.engine.connected=true;t.engine.current=track();let calls=0;t.providers.radio=async()=>{calls++;throw Error('quota');};await t.engine.ensureRadio();await t.engine.ensureRadio();assert.equal(calls,1);assert(t.engine.radioError);assert.equal(t.engine.current.id,'abcdefghijk');}finally{t.close();}
});

test('radio retries temporary failure after a cooldown and queues a recovered result',async context=>{
 const t=setup();let now=1000;context.mock.method(Date,'now',()=>now);
 try{
  t.engine.connected=true;t.engine.current=track();let calls=0;
  t.providers.radio=async()=>{if(++calls===1)throw Error('temporary failure');return track('radio123456');};
  await t.engine.ensureRadio();await t.engine.ensureRadio();assert.equal(calls,1);
  now+=15000;await t.engine.ensureRadio();
  assert.equal(calls,2);assert.equal(t.engine.queue[0]?.id,'radio123456');assert.equal(t.engine.radioError,'');
 }finally{t.close();}
});

test('empty radio results retry at most three times per song and report no matches',async context=>{
 const t=setup();let now=1000;context.mock.method(Date,'now',()=>now);
 try{
  t.engine.connected=true;t.engine.current=track();let calls=0;t.providers.radio=async()=>{calls++;return null;};
  for(let i=0;i<5;i++){await t.engine.ensureRadio();now+=15000;}
  assert.equal(calls,3);assert(t.engine.radioError);assert.equal(t.engine.queue.length,0);
 }finally{t.close();}
});

test('re-enabling radio discards the disabled lookup and starts a fresh selection',async()=>{
 const t=setup(),pending=deferred<Track>();try{
  t.engine.connected=true;t.engine.current=track();let calls=0;
  t.providers.radio=async()=>++calls===1?pending.promise:track('newradio123');
  const old=t.engine.ensureRadio();t.engine.setSettings({radio:false});t.engine.setSettings({radio:true});
  pending.resolve(track('oldradio123'));await old;
  assert.equal(t.engine.queue.length,0);await t.engine.ensureRadio();
  assert.equal(calls,2);assert.equal(t.engine.queue[0]?.id,'newradio123');
 }finally{t.close();}
});

test('requesting a radio suggestion explicitly promotes it to a manual choice',()=>{
 const t=setup();try{t.engine.current=track();t.engine.queue=[{...track('radio123456'),radio:true}];t.engine.enqueue([{...track('radio123456'),requestedBy:'listener'}]);assert.equal(t.engine.queue.length,1);assert.equal(t.engine.queue[0].radio,undefined);assert.equal(t.engine.queue[0].requestedBy,'listener');}finally{t.close();}
});

test('skipping an early radio suggestion records cooldown without blocking manual replay',async()=>{
 const t=setup();try{t.engine.current={...track(),radio:true};await t.engine.skip();assert(t.store.get<Record<string,number>>('radio-skips',{})[track().id]);assert.equal(t.engine.enqueue([track()]),1);}finally{t.close();}
});

test('clock and recovery avoid snapshots while preserving position and revision',()=>{
 const t=setup();try{
  t.engine.settings.radio=false;t.engine.current=track();t.engine.segments=[{track:t.engine.current,startFrame:0,offset:10}];t.engine.lastEntry=t.engine.current.entryId;t.sink.ms=2000;
  let snapshots=0,clocks=0;const snapshot=t.engine.snapshot.bind(t.engine);t.engine.snapshot=()=>{snapshots++;return snapshot();};t.engine.on('clock',()=>clocks++);
  const revision=t.engine.revision();t.engine.tick();assert.equal(snapshots,0);assert.equal(clocks,1);assert.equal(t.store.get<{position:number}|null>('recovery',null)?.position,12);
  assert.equal(t.engine.revision(),revision);t.engine.queue.push(track('bcdefghijkl'));assert.notEqual(t.engine.revision(),revision);
  const added=t.engine.revision();t.engine.queue[0].entryId='replacement';assert.notEqual(t.engine.revision(),added);
  t.engine.pause();t.engine.checkpoint();assert.equal(t.store.get<{paused:boolean}|null>('recovery',null)?.paused,true);
 }finally{t.close();}
});

test('a superseded paused seek cannot pause its replacement or reject after stop',async()=>{
 for(const action of ['replace','stop']){
  const t=setup(),pending=deferred<Prepared>(),replacement=deferred<Prepared>();let newer:Promise<void>|undefined;
  try{
   t.engine.current=track();t.engine.paused=true;
   t.engine.prepare=async song=>song.id===track().id?pending.promise:replacement.promise;
   const seek=t.engine.seek(10);
   if(action==='replace')newer=t.engine.startTrack(track('bcdefghijkl'));else t.engine.stop();
   pending.reject(Error('cancelled preparation'));await seek;
   assert.equal(t.engine.paused,false);
   assert.equal(t.engine.current?.id,action==='replace'?'bcdefghijkl':undefined);
  }finally{t.engine.stop();if(newer){replacement.reject(Error('test cleanup'));await newer;}t.close();}
 }
});

test('pause state remains visible during seek and accepts newer pause or resume intent',async()=>{
 for(const paused of [false,true]){
  const t=setup(),pending=deferred<Prepared>();try{
   t.engine.connected=true;t.engine.current=track();t.engine.paused=!paused;
   t.engine.prepare=()=>pending.promise;const seek=t.engine.seek(10);
   assert.equal(t.engine.paused,!paused);
   if(paused)t.engine.pause();else t.engine.resume();
   pending.resolve({track:track(),decoder:{frame:async()=>null,stop:()=>{}} as PcmDecoder});
   await seek;assert.equal(t.engine.paused,paused);assert.equal(t.sink.playing,!paused);
  }finally{t.close();}
 }
});

test('closing an engine rejects delayed adds and cannot restart playback',async()=>{
 const t=setup();try{
  t.engine.connected=true;t.engine.current=track();
  const pending=deferred<Track[]>();t.providers.resolve=()=>pending.promise;
  const result=new Commands(t.engine).add('delayed');
  let starts=0;t.engine.startNext=async()=>{starts++;};
  t.engine.close();pending.resolve([track('bcdefghijkl')]);
  await assert.rejects(result,/stoppet før søket/);
  assert.equal(t.engine.connected,false);assert.equal(starts,0);
  assert.deepEqual(t.store.get('queue',[]),[]);
 }finally{t.close();}
});

test('audio buffering is distinct from pause and recovery retries the same consumed position twice',async()=>{
 const t=setup();try{const e=t.engine;e.connected=true;e.current=track();e.segments=[{track:e.current,startFrame:0,offset:20}];t.sink.ms=2000;t.sink.advancing=()=>false;t.sink.buffering=()=>true;
 assert.equal(e.snapshot().playing,true);assert.equal(e.snapshot().buffering,true);e.pause();assert.equal(e.snapshot().playing,false);e.paused=false;
 const attempts:number[]=[];e.startTrack=async(_track,offset)=>{attempts.push(offset??0);};let skipped=0;e.skip=async()=>{skipped++;};await e.recoverAudio();await e.recoverAudio();await e.recoverAudio();assert.deepEqual(attempts,[22,22]);assert.equal(skipped,1);assert.equal(e.diagnostics.snapshot().events.at(-1)?.reason,'recovery-exhausted');
 }finally{t.close();}
});

for (const consumed of [9980, 10000, 12000]) {
 test(`crossfade recovery pairs track and offset at consumed ${consumed} ms and consumes only the active entry`,async()=>{
  const t=setup();try{
   const e=t.engine,outgoing=track('outgoing000'),incoming={...track('incoming000'),offset:7},later=track('later000000');
   e.connected=true;e.paused=true;e.current=outgoing;e.queue=[incoming,later];
   e.segments=[{track:outgoing,startFrame:0,offset:30},{track:incoming,startFrame:500,offset:7}];t.sink.ms=consumed;
   const expected=consumed<10000?outgoing:incoming;
   const pending=deferred<Prepared>();e.prepare=(song,offset)=>{
    assert.equal(song.entryId,expected.entryId);
    assert(Math.abs(offset-(consumed<10000?39.98:7+(consumed-10000)/1000))<1e-9);
    return pending.promise;
   };
   const recovering=e.recoverAudio();
   // Real startTrack has run up to prepare, before any clock tick.
   assert.equal(e.current?.entryId,expected.entryId);
   assert.deepEqual(e.queue.map(v=>v.entryId),consumed<10000?[incoming.entryId,later.entryId]:[later.entryId]);
   assert.deepEqual(t.store.get<Track[]>('queue',[]).map(v=>v.entryId),e.queue.map(v=>v.entryId));
   assert.equal(e.recoveryEntry,expected.entryId);assert.equal(e.recoveryAttempts,1);
   pending.resolve({track:expected,decoder:{frame:async()=>null,stop(){}} as PcmDecoder});await recovering;
   e.tick();assert.equal(e.paused,true);
   assert(!e.queue.some(v=>v.entryId===e.current?.entryId));
  }finally{t.close();}
 });
}

test('exhausted crossfade recovery skips the consumed incoming entry, not back into it',async()=>{
 const t=setup();try{
  const e=t.engine,outgoing=track('outgoing000'),incoming=track('incoming000'),later=track('later000000');
  e.connected=true;e.current=outgoing;e.queue=[incoming,later];e.segments=[{track:outgoing,startFrame:0,offset:30},{track:incoming,startFrame:500,offset:7}];t.sink.ms=12000;
  e.recoveryEntry=incoming.entryId;e.recoveryAttempts=2;
  const starts:Track[]=[];e.startTrack=async song=>{starts.push(song);};
  await e.recoverAudio();assert.deepEqual(starts.map(v=>v.entryId),[later.entryId]);assert.equal(e.queue.length,0);
  assert.equal(e.diagnostics.snapshot().events.at(-1)?.reason,'recovery-exhausted');
 }finally{t.close();}
});
