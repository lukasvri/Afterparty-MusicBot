import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {PcmDecoder,Mixer,encodeOpus,FRAME_BYTES} from '../src/audio.ts';
import {deferred} from './deferred.ts';
const ffmpeg=process.env.FFMPEG_PATH??'ffmpeg';
for(const bitrate of [96000,192000])test(`real FFmpeg sources crossfade into valid stereo Opus at ${bitrate}`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gutta-audio-'));const abort=new AbortController();let mixer:Mixer|null=null;
 try{
  for(const [name,frequency]of [['a',440],['b',880]] as const){const result=spawnSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i',`sine=frequency=${frequency}:duration=4`,'-ar','48000','-ac','2',join(dir,name+'.wav')]);assert.equal(result.status,0,String(result.stderr));}
  const make=(name:string)=>({track:{id:name.repeat(11),entryId:name,title:name,artist:'Test',image:'',duration:4,live:false,embeddable:true},decoder:new PcmDecoder({url:join(dir,name+'.wav'),headers:''},0,abort.signal,ffmpeg)});
  const first=make('a'),second=make('b'),segments:{entry:string;frame:number}[]=[];let supplied=false;
  mixer=new Mixer({first,offset:0,volume:()=>100,crossfade:()=>1,bitrate,next:async()=>{if(supplied)return null;supplied=true;return second;},onSegment:(t,frame)=>segments.push({entry:t.entryId,frame})});
  const encoded=encodeOpus(mixer,bitrate),ogg:Buffer[]=[];encoded.process.stdout.on('data',chunk=>ogg.push(Buffer.from(chunk)));let packets=0;for await(const packet of encoded.stream){assert(packet.length>0);packets++;}assert(packets>=350&&packets<=351);const decoded=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-i','pipe:0','-f','s16le','-ar','48000','-ac','2','pipe:1'],{input:Buffer.concat(ogg),maxBuffer:4e6});assert.equal(decoded.status,0,String(decoded.stderr));assert.equal(decoded.stdout.length,350*FRAME_BYTES);assert(decoded.stdout.some(byte=>byte!==0));assert.deepEqual(segments,[{entry:'a',frame:0},{entry:'b',frame:150}]);
 }finally{mixer?.destroy();abort.abort();rmSync(dir,{recursive:true,force:true});}
});

test('a failed FFmpeg decoder rejects instead of reporting a clean end',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gutta-audio-failure-'));
 const decoder=new PcmDecoder({url:join(dir,'missing.wav'),headers:''},0,new AbortController().signal,ffmpeg);
 const closed=once(decoder.child,'close');
 try{await assert.rejects(decoder.frame(),/Lyddekodingen stoppet/);await closed;}
 finally{decoder.stop();await closed;rmSync(dir,{recursive:true,force:true});}
});

test('destroying a mixer while a source is stalled closes the encoder and output',async()=>{
 const pending=deferred<Buffer|null>();
 const decoder={frame:()=>pending.promise,stop:()=>pending.resolve(null)} as PcmDecoder;
 const mixer=new Mixer({first:{track:{id:'synthetic',entryId:'synthetic',title:'Test',artist:'Test',image:'',duration:200,live:false,embeddable:true},decoder},offset:0,volume:()=>100,crossfade:()=>0,next:async()=>null,onSegment:()=>{},bitrate:96000});
 const encoded=encodeOpus(mixer,96000),closed=once(encoded.process,'close');
 try{
  await once(encoded.process,'spawn');
  mixer.destroy();await once(mixer,'close');
  assert.equal(encoded.stream.destroyed,true);
  await closed;assert.equal(encoded.process.stdin.destroyed,true);
 }finally{encoded.stream.destroy();encoded.process.kill('SIGKILL');mixer.destroy();await closed;}
});

test('a stalled decoder is killed when its frame deadline expires',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'gutta-audio-stall-')),binary=join(dir,'stalled-decoder');
 writeFileSync(binary,`#!${process.execPath}\nsetInterval(()=>{},1000);\n`,{mode:0o700});
 const decoder=new PcmDecoder({url:'synthetic',headers:''},0,new AbortController().signal,binary);
 const closed=new Promise<void>(resolve=>decoder.child.once('close',()=>resolve()));
 try{
  await once(decoder.child,'spawn');t.mock.timers.enable({apis:['setTimeout']});
  const frame=decoder.frame(),rejected=assert.rejects(frame,/sluttet å levere data/);
  t.mock.timers.tick(6000);await rejected;
  assert.equal(decoder.disposed,true);await closed;
 }finally{t.mock.timers.reset();decoder.stop();await closed;rmSync(dir,{recursive:true,force:true});}
});

test('an encoder crash is an output error and disposes its input',async()=>{
 const decoder={frame:async()=>null,stop:()=>{}} as PcmDecoder;
 const mixer=new Mixer({first:{track:{id:'synthetic',entryId:'synthetic',title:'Test',artist:'Test',image:'',duration:200,live:false,embeddable:true},decoder},offset:0,volume:()=>100,crossfade:()=>0,next:async()=>null,onSegment:()=>{},bitrate:96000});
 // Node rejects the FFmpeg flags and exits nonzero without producing any output.
 const previous=process.env.FFMPEG_PATH;
 let encoded:ReturnType<typeof encodeOpus>;
 try{process.env.FFMPEG_PATH=process.execPath;encoded=encodeOpus(mixer,96000);}
 finally{if(previous===undefined)delete process.env.FFMPEG_PATH;else process.env.FFMPEG_PATH=previous;}
 const closed=new Promise<void>(resolve=>encoded.process.once('close',()=>resolve()));
 try{await assert.rejects(async()=>{for await(const _ of encoded.stream){}},/Lydkodingen stoppet/);await closed;assert.equal(mixer.destroyed,true);}
 finally{encoded.stream.destroy();encoded.process.kill('SIGKILL');mixer.destroy();await closed;}
});
