import {test} from 'node:test';
import assert from 'node:assert/strict';
import {artworkUrl,youtubeArtwork} from '../lib/artwork.ts';
import {openActivityVideo,stageDisplayMode} from '../lib/activity-media.ts';

const id='synthetic01',jpeg=new Uint8Array([0xff,0xd8,0xff,0xe0,0,1]);
test('YouTube discovery, queue and stage artwork use the same origin; SoundCloud keeps its source',()=>{
 assert.equal(artworkUrl({id,image:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg'}),'/api/artwork/youtube/'+id);
 assert.equal(artworkUrl({id,image:'https://images.example/art.jpg',source:'soundcloud'}),'https://images.example/art.jpg');
 assert.equal(artworkUrl({id:'invalid',image:''}),'/afterparty-mark.svg');
});
test('public artwork has a fixed upstream, bounded data, no forwarded credentials, and cacheable JPEG output',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async(url:RequestInfo|URL,init?:RequestInit)=>{
  calls++;assert.equal(String(url),'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg');
  assert.equal(init?.redirect,'manual');assert.equal(init?.credentials,'omit');
  assert.deepEqual(init?.headers,{Accept:'image/jpeg'});assert(init?.signal instanceof AbortSignal);
  return new Response(jpeg,{headers:{'Content-Type':'image/jpeg','Set-Cookie':'upstream=private'}});
 });
 const request=new Request('https://activity.example/api/artwork/youtube/'+id,{headers:{Authorization:'Bearer synthetic',Cookie:'synthetic=1'}});
 const r=await youtubeArtwork(request,id);assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'image/jpeg');
 assert(r.headers.get('Cache-Control')?.includes('public'));assert.equal(r.headers.get('Set-Cookie'),null);
 assert.deepEqual(new Uint8Array(await r.arrayBuffer()),jpeg);assert.equal(calls,1);
 assert.equal((await youtubeArtwork(request,'https://internal.invalid')).status,400);assert.equal(calls,1);
 assert.equal((await youtubeArtwork(new Request(request,{method:'POST'}),id)).status,405);assert.equal(calls,1);
});
test('artwork rejects redirects, nonimages, spoofed MIME, oversized output and upstream failure',async t=>{
 for(const upstream of [()=>new Response(null,{status:302,headers:{Location:'http://internal.invalid'}}),
  ()=>new Response('html',{headers:{'Content-Type':'text/html'}}),()=>new Response('not jpeg',{headers:{'Content-Type':'image/jpeg'}}),
  ()=>new Response(new Uint8Array(256*1024+1),{headers:{'Content-Type':'image/jpeg'}})]){
  const mock=t.mock.method(globalThis,'fetch',async()=>upstream());
  assert.notEqual((await youtubeArtwork(new Request('https://site.example'),id)).status,200);mock.mock.restore();
 }
 t.mock.method(globalThis,'fetch',async()=>{throw Error('synthetic source failure');});
 assert.equal((await youtubeArtwork(new Request('https://site.example'),id)).status,502);
});
test('Activity opens only a validated video through Discord and surfaces rejection without ordinary window navigation',async()=>{
 const urls:string[]=[];const commands={openExternalLink:async({url}:{url:string})=>{urls.push(url);return {opened:true};}};
 assert.equal(await openActivityVideo(commands,id),true);assert.deepEqual(urls,['https://www.youtube.com/watch?v='+id]);
 assert.equal(await openActivityVideo(commands,'https://other.example'),false);assert.equal(urls.length,1);
 assert.equal(await openActivityVideo({openExternalLink:async()=>({opened:false})},id),false);
 assert.equal(await openActivityVideo({openExternalLink:async()=>{throw Error('denied');}},id),false);
 assert.equal(stageDisplayMode(true).embeddedVideo,false);assert.equal(stageDisplayMode(true).viewportOnly,true);
 assert.equal(stageDisplayMode(true).expand,'Utvid scena');assert.equal(stageDisplayMode(false).embeddedVideo,true);
 assert.equal(stageDisplayMode(false).viewportOnly,false);
});
