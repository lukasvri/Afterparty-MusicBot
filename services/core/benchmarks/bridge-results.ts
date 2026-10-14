// Bounded synthetic workload. Run: node services/core/benchmarks/bridge-results.ts
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {Store} from '../src/store.ts';

const store=new Store(':memory:');
const localJobs=10000,bridgeJobs=40,iterations=250,rounds=5,warmup=25;
try{
 store.transaction(()=>{
  const insert=store.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,0)');
  for(let i=0;i<localJobs+bridgeJobs;i++)insert.run(String(i),JSON.stringify({action:'pause',bridge:i>=localJobs}),'done','ok',i);
 });
 const legacy=()=>store.db.prepare("SELECT id,payload,status,result FROM jobs WHERE sent=0 AND status IN ('done','failed','unknown') ORDER BY at LIMIT 20").all().filter(row=>JSON.parse(String(row.payload)).bridge).map(row=>({id:String(row.id),ok:row.status==='done',message:String(row.result)}));
 // Same corrected result as bridgeResults(), using the pre-existing pending index.
 const scan=()=>store.db.prepare("SELECT id,status,result FROM jobs INDEXED BY jobs_pending WHERE sent=0 AND status IN ('done','failed','unknown') AND json_extract(payload,'$.bridge')=1 ORDER BY at LIMIT 20").all().map(row=>({id:String(row.id),ok:row.status==='done',message:String(row.result)}));
 const indexed=()=>store.bridgeResults();
 assert.equal(legacy().length,0);assert.equal(indexed().length,20);assert.deepEqual(scan(),indexed());
 const operations={legacy,correctedScan:scan,indexed};
 for(const run of Object.values(operations))for(let i=0;i<warmup;i++)run();
 const samples:Record<string,number[]>={legacy:[],correctedScan:[],indexed:[]};
 for(let round=0;round<rounds;round++)for(const [name,run] of Object.entries(operations)){
  const start=performance.now();for(let i=0;i<iterations;i++)run();
  samples[name].push((performance.now()-start)/iterations);
 }
 console.log(JSON.stringify({environment:{node:process.versions.node,sqlite:process.versions.sqlite,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model},workload:{database:':memory:',localJobs,bridgeJobs,iterations,rounds,warmup},results:Object.entries(operations).map(([name,run])=>({name,returned:run().length,medianMs:samples[name].toSorted((a,b)=>a-b)[Math.floor(rounds/2)],samplesMs:samples[name]}))},null,2));
}finally{store.close();}
