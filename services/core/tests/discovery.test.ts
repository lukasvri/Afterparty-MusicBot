import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Providers} from '../src/providers.ts';
import {Store} from '../src/store.ts';
import type {YouTubeResponses} from '../src/external-types.ts';

test('Activity preview uses one flat lookup, keeps duration/live information, and caches separately from verified metadata',async()=>{
 const store=new Store(':memory:'),signal=new AbortController().signal;
 const provider=new Providers(store,{}, {signal,metadataConcurrency:1});let extracts=0,api=0;
 provider.youtube=async <K extends keyof YouTubeResponses>()=>{api++;return {items:[{id:'synthetic01',snippet:{title:'Verified',channelTitle:'Artist'},contentDetails:{duration:'PT2M'},status:{embeddable:true}}]} as YouTubeResponses[K];};
 provider.extract=async(args,observed)=>{extracts++;assert(args.includes('--flat-playlist'));assert.equal(observed,signal);return {entries:[
  {id:'synthetic01',title:'Preview',uploader:'Channel',duration:120},
  {id:'synthetic02',title:'Live',channel:'Live channel',live_status:'is_live',duration:0},
  {id:'synthetic01',title:'Duplicate'},{id:'../../bad',title:'Invalid'},
  {id:'synthetic03',title:'Private',availability:'private'},null,
 ]};};
 try{
  const found=await provider.search('Synthetic',4,false,true);assert.equal(found.length,2);assert.equal(extracts,1);assert.equal(api,0);
  assert.equal(found[0].duration,120);assert.equal(found[0].embeddable,false);assert.equal(found[1].live,true);assert.equal(found[1].artist,'Live channel');
  assert.equal(store.get('metadata:v4:synthetic01',null),null,'Preview cannot certify metadata or embedding');
  const again=await provider.search('synthetic',4,false,true);assert.equal(extracts,1);assert.notEqual(again[0].entryId,found[0].entryId);
  const selected=await provider.video(['synthetic01']);assert.equal(api,1);assert.equal(selected[0].title,'Verified');assert.equal(selected[0].embeddable,true);
 }finally{store.close();}
});
test('cancelled discovery does not cache partial data or start metadata work',async()=>{
 const store=new Store(':memory:'),controller=new AbortController();const provider=new Providers(store,{}, {signal:controller.signal,metadataConcurrency:1});let calls=0;
 provider.extract=async()=>{calls++;controller.abort();return {entries:[{id:'synthetic01',title:'Cancelled',duration:120}]};};
 try{
  await assert.rejects(provider.search('cancel',4,false,true));assert.equal(calls,1);
  assert.equal(store.get('discovery:v1:["cancel",4]',null),null);
  await assert.rejects(provider.search('cancel',4,false,true));assert.equal(calls,1);
 }finally{store.close();}
});
