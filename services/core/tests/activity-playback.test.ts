import {Social} from '../src/social.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ActivityPlayback,activityContext} from '../src/activity-playback.ts';
import {Rooms} from '../src/rooms.ts';
import {Store} from '../src/store.ts';
import {DiscordBot} from '../src/discord.ts';
import {deferred} from './deferred.ts';
const context={guildId:'222222222222222222',channelId:'333333333333333333',instanceId:'i-test-instance'};
const manager={user:{id:'444444444444444444',name:'Manager'},canManage:true};
const guest={user:{id:'555555555555555555',name:'Member'},canManage:false};
const video=(id='abcdefghijk')=>({id,title:'Example',artist:'Artist',image:'',duration:10,live:false,embeddable:true});
const checked=async()=>{};

test('Activity clock, queue, pause, seek, automatic end and restart work without a voice engine or decoder',async()=>{
 const store=new Store(':memory:');let now=10000;let playback=new ActivityPlayback(store,'synthetic',()=>now);
 const code=playback.join(context,'Activity');
 const control=async(action:string,fields:Record<string,unknown>={},host=manager)=>playback.control(code,context,{action,version:playback.snapshot(code,context,true).version,...fields},host,async id=>video(id),checked);
 try{
  let room=await control('add',{videoId:'abcdefghijk',host:true},guest);
  assert.equal(room.mode,'activity');assert.equal(room.isHost,false);assert.equal(room.playing,false);assert.equal(room.current!.requestedBy,'Member');
  await control('add',{videoId:'ABCDEFGHIJK'},guest);
  room=await control('play');assert.equal(room.startsAt,11500);
  now=12500;assert.equal(playback.snapshot(code,context,false).position,1);
  room=await control('pause');now=20000;assert.equal(playback.snapshot(code,context,true).position,1);
  room=await control('seek',{position:5});assert.equal(room.position,5);
  await control('play');now=22500;assert.equal(playback.snapshot(code,context,true).position,6);
  playback.dispose();playback=new ActivityPlayback(store,'synthetic',()=>now);
  assert.equal(playback.join(context,'Same session'),code);assert.equal(playback.snapshot(code,context,true).position,6);
  now=27000;await playback.tick();room=playback.snapshot(code,context,true);
  assert.equal(room.current!.id,'ABCDEFGHIJK');assert.equal(room.position,0);assert.equal(room.playing,true);
  now=40000;await playback.tick();room=playback.snapshot(code,context,true);assert.equal(room.current,null);assert.equal(room.playing,false);
  assert.equal(store.get('queue',null),null,'Ordinary bot queue was never created or modified');
 }finally{playback.dispose();store.close();}
});
test('Activity sessions are private, channel/guild/instance isolated and preserve manager, moderation and revision checks',async()=>{
 const store=new Store(':memory:'),playback=new ActivityPlayback(store,'synthetic'),publicRooms=new Rooms(store);
 const code=playback.join(context,'Activity');const call=(action:string,extra:Record<string,unknown>={},access=guest)=>playback.control(code,context,{action,version:playback.snapshot(code,context,true).version,...extra},access,async id=>video(id),checked);
 try{
  assert.throws(()=>publicRooms.snapshot(code),/not found/);
  for(const altered of [{...context,guildId:'666666666666666666'},{...context,channelId:'777777777777777777'},{...context,instanceId:'other-instance'}]){
   assert.notEqual(playback.join(altered,'Other'),code);assert.throws(()=>playback.snapshot(code,altered,true),/another/);
  }
  for(const action of ['play','pause','next','seek','approval','clear','play-video'])await assert.rejects(call(action,{actorHash:'forged',host:true,admin:true}),/manager/);
  await call('approval',{enabled:true},manager);let room=await call('add',{videoId:'abcdefghijk'});
  assert.equal(room.current,null);assert.equal(room.requests!.length,1);
  room=await call('approve',{videoId:'abcdefghijk'},manager);assert.equal(room.current!.id,'abcdefghijk');
  await assert.rejects(call('add',{videoId:'abcdefghijk'}),/already/);
  await assert.rejects(call('pause',{version:1},manager),/changed/);
  await assert.rejects(call('radio',{enabled:true},manager),/Unsupported/);
  assert.throws(()=>activityContext({...context,instanceId:'../other'}));
 }finally{publicRooms.dispose();playback.dispose();store.close();}
});
test('Activity metadata cannot commit after role/session loss, cancellation or a newer queue revision',async()=>{
 const store=new Store(':memory:'),playback=new ActivityPlayback(store,'synthetic'),code=playback.join(context,'Activity');
 try{
  await assert.rejects(playback.control(code,context,{action:'add',version:1,videoId:'abcdefghijk'},guest,async()=>video(),async()=>{throw new Error('Session left');}),/Session left/);
  assert.equal(playback.snapshot(code,context,true).current,null);
  const pending=deferred<ReturnType<typeof video>>();
  const add=playback.control(code,context,{action:'add',version:1,videoId:'abcdefghijk'},guest,()=>pending.promise,checked);
  await playback.control(code,context,{action:'approval',version:1,enabled:true},manager,async()=>video(),checked);
  pending.resolve(video());await assert.rejects(add,/changed/);
  assert.equal(playback.snapshot(code,context,true).current,null);
 }finally{playback.dispose();store.close();}
});
test('Discord instance proof checks app, instance, channel, guild, participants and current channel permission without joining voice',async()=>{
 let response:Record<string,unknown>={application_id:'111111111111111111',instance_id:context.instanceId,location:{kind:'gc',guild_id:context.guildId,channel_id:context.channelId},users:[guest.user.id]};
 let visible=true;const calls:string[]=[];
 const bot=Object.assign(Object.create(DiscordBot.prototype) as DiscordBot,{guildId:context.guildId,client:{isReady:()=>true,user:{id:'111111111111111111'},rest:{get:async(path:string)=>{calls.push(path);return response;}},guilds:{fetch:async()=>({channels:{fetch:async()=>({permissionsFor:()=>({has:()=>visible})})},members:{fetch:async()=>({})}})}}});
 await bot.verifyActivityInstance(context,guest.user.id);assert.equal(calls.length,1);assert.match(calls[0],/activity-instances\/i-test-instance$/);
 const valid=structuredClone(response);
 for(const bad of [{application_id:'999999999999999999'},{instance_id:'other'},{users:[]},{location:{kind:'pc',guild_id:context.guildId,channel_id:context.channelId}},{location:{kind:'gc',guild_id:context.guildId,channel_id:'888888888888888888'}}]){
  response={...valid,...bad};await assert.rejects(bot.verifyActivityInstance(context,guest.user.id),/Join this Activity/);
 }
 response=valid;visible=false;await assert.rejects(bot.verifyActivityInstance(context,guest.user.id),/cannot access/);
});

test('Activity social cannot share state or signed participant tokens with an ordinary room of the same display code',()=>{
 const store=new Store(':memory:'),ordinary=new Social(store,'synthetic'),activity=new Social(store,'synthetic',Date.now,'activity:');
 const input={scope:'room',scopeId:'A1ABCDEF',action:'join'},playback={playbackKey:'same-key',videoId:'abcdefghijk',position:0};
 try{
  const privateJoin=activity.apply(input,playback,true),publicJoin=ordinary.apply(input,playback,true);
  assert.notEqual(privateJoin.token,publicJoin.token);
  assert.throws(()=>ordinary.apply({...input,action:'read',token:privateJoin.token},playback,true),/Join social/);
  const changed=activity.apply({...input,action:'configure',enabled:false,revision:privateJoin.social.revision,token:privateJoin.token,eventId:crypto.randomUUID(),playbackKey:'same-key'},playback,true);
  assert.equal(changed.social.enabled,false);assert.equal(ordinary.apply({...input,action:'read',token:publicJoin.token},playback,true).social.enabled,true);
 }finally{store.close();}
});
