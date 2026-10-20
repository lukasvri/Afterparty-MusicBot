import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.ts';
import {Engine} from '../src/engine.ts';
import {Providers} from '../src/providers.ts';
import {changeRoom,publicPlayback,type RoomPlayback} from '../src/room-state.ts';
import type {Sink} from '../src/audio.ts';
import {syntheticSong} from './radio-queue-fixture.ts';

function voice(){
 const store=new Store(':memory:');
 const sink:Sink={onIdle:null,onError:null,play(){},stop(){},pause(){},resume(){},duration:()=>0,advancing:()=>false,buffering:()=>false};
 const engine=new Engine(store,new Providers(store,{}),sink);clearInterval(engine.timer);
 return {engine,store,close(){engine.close();store.close();}};
}
test('voice adds append after existing manual and radio entries, preserve current and isolate another server',()=>{
 const a=voice(),b=voice();try{
  const current=syntheticSong(0,{radio:false}),automatic=syntheticSong(1),first=syntheticSong(2,{radio:false}),second=syntheticSong(3,{radio:false});
  a.engine.current=current;a.engine.queue=[automatic];b.engine.queue=[syntheticSong(9,{radio:false})];
  const other=structuredClone(b.engine.queue);
  a.engine.enqueue([first]);a.engine.enqueue([second]);
  assert.deepEqual(a.engine.queue.map(v=>v.id),[automatic.id,first.id,second.id]);
  assert.equal(a.engine.current,current);assert.deepEqual(b.engine.queue,other);
  assert.deepEqual(a.store.get('queue',[]),a.engine.queue);
  assert.throws(()=>a.engine.enqueue([first]),/already/);
  assert.throws(()=>a.engine.enqueue([current]),/already/);
 }finally{a.close();b.close();}
});
test('empty voice queue appends batches in input order and explicit next still prepends',()=>{
 const t=voice();try{
  const first=syntheticSong(1,{radio:false}),second=syntheticSong(2,{radio:false}),next=syntheticSong(3,{radio:false});
  t.engine.enqueue([first,second]);assert.deepEqual(t.engine.queue,[first,second]);
  t.engine.enqueue([next],true);assert.deepEqual(t.engine.queue,[next,first,second]);
 }finally{t.close();}
});
test('room adds preserve eligible radio and FIFO order without changing current or another room',()=>{
 const current=syntheticSong(0,{radio:false}),automatic=syntheticSong(1),first=syntheticSong(2,{radio:false}),second=syntheticSong(3,{radio:false});
 const original:RoomPlayback={current,queue:[automatic],radio:true,playing:true,position:12};
 let state=changeRoom(original,{action:'add',video:first},true,12);
 state=changeRoom(state,{action:'add',video:second},true,12);
 assert.deepEqual(publicPlayback(state).queue.map(v=>v.id),[automatic.id,first.id,second.id]);
 assert.equal(state.current?.id,current.id);assert.equal(state.playing,true);
 assert.deepEqual(original.queue,[automatic]);
 assert.throws(()=>changeRoom(state,{action:'add',video:first},true,12),/already/);
 assert.throws(()=>changeRoom(state,{action:'add',video:current},true,12),/already/);
});
test('empty room selects its first track without playing, then appends later requests and approvals',()=>{
 const first=syntheticSong(1,{radio:false}),second=syntheticSong(2,{radio:false}),third=syntheticSong(3,{radio:false});
 let state:RoomPlayback={current:null,queue:[],radio:false,playing:false,position:0};
 state=changeRoom(state,{action:'add',video:first},true,0);
 assert.equal(state.current?.id,first.id);assert.equal(state.playing,false);assert.deepEqual(state.queue,[]);
 state=changeRoom(state,{action:'add',video:second},true,0);
 state=changeRoom({...state,approvalRequired:true},{action:'add',video:third},false,0);
 state=changeRoom(state,{action:'approve',videoId:third.id},true,0);
 assert.deepEqual(state.queue.map(v=>v.id),[second.id,third.id]);
 const now=changeRoom(state,{action:'play-video',video:third},true,0);
 assert.equal(now.current?.id,third.id);assert.deepEqual(now.queue.map(v=>v.id),[second.id]);
});
