import {createHistogram,type RecordableHistogram} from 'node:perf_hooks';
import {loadavg} from 'node:os';
const WINDOW_MS=60000;
export class Metrics{
 cpu=process.cpuUsage();at=performance.now();cpuPercent=0;requestCount=0;timer:ReturnType<typeof setInterval>;loopTimer:ReturnType<typeof setInterval>;
 samples:{at:number;histogram:RecordableHistogram}[]=[];
 responses:{at:number;count:number;totalMs:number}[]=[];
 now:()=>number;
 constructor(now=()=>performance.now()){this.now=now;let previous=performance.now();this.loopTimer=setInterval(()=>{const current=performance.now();this.recordDelay(Math.max(0,current-previous-20));previous=current;},20);this.timer=setInterval(()=>this.sample(),1000);}
 prune(){const cutoff=this.now()-WINDOW_MS;this.samples=this.samples.filter(s=>s.at>cutoff);this.responses=this.responses.filter(s=>s.at>cutoff);}
 sample(){const now=performance.now(),cpu=process.cpuUsage();this.cpuPercent=((cpu.user-this.cpu.user)+(cpu.system-this.cpu.system))/(now-this.at)/10;this.cpu=cpu;this.at=now;this.prune();}
 recordDelay(ms:number){const at=Math.floor(this.now()/1000)*1000;let bucket=this.samples.at(-1);if(!bucket||bucket.at!==at){bucket={at,histogram:createHistogram()};this.samples.push(bucket);}bucket.histogram.record(Math.max(1,Math.round(ms*1e6)));this.prune();}
 request(ms:number){this.requestCount++;const at=Math.floor(this.now()/1000)*1000;let bucket=this.responses.at(-1);if(!bucket||bucket.at!==at){bucket={at,count:0,totalMs:0};this.responses.push(bucket);}bucket.count++;bucket.totalMs+=ms;this.prune();}
 snapshot(ping:number){this.prune();const memory=process.memoryUsage(),histogram=createHistogram();for(const sample of this.samples)histogram.add(sample.histogram);const count=this.responses.reduce((n,b)=>n+b.count,0),total=this.responses.reduce((n,b)=>n+b.totalMs,0);return {websocketPingMs:Number.isFinite(ping)&&ping>=0?ping:0,cpuPercent:this.cpuPercent,loadAverage1m:loadavg()[0],rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,uptimeSeconds:process.uptime(),eventLoopP95Ms:histogram.count?Math.max(0,histogram.percentile(95)/1e6):0,averageResponseMs:count?total/count:0,requestCount:this.requestCount,windowRequestCount:count,metricsWindowSeconds:60,engine:'gutta-krutt-core'};}
 close(){clearInterval(this.timer);clearInterval(this.loopTimer);}
}
