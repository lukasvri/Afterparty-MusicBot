import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { Catalog } from '../src/catalog.ts';
import { Store } from '../src/store.ts';
import { Providers } from '../src/providers.ts';
import { Engine } from '../src/engine.ts';
import { Commands } from '../src/commands.ts';
import { createServers } from '../src/server.ts';
import type { Sink } from '../src/audio.ts';
import type { YouTubeResponses } from '../src/external-types.ts';
import { deferred } from './deferred.ts';

test('catalog rejects overlapping jobs and holds ownership until cancelled work actually settles', async () => {
 const store = new Store(':memory:'), cleanup = deferred<void>(), started = deferred<void>();
 const caller = new AbortController(); let observed: AbortSignal | undefined;
 const catalog = new Catalog(store, {}, signal => ({
  video: async () => [],
  search: async (_q, count) => { assert.equal(count, 4); observed = signal; started.resolve(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), {once:true})); await cleanup.promise; return []; },
 }));
 try {
  const job = catalog.lookup({query:'synthetic'}, caller.signal); const cancelled = assert.rejects(job, /cancelled/);
  await started.promise; await assert.rejects(catalog.lookup({query:'other'}, new AbortController().signal), /busy/);
  caller.abort(); assert.equal(observed!.aborted,true);
  await assert.rejects(catalog.lookup({query:'after cancel'}, new AbortController().signal), /busy/);
  cleanup.resolve(); await cancelled;
  assert.deepEqual(await catalog.lookup({ids:[]},new AbortController().signal),[]);
 } finally { caller.abort(); cleanup.resolve(); catalog.close(); store.close(); }
});

test('one total catalog deadline aborts its provider and releases admission after cleanup', async t => {
 t.mock.timers.enable({apis:['setTimeout']});
 const store = new Store(':memory:'); let observed: AbortSignal | undefined;
 const catalog = new Catalog(store,{},signal=>({video:async()=>[],search:async()=>{observed=signal;await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return [];}}));
 try {
  const job=assert.rejects(catalog.lookup({query:'slow'},new AbortController().signal),error=>error instanceof Error && 'status' in error && error.status===504);
  t.mock.timers.tick(50000); await job; assert.equal(observed!.aborted,true);
  assert.deepEqual(await catalog.lookup({ids:[]},new AbortController().signal),[]);
 } finally {catalog.close();store.close();t.mock.timers.reset();}
});

test('request-owned metadata fallback is serial and does not continue after cancellation', async () => {
 const store=new Store(':memory:'),controller=new AbortController();let active=0,max=0,calls=0;
 const providers=new Providers(store,{}, {signal:controller.signal,metadataConcurrency:1});
 const ids=['first000001','second00001','third000001'];
 providers.youtube=async <K extends keyof YouTubeResponses>(path:K)=>{if(path==='search')return {items:ids.map(id=>({id:{videoId:id}}))} as YouTubeResponses[K];throw Error('synthetic API unavailable');};
 providers.extract=async (args,signal)=>{assert.equal(signal,controller.signal);active++;max=Math.max(max,active);calls++;await turn();active--;controller.abort();return {id:args.at(-1)!.slice(-11),title:'Synthetic',duration:120};};
 try {await assert.rejects(providers.search('synthetic',4));assert.equal(max,1);assert.equal(calls,1);}finally{store.close();}
});

test('catalog HTTP disconnect cancels owned work and unauthorized readers never start a job', async () => {
 const store=new Store(':memory:'),started=deferred<void>(),stopped=deferred<void>();
 const catalog=new Catalog(store,{},signal=>({video:async()=>[],search:async()=>{started.resolve();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{stopped.resolve();resolve();},{once:true}));return [];}}));
 const sink:Sink={onIdle:null,onError:null,play(){},pause(){},resume(){},stop(){},duration:()=>0,advancing:()=>false,buffering:()=>false};
 const engine=new Engine(store,new Providers(store,{}),sink),commands=new Commands(engine);clearInterval(engine.timer);
 const server=await createServers(engine,commands,{key:'synthetic-key',origin:'https://site.example',host:'127.0.0.1',publicPort:0,catalog});
 const base='http://127.0.0.1:'+(server.publicServer.address() as {port:number}).port;
 try {
  assert.equal((await fetch(base+'/v1/catalog?q=synthetic')).status,403);
  const controller=new AbortController();const request=fetch(base+'/v1/catalog?q=synthetic',{headers:{Authorization:'Bearer synthetic-key'},signal:controller.signal});const rejected=assert.rejects(request);
  await started.promise;controller.abort();await rejected;await stopped.promise;
 } finally {await server.close();commands.close();engine.close();store.close();}
});

test('provider HTTP cancellation does not start an extractor fallback',async t=>{
 const store=new Store(':memory:'),controller=new AbortController();let extractCalls=0;
 const providers=new Providers(store,{}, {signal:controller.signal,metadataConcurrency:1});
 t.mock.method(globalThis,'fetch',async(_url:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});}));
 providers.extract=async()=>{extractCalls++;return {};};
 try{const pending=assert.rejects(providers.search('synthetic',4));await turn();controller.abort();await pending;assert.equal(extractCalls,0);}finally{store.close();}
});

test('strict catalog metadata failure does not release admission before the remaining work settles',async()=>{
 const store=new Store(':memory:'),gate=deferred<void>(),started=deferred<void>();let settled=false,calls=0;
 const catalog=new Catalog(store,{},signal=>{
  const p=new Providers(store,{}, {signal,metadataConcurrency:1});
  p.youtube=async()=>{throw Error('Synthetic metadata API failure');};
  p.extract=async()=>{calls++;if(calls===1)throw Error('Synthetic unavailable item');started.resolve();await gate.promise;return {title:'Synthetic',duration:120};};
  return p;
 });
 try{
  const work=catalog.lookup({ids:['first000001','second00001']},new AbortController().signal).finally(()=>{settled=true;});const failure=assert.rejects(work,/Synthetic unavailable item/);
  await started.promise;await turn();assert.equal(settled,false);await assert.rejects(catalog.lookup({ids:[]},new AbortController().signal),/busy/);
  gate.resolve();await failure;assert.equal(calls,2);assert.deepEqual(await catalog.lookup({ids:[]},new AbortController().signal),[]);
 }finally{gate.resolve();catalog.close();store.close();}
});
