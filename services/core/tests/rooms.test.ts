import {test} from 'node:test';import assert from 'node:assert/strict';import {Store} from '../src/store.ts';import {Rooms} from '../src/rooms.ts';
import {deferred} from './deferred.ts';
import type {RoomVideo} from '../src/protocol.ts';
import {roomRecommendation} from '../src/room-radio.ts';
const video={id:'M7lc1UVf-VE',title:'Example',artist:'YouTube',image:'',duration:60,live:false,embeddable:true};
test('one persisted room clock, shared start deadline, host protection and queue races',()=>{const store=new Store(':memory:');let now=10000;const rooms=new Rooms(store,()=>now);try{
 const input={code:'TESTROOM',name:'Test',owner_hash:'a'.repeat(64),state:{current:video,queue:[],position:0,playing:false},version:1,updated_at:now,expires_at:100000};rooms.import(input);assert.throws(()=>rooms.mutate('TESTROOM',{action:'play',version:1,actorHash:'bad'}));const started=rooms.mutate('TESTROOM',{action:'play',version:1,actorHash:'a'.repeat(64)});assert.equal(started.startsAt,11500);now=11000;assert.equal(rooms.snapshot('TESTROOM').position,0);now=12000;assert.equal(rooms.snapshot('TESTROOM').position,.5);const paused=rooms.mutate('TESTROOM',{action:'pause',version:2,actorHash:'a'.repeat(64)});now=13000;assert.equal(rooms.snapshot('TESTROOM').position,.5);assert.equal(paused.playing,false);assert.throws(()=>rooms.mutate('TESTROOM',{action:'play',version:2,actorHash:'a'.repeat(64)}));const recovered=new Rooms(store,()=>now);assert.equal(recovered.snapshot('TESTROOM').position,.5);assert(!JSON.stringify(recovered.snapshot('TESTROOM')).includes('ownerHash'));rooms.import(input);assert.equal(rooms.snapshot('TESTROOM').version,3);
 }finally{store.close();}});

const seed={...video,id:'seed1234567',title:'Syn Cole - Feel Good | Future House | NCS - Copyright Free',artist:'NCS',duration:200};
const next={...video,id:'next1234567',title:'Syn Cole - Synthetic Next',artist:'NCS',duration:200};
function setup(){const store=new Store(':memory:'),rooms=new Rooms(store,()=>10000);rooms.import({code:'TESTROOM',name:'Synthetic room',owner_hash:'a'.repeat(64),state:{current:seed,queue:[],position:100,playing:true},version:1,updated_at:10000,expires_at:100000});return {store,rooms,input:{action:'next',version:1,actorHash:'a'.repeat(64)}};}

test('own-room radio continues an empty queue and retains its shared clock',async()=>{
 const {store,rooms,input}=setup();try{
  rooms.search=async query=>{assert.equal(query,'Syn Cole audio -"Feel Good"');return [next];};
  const state=await rooms.control('TESTROOM',input);
  assert.equal(state.current?.id,next.id);assert.equal(state.radio,true);assert.equal(state.playing,true);assert.equal(state.startsAt,11500);
  assert.equal(new Rooms(store,()=>10000).snapshot('TESTROOM').current?.id,next.id);
  assert(!JSON.stringify(state).includes('ownerHash'));assert(!JSON.stringify(state).includes('radioHistory'));
 }finally{store.close();}
});

test('manual queue and radio-off preference take precedence without a lookup',async()=>{
 for(const mode of ['manual','off']){const {store,rooms,input}=setup();try{
  let calls=0;rooms.search=async()=>{calls++;return [next];};
  if(mode==='manual')rooms.mutate('TESTROOM',{action:'add',version:1,video:next});
  else rooms.mutate('TESTROOM',{action:'radio',version:1,actorHash:input.actorHash,enabled:false});
  const state=await rooms.control('TESTROOM',{...input,version:2});
  assert.equal(calls,0);assert.equal(state.current?.id,mode==='manual'?next.id:undefined);
  assert.equal(state.radio,mode==='manual');
 }finally{store.close();}}
});

test('guest and stale room-radio requests cannot spend a provider lookup',async()=>{
 const {store,rooms,input}=setup();try{
  let calls=0;rooms.search=async()=>{calls++;return [next];};
  await assert.rejects(rooms.control('TESTROOM',{...input,actorHash:'guest'}),/verten/);
  await assert.rejects(rooms.control('TESTROOM',{...input,version:0}),/endret/);
  assert.equal(calls,0);
 }finally{store.close();}
});

test('a late own-room radio result cannot replace a newer queue or pause',async()=>{
 for(const action of ['add','pause','radio']){const {store,rooms,input}=setup(),pending=deferred<RoomVideo[]>();try{
  rooms.search=()=>pending.promise;const result=rooms.control('TESTROOM',input);
  rooms.mutate('TESTROOM',{...input,action,video:next,enabled:false});pending.resolve([next]);
  await assert.rejects(result,/endret/);const state=rooms.snapshot('TESTROOM');
  assert.equal(state.current?.id,seed.id);
  if(action==='add')assert.equal(state.queue[0]?.id,next.id);
  if(action==='pause')assert.equal(state.playing,false);
  if(action==='radio')assert.equal(state.radio,false);
 }finally{store.close();}}
});

test('shared room recommendation filters repeats, live and blocked videos',async()=>{
 const blocked={...next,embeddable:false};
 assert.equal(await roomRecommendation({current:seed,queue:[]},async()=>[seed,blocked,{...next,live:true}]),null);
 assert.equal(await roomRecommendation({current:seed,queue:[],radioHistory:[next]},async()=>[next]),null);
 const selected=await roomRecommendation({current:seed,queue:[]},async()=>[next]);assert.equal(selected?.id,next.id);
});

test('a failed own-room recommendation preserves the seed and can be retried',async()=>{
 const {store,rooms,input}=setup();try{
  rooms.search=async()=>{throw new Error('Synthetic provider failure');};
  await assert.rejects(rooms.control('TESTROOM',input),/Synthetic provider failure/);
  assert.equal(rooms.snapshot('TESTROOM').version,1);assert.equal(rooms.snapshot('TESTROOM').current?.id,seed.id);
  rooms.search=async()=>[next];assert.equal((await rooms.control('TESTROOM',input)).current?.id,next.id);
 }finally{store.close();}
});
