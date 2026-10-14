import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const base=process.env.MUSE_TEST_URL??'http://127.0.0.1:5173';
const envfile=process.env.SMOKE_ENV_FILE??'.dev.vars';
const values=Object.fromEntries(readFileSync(envfile,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')];}));
const bridge=values.ADMIN_BRIDGE_KEY??values.PUBLIC_SITE_ADMIN_KEY;
const guest={'Content-Type':'application/json','X-Muse-Visitor':randomUUID()};let code;let checks=0;
async function req(path,options={}){const r=await fetch(base+path,{headers:guest,signal:AbortSignal.timeout(20000),...options});const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data={error:raw};}return {status:r.status,data};}
function check(actual,expected,label){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label);}
try{
 let r=await req('/api/admin/rooms');check(r.status,403,'Anonymous admin access rejected');
 r=await req('/api/rooms',{method:'POST',body:JSON.stringify({name:'Kontrollrom for testing'})});check(r.status,200,'Create durable room');code=r.data.room.code;const token=r.data.token;assert.match(code,/^[A-Z0-9]{8}$/);assert.equal(token.length,64);checks++;
 const host={...guest,Authorization:`Bearer ${token}`};const guest2={...guest,'X-Muse-Visitor':randomUUID()};
 r=await req(`/api/rooms/${code}`,{headers:host});check(r.data.isHost,true,'Host role resolved from secret');assert.equal(r.data.owner_hash,undefined);assert.equal(r.data.token,undefined);checks++;
 let room=r.data;
 r=await req(`/api/rooms/${code}`,{method:'POST',body:JSON.stringify({version:room.version,action:'play'})});check(r.status,403,'Guests cannot control playback');
 r=await req(`/api/rooms/${code}`,{method:'POST',headers:{...host,Origin:'https://foreign.example'},body:JSON.stringify({version:room.version,action:'add',videoId:'K4DyBUG242c'})});check(r.status,403,'Foreign-origin mutation rejected');
 r=await req('/api/search?q=Cartoon%20On%20%26%20On');check(r.status,200,'Real YouTube song search');assert(r.data.videos.some(v=>v.id.length===11));checks++;const nextVideo=r.data.videos.find(v=>v.id!=='K4DyBUG242c');assert(nextVideo,'Search provides another video for skip verification');
 r=await req(`/api/rooms/${code}`,{method:'POST',headers:guest2,body:JSON.stringify({version:room.version,action:'add',videoId:'K4DyBUG242c'})});check(r.status,200,'Guest can add a trusted YouTube video');room=r.data.room;check(room.current.id,'K4DyBUG242c','First video becomes current');
 const seen=await req(`/api/rooms/${code}`,{headers:guest2});check(seen.data.current.id,room.current.id,'Second participant sees shared state');check(seen.data.isHost,false,'Guest role stays restricted');check(seen.data.viewers>=2,true,'Actual participant presence');
 r=await req(`/api/rooms/${code}`,{method:'POST',headers:host,body:JSON.stringify({version:room.version-1,action:'play'})});check(r.status,409,'Stale version cannot overwrite room');
 r=await req(`/api/rooms/${code}`,{method:'POST',headers:host,body:JSON.stringify({version:room.version,action:'play'})});check(r.status,200,'Host starts shared playback');room=r.data.room;
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,(room.startsAt??0)-Date.now())+650));r=await req(`/api/rooms/${code}`,{headers:guest2});check(r.data.position>room.position,true,'Server advances shared timeline after scheduled start');
 const concurrent=await Promise.all(['pause','seek'].map(action=>req(`/api/rooms/${code}`,{method:'POST',headers:host,body:JSON.stringify({version:room.version,action,position:12})})));check(concurrent.map(r=>r.status).sort(),[200,409],'Concurrent actions have one winner');
 r=await req(`/api/rooms/${code}`,{headers:host});room=r.data;
 r=await req(`/api/rooms/${code}`,{method:'POST',headers:host,body:JSON.stringify({version:room.version,action:'seek',position:20})});check(r.status,200,'Host seeks shared video');room=r.data.room;check(room.position>=20&&room.position<21,true,'Seek position stored accurately');
 r=await req(`/api/rooms/${code}`,{method:'POST',headers:host,body:JSON.stringify({version:room.version,action:'add',videoId:nextVideo.id})});check(r.status,200,'Second video added to shared queue');room=r.data.room;
 r=await req(`/api/rooms/${code}`,{method:'POST',headers:guest2,body:JSON.stringify({version:room.version,action:'next'})});check(r.status,403,'Guest cannot skip host video');
 r=await req(`/api/rooms/${code}`,{method:'POST',headers:host,body:JSON.stringify({version:room.version,action:'next'})});check(r.status,200,'Host skips shared video');room=r.data.room;check(room.current.id,nextVideo.id,'Skip advances to queued video');
 r=await req(`/api/rooms/${code}`,{headers:guest2});check(r.data.current.id,nextVideo.id,'Second participant sees skipped video');
 r=await req(`/api/rooms/${code}`,{method:'POST',headers:guest2,body:JSON.stringify({version:room.version,action:'clear'})});check(r.status,403,'Guests cannot clear queue');
 r=await req('/api/admin/rooms',{headers:{Authorization:`Bearer ${bridge}`}});check(r.status,200,'Private admin bridge authorized');assert(r.data.rooms.some(r=>r.code===code));checks++;
 r=await req('/api/videos?ids=bad');check(r.status,400,'Invalid video URL rejected');
 r=await req('/api/rooms',{method:'POST',body:'['});check(r.status,400,'Malformed request rejected');
 r=await req('/api/rooms',{method:'POST',body:JSON.stringify({name:'x'.repeat(17000)})});check(r.status,413,'Oversized request bounded');
 console.log(`RESULT ${checks} checks passed at ${base}`);
}finally{if(code){const r=await req('/api/admin/rooms',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:`Bearer ${bridge}`},body:JSON.stringify({code})});assert.equal(r.status,200,'Disposable test room cleaned up');console.log('Disposable room cleaned up');}}
