import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:5173';
const values=Object.fromEntries(readFileSync('.dev.vars','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')];}));
const headers={'Content-Type':'application/json','X-Muse-Visitor':randomUUID()};
const created=[];
async function req(path,options={}){const r=await fetch(base+path,{headers,signal:AbortSignal.timeout(30000),...options});return {status:r.status,data:await r.json()};}
try{
 for(const isPublic of [true,false]){const r=await req('/api/rooms',{method:'POST',body:JSON.stringify({name:`Directory test ${isPublic?'public':'private'}`,isPublic})});assert.equal(r.status,200);created.push(r.data);}
 const [pub,priv]=created;let list=(await req('/api/rooms')).data.rooms;
 assert(list.some(r=>r.code===pub.room.code));assert(!list.some(r=>r.code===priv.room.code));assert(!list.some(r=>r.code==='DISCORD1'));
 assert.deepEqual(Object.keys(list.find(r=>r.code===pub.room.code)).sort(),['code','expiresAt','name','viewers']);console.log('PASS public listing excludes private and Discord rooms, exposes only directory fields');
 const joined=await req(`/api/rooms/${pub.room.code}`);assert.equal(joined.status,200);assert.equal(joined.data.isHost,false);console.log('PASS guest can join a listed room without host rights');
 const change=(token,isPublic)=>req(`/api/rooms/${pub.room.code}`,{method:'POST',headers:{...headers,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action:'visibility',isPublic})});
 assert.equal((await change('',false)).status,403);assert.equal((await change(pub.token,'yes')).status,400);assert.equal((await change(pub.token,false)).status,200);
 list=(await req('/api/rooms')).data.rooms;assert(!list.some(r=>r.code===pub.room.code));assert.equal((await req(`/api/rooms/${pub.room.code}`)).status,200);console.log('PASS only host can unlist; unlisting preserves shared-link access');
 assert.equal((await change(pub.token,true)).status,200);assert((await req('/api/rooms')).data.rooms.some(r=>r.code===pub.room.code));console.log('PASS host can list room again');
}finally{for(const entry of created){const r=await req('/api/admin/rooms',{method:'DELETE',headers:{...headers,Authorization:`Bearer ${values.ADMIN_BRIDGE_KEY??values.PUBLIC_SITE_ADMIN_KEY}`},body:JSON.stringify({code:entry.room.code})});assert.equal(r.status,200);}console.log('Disposable local rooms cleaned up');}
