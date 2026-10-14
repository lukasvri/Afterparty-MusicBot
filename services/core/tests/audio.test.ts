import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PcmDecoder,Mixer,encodeOpus,FRAME_BYTES} from '../src/audio.ts';
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
