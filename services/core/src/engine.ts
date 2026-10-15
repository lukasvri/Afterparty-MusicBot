import {AudioDiagnostics} from './audio-diagnostics.ts';
import {EventEmitter} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {Store} from './store.ts';
import {Providers} from './providers.ts';
import {canPlayRadioTrack} from './radio.ts';
import {Mixer,PcmDecoder,encodeOpus,audioBitrate,type Sink,type Prepared} from './audio.ts';
import {publicTrack,UserError,type Track,type PublicState,type Settings} from './types.ts';
export type Segment={track:Track;startFrame:number;offset:number};
export function positionFromSegments(segments:Segment[],duration:number){const frame=Math.floor(duration/20);const active=segments.findLast(s=>s.startFrame<=frame)??segments[0];return active?{track:active.track,position:Math.max(0,active.offset+(frame-active.startFrame)/50)}:{track:null,position:0};}
export class Engine extends EventEmitter{
 diagnostics=new AudioDiagnostics();recoveryEntry='';recoveryAttempts=0;
 store:Store;providers:Providers;sink:Sink;settings:Settings;queue:Track[];current:Track|null=null;segments:Segment[]=[];volume:number;ducking=false;ready=false;connected=false;generation=0;queueGeneration=0;runId:string|null=null;mixer:Mixer|null=null;abort:AbortController|null=null;loading=false;paused=false;epoch=randomUUID();sequence=0;historyEntries:Track[]=[];loop=false;loopQueue=false;lastError='';timer:ReturnType<typeof setInterval>;lastEntry='';lastSecond=-1;bitrate=96000;channelBitrate=96000;mutationTail:Promise<unknown>=Promise.resolve();
 radioTask:Promise<void>|null=null;radioAttempt='';radioError='';radioAttempts=0;radioRetryAt=0;radioGeneration=0;
 constructor(store:Store,providers:Providers,sink:Sink){super();this.store=store;this.providers=providers;this.sink=sink;this.settings=store.settings();this.volume=this.settings.defaultVolume;this.queue=store.get<Track[]>('queue',[]);const recovery=store.get<{track:Track;position:number;paused:boolean}|null>('recovery',null);if(recovery?.track&&!this.queue.some(t=>t.entryId===recovery.track.entryId))this.queue.unshift({...recovery.track,offset:recovery.track.live?0:Math.min(recovery.position,Math.max(0,recovery.track.duration-1))});sink.onIdle=id=>{if(id===this.runId){this.runId=null;void this.naturalNext();}};sink.onError=(error,id)=>{if(id!==this.runId)return;this.lastError='Lydstrømmen stoppet.';this.emit('audioError',error);this.diagnostics.note(error.message==='stream-stall'?'stream-stall':error.message.includes('dekoding')?'decoder-failure':error.message.includes('koding')?'encoder-failure':'stream-error');void this.recoverAudio();};this.timer=setInterval(()=>this.tick(),100);}
 serialize<T>(fn:()=>Promise<T>|T):Promise<T>{const job=this.mutationTail.catch(()=>{}).then(fn);this.mutationTail=job;return job;}
 tick(){this.diagnostics.buffer(this.connected&&!this.paused&&Boolean(this.current)&&(this.loading||this.sink.buffering()));const {track,position}=positionFromSegments(this.segments,this.sink.duration());if(track&&track.entryId!==this.current?.entryId){this.current=track;this.queue=this.queue.filter(t=>t.entryId!==track.entryId);this.persist();this.changed();}if(track&&this.sink.advancing()&&this.sink.duration()>0&&track.entryId!==this.lastEntry){this.lastEntry=track.entryId;this.historyEntries.push(track);this.historyEntries=this.historyEntries.slice(-50);const video=publicTrack(track);if(video)this.store.record('core:'+track.entryId,video);this.changed();}const second=Math.floor(position);if(second!==this.lastSecond&&this.current){this.lastSecond=second;this.checkpoint();}if(this.current&&this.sink.advancing())void this.ensureRadio();this.emit('clock');}
 snapshot():PublicState{const clock=positionFromSegments(this.segments,this.sink.duration());const current=clock.track??this.current;const now=Date.now();return {ready:this.ready,connected:this.connected,playing:this.connected&&!this.paused&&Boolean(current),position:clock.position,volume:this.volume,current:publicTrack(current),queue:this.queue.filter(t=>t.entryId!==current?.entryId).slice(0,40).map(t=>publicTrack(t)!),queueRevision:this.revision(),playbackKey:current?'core:'+current.entryId:null,lastSeen:now,online:true,engine:'gutta-krutt-core',epoch:this.epoch,sequence:this.sequence,serverTime:now,buffering:this.loading||this.sink.buffering()};}
 websiteSnapshot():PublicState{const state=this.snapshot(),current=state.current?.concert?state.current:null;return {...state,current,queue:state.queue.filter(t=>t.concert),playing:Boolean(current)&&state.playing,position:current?state.position:0,playbackKey:current?state.playbackKey:null};}
 revisionInput='';revisionValue='';
 revision(){const input=JSON.stringify([this.current?.entryId,this.queue.map(t=>t.entryId)]);if(input!==this.revisionInput){this.revisionInput=input;this.revisionValue=createHash('sha256').update(input).digest('hex');}return this.revisionValue;}
 changed(){this.sequence++;this.emit('state',this.snapshot());}
 checkpoint(){this.store.set('recovery',this.current?{track:this.current,position:positionFromSegments(this.segments,this.sink.duration()).position,paused:this.paused}:null);}
 persist(){this.store.setMany({queue:this.queue,current:this.current});}
 setConnection(connected:boolean){this.connected=connected;if(!connected){this.queueGeneration++;this.stop(false);}this.changed();}
 setSettings(change:Partial<Settings>){if(change.radio!==undefined&&change.radio!==this.settings.radio){this.radioGeneration++;this.radioAttempt='';this.radioAttempts=0;this.radioRetryAt=0;this.radioError='';}this.settings={...this.settings,...change};this.store.set('settings',this.settings);if(change.radio===false)this.queue=this.queue.filter(t=>!t.radio);this.persist();this.mixer?.invalidateNext();this.changed();}
 enqueue(tracks:Track[],next=false,immediate=false){if(!tracks.length)throw new UserError('Fant ingen sanger.');const seen=new Set([this.current?.id,...this.queue.filter(t=>!t.radio).map(t=>t.id)]);const fresh=tracks.filter(t=>{if(seen.has(t.id))return false;seen.add(t.id);return true;});if(!fresh.length)throw new UserError('Sangen ligger allerede i køen.');if(this.queue.length+fresh.length>this.settings.playlistLimit)throw new UserError('Køen er full.');const manual=this.queue.filter(t=>!t.radio);this.queue=next?[...fresh,...manual]:[...manual,...fresh];this.mixer?.invalidateNext();this.persist();this.changed();if(immediate)void this.skip();else if(!this.current&&this.connected)void this.startNext();return fresh.length;}
 async prepare(track:Track,offset:number,signal:AbortSignal):Promise<Prepared>{const source=await this.providers.stream(track,signal);if(signal.aborted)throw new Error('Avbrutt avspilling.');return {track:{...track,duration:source.duration||track.duration},decoder:new PcmDecoder(source,offset,signal)};}
 /** Select one track early; decoding still starts near the end of the current song. */
 ensureRadio():Promise<void>{
  if(this.radioTask)return this.radioTask;
  const seed=this.current;
  if(!seed||!this.connected||!this.settings.radio||this.loop||this.loopQueue||seed.live||this.queue.length)return Promise.resolve();
  if(this.radioAttempt!==seed.entryId){this.radioAttempt=seed.entryId;this.radioAttempts=0;this.radioRetryAt=0;this.radioError='';}
  // Retry transient failures without issuing an unbounded lookup every clock tick.
  if(this.radioAttempts>=3||Date.now()<this.radioRetryAt)return Promise.resolve();
  this.radioAttempts++;
  const generation=this.generation,radioGeneration=this.radioGeneration;
  const valid=()=>generation===this.generation&&radioGeneration===this.radioGeneration&&this.current?.entryId===seed.entryId&&this.connected&&this.settings.radio&&!this.loop&&!this.loopQueue&&!this.queue.length;
  this.radioTask=(async()=>{
   try{
    const next=await this.providers.radio(seed,[seed.id]);
    if(!valid())return;
    if(next&&canPlayRadioTrack(seed,next)){this.radioError='';this.radioRetryAt=Infinity;this.queue.push({...next,radio:true,concert:seed.concert===true});this.mixer?.invalidateNext();this.persist();this.changed();}
    else{this.radioError='Radioen fant ingen nye sanger. Prøv en annen låt.';this.radioRetryAt=Date.now()+15000;}
   }catch{if(valid()){this.radioError='Radioen fant ikke neste sang. Prøv /play.';this.radioRetryAt=Date.now()+15000;}}
  })().finally(()=>{this.radioTask=null;});
  return this.radioTask;
 }
 async preparedNext(from:Track,signal:AbortSignal){
  const generation=this.generation;
  const next=this.loop?{...from,entryId:randomUUID()}:this.queue.find(t=>t.entryId!==from.entryId);
  if(!next)return null;
  const result=await this.prepare(next,next.offset??0,signal);
  if(signal.aborted||generation!==this.generation||(!this.loop&&this.queue.find(t=>t.entryId!==from.entryId)?.entryId!==next.entryId)){
   result.decoder.stop();return null;
  }
  return result;
 }
 async recoverAudio(){const track=this.current;if(!track||!this.connected)return;if(this.recoveryEntry!==track.entryId){this.recoveryEntry=track.entryId;this.recoveryAttempts=0;}if(this.recoveryAttempts++>=2){this.diagnostics.note('recovery-exhausted');await this.skip();return;}const position=positionFromSegments(this.segments,this.sink.duration()).position;this.diagnostics.note('recovery');await this.startTrack(track,track.live?0:Math.min(position,Math.max(0,track.duration-1)),this.paused);}
 async startTrack(track:Track,offset=0,paused=false){this.bitrate=audioBitrate(this.channelBitrate,this.settings.audioBitrateKbps);const generation=++this.generation;this.runId=null;this.abort?.abort();this.mixer?.destroy();this.sink.stop();this.abort=new AbortController();const signal=this.abort.signal;this.current=track;this.segments=[];this.loading=true;this.paused=paused;this.persist();this.changed();try{const prepared=await this.prepare(track,offset,signal);if(generation!==this.generation){prepared.decoder.stop();return;}const mixer=new Mixer({onDiagnostic:reason=>this.diagnostics.note(reason),first:prepared,offset,bitrate:this.bitrate,volume:()=>this.ducking?Math.min(this.volume,this.settings.turnDownVolumeWhenPeopleSpeakTarget):this.volume,crossfade:()=>this.settings.crossfade,next:from=>this.preparedNext(from,signal),onSegment:(t,startFrame,initial)=>{this.segments.push({track:t,startFrame,offset:initial});}});this.mixer=mixer;this.runId=randomUUID();mixer.on('error',()=>{});this.sink.play(encodeOpus(mixer,this.bitrate).stream,this.runId);this.loading=false;if(this.paused)this.sink.pause();this.changed();}catch(error){if(generation!==this.generation||signal.aborted)return;this.loading=false;this.current=null;this.segments=[];this.lastError=error instanceof Error?error.message:'Kunne ikke starte sangen.';this.emit('playbackFailure',this.lastError);this.persist();this.changed();if(this.queue.length)void this.startNext();}}
 async startNext(){if(!this.connected)return;const next=this.queue.shift();if(!next){this.stop(false);return;}await this.startTrack(next,next.offset??0);}
 async naturalNext(){
  if(this.loop&&this.current)return this.startTrack({...this.current,entryId:randomUUID()},this.current.offset??0);
  if(this.loopQueue&&this.current)this.queue.push({...this.current,entryId:randomUUID()});
  const generation=this.generation;
  if(!this.queue.length)await this.ensureRadio();
  if(generation!==this.generation||!this.connected)return;
  await this.startNext();
 }
 pause(){if(!this.current)throw new UserError('Ingen sang spiller.');this.paused=true;this.sink.pause();this.changed();}
 resume(){if(!this.connected)throw new UserError('Start boten i en talekanal først.');if(this.current){this.paused=false;this.sink.resume();this.changed();}else if(this.queue.length)void this.startNext();else throw new UserError('Det er ingen sang å fortsette med.');}
 async skip(count=1){if(!Number.isInteger(count)||count<1||count>this.queue.length+1)throw new UserError('Ugyldig antall sanger.');const next=this.queue[count-1];if(this.current?.radio&&this.snapshot().position<60){const skipped=this.store.get<Record<string,number>>('radio-skips',{});skipped[this.current.id]=Date.now();this.store.set('radio-skips',Object.fromEntries(Object.entries(skipped).sort((a,b)=>b[1]-a[1]).slice(0,200)));}this.stop(false);this.queue.splice(0,count);this.persist();if(next)await this.startTrack(next,next.offset??0);else this.changed();}
 stop(clear=true){this.generation++;if(clear)this.queueGeneration++;this.runId=null;this.abort?.abort();this.abort=null;this.mixer?.destroy();this.mixer=null;this.sink.stop();this.current=null;this.segments=[];this.loading=false;this.paused=false;this.lastEntry='';if(clear){this.queue=[];this.historyEntries=[];this.store.set('recovery',null);}this.persist();this.changed();}
 async seek(seconds:number){if(!this.current||this.current.live||!Number.isFinite(seconds)||seconds<0||seconds>=this.current.duration)throw new UserError('Ugyldig posisjon.');await this.startTrack(this.current,seconds,this.paused);}
 clear(){this.queue=[];this.mixer?.invalidateNext();this.persist();this.changed();}
 remove(index:number,count=1){if(!Number.isInteger(index)||index<0||index>=this.queue.length)throw new UserError('Køen er endret. Oppdater og prøv igjen.');this.queue.splice(index,count);this.mixer?.invalidateNext();this.persist();this.changed();}
 move(from:number,to:number){if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||from>=this.queue.length||to<0||to>=this.queue.length)throw new UserError('Ugyldig køposisjon.');this.queue.splice(to,0,this.queue.splice(from,1)[0]);this.mixer?.invalidateNext();this.persist();this.changed();}
 shuffle(){for(let i=this.queue.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[this.queue[i],this.queue[j]]=[this.queue[j],this.queue[i]];}this.mixer?.invalidateNext();this.persist();this.changed();}
 setVolume(level:number){if(!Number.isFinite(level)||level<0||level>100)throw new UserError('Volum må være fra 0 til 100.');this.volume=level;this.changed();}
 close(){clearInterval(this.timer);this.connected=false;this.queueGeneration++;this.stop(false);}
}
