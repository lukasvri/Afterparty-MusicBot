import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHistogram} from 'node:perf_hooks';
import {Store} from '../src/store.ts';
import {Metrics} from '../src/metrics.ts';
test('indexed queries retain ordering and pending filters',()=>{
 const s=new Store(':memory:');try{
  s.transaction(()=>{for(let i=0;i<200;i++){s.db.prepare('INSERT INTO history VALUES(?,?,?,?)').run(String(i),'{}',i,i<180?1:0);s.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?)').run(String(i),'{"bridge":true}','done','ok',i,i<180?1:0);}});
  assert.equal(s.history(10)[0].id,'199');assert.equal((s.jobs()[0] as any).id,'199');assert.equal(s.events()[0].id,'180');assert.equal(s.bridgeResults()[0].id,'180');
  for(const sql of ['SELECT * FROM history ORDER BY at DESC LIMIT 50','SELECT * FROM history WHERE sent=0 ORDER BY at LIMIT 20',"SELECT * FROM jobs WHERE sent=0 AND status IN ('done','failed','unknown') ORDER BY at LIMIT 20",'SELECT * FROM jobs ORDER BY at DESC LIMIT 30']){const plan=JSON.stringify(s.db.prepare('EXPLAIN QUERY PLAN '+sql).all());assert.match(plan,/USING INDEX/);assert.doesNotMatch(plan,/TEMP B-TREE/);}
  s.acknowledge(['180','181']);s.acknowledgeJobs(['180','181']);assert.equal(s.events()[0].id,'182');assert.equal(s.bridgeResults()[0].id,'182');
 }finally{s.close();}
});
test('batch writes roll back on failure, including nested writes',()=>{
 const s=new Store(':memory:');try{
  s.setMany({queue:['original'],current:'original'});const cyclic:any={};cyclic.self=cyclic;
  assert.throws(()=>s.setMany({queue:['changed'],current:cyclic}));assert.deepEqual(s.get('queue',[]),['original']);assert.equal(s.get('current',''),'original');
  assert.throws(()=>s.transaction(()=>{s.setMany({queue:['nested'],current:'nested'});throw Error('rollback');}));assert.equal(s.get('current',''),'original');s.setMany({queue:[],current:null});assert.equal(s.get('current','fallback'),null);
 }finally{s.close();}
});
test('rolling metrics expire old samples and retain total request count',()=>{
 let now=1000;const m=new Metrics(()=>now);clearInterval(m.timer);clearInterval(m.loopTimer);try{
  m.request(100);m.request(200);const old=createHistogram();old.record(100000000);m.samples.push({at:now,histogram:old});assert.equal(m.snapshot(12).averageResponseMs,150);assert(m.snapshot(12).eventLoopP95Ms>90);
  now=62000;m.request(2);const state=m.snapshot(12);assert.equal(state.averageResponseMs,2);assert.equal(state.windowRequestCount,1);assert.equal(state.requestCount,3);assert.equal(m.samples.length,0);
  now=123000;assert.equal(m.snapshot(12).averageResponseMs,0);assert.equal(m.snapshot(12).windowRequestCount,0);
 }finally{m.close();}
});
test('delay buckets are bounded and recent stalls are reflected in p95',()=>{
 let now=0;const m=new Metrics(()=>now);clearInterval(m.timer);clearInterval(m.loopTimer);try{
  for(let i=0;i<120;i++){now=i*1000;m.recordDelay(1);m.request(2);}
  assert.equal(m.samples.length,60);assert.equal(m.responses.length,60);
  now=180000;m.recordDelay(120);assert(m.snapshot(0).eventLoopP95Ms>=119);
  now=241000;m.recordDelay(1);assert(m.snapshot(0).eventLoopP95Ms<2);
 }finally{m.close();}
});
