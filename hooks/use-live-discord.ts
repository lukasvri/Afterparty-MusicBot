'use client';
import {useEffect,useRef,useState} from 'react';
import {readLiveState,type LiveState} from '@/lib/live-room';

/** One reconnecting stream. A transport interruption never sends a playback command. */
export function useLiveDiscord(onState:(state:LiveState,ageMs:number)=>void,onDisconnect?:()=>void,guildId?:string,enabled=true){
 const callback=useRef(onState),disconnect=useRef(onDisconnect),fresh=useRef(false);
 const latest=useRef<LiveState|null>(null),sampleAt=useRef(0);
 callback.current=onState;disconnect.current=onDisconnect;
 const [live,setLive]=useState(false),[rtt,setRtt]=useState<number|null>(null),[phase,setPhase]=useState('starting');
 useEffect(()=>{
  fresh.current=false;latest.current=null;if(!enabled)return;
  let stopped=false,lastFrame=0,offset:number|null=null,bestRtt=Infinity,source:EventSource|null=null;
  const timeOrigin=Date.now()-performance.now(),now=()=>timeOrigin+performance.now();
  const lost=()=>{if(!stopped&&fresh.current){fresh.current=false;setLive(false);disconnect.current?.();}};
  const clock=async()=>{
   const sent=now();
   try{
    const response=await fetch('/api/realtime/clock',{signal:AbortSignal.timeout(5000)});
    if(!response.ok||stopped)return;
    const data=await response.json() as {serverTime:number},trip=now()-sent;
    if(stopped||!Number.isFinite(data.serverTime)||trip<0||trip>5000)return;
    setRtt(Math.round(trip));
    if(trip<=bestRtt*1.5){bestRtt=Math.min(bestRtt,trip);offset=data.serverTime-(sent+trip/2);}
   }catch{/* The freshness lease and HTTP polling cover reconnects. */}
  };
  const receive=(event:MessageEvent<string>)=>{
   if(stopped)return;
   try{
    const message=JSON.parse(event.data),state=message.type==='state'?readLiveState(message.state):null;
    if(!state)return;
    const previous=latest.current;
    if(previous?.epoch===state.epoch&&previous.serverTime>state.serverTime)return;
    const age=offset===null?0:Math.max(0,Math.min(1500,now()+offset-state.serverTime));
    lastFrame=performance.now();sampleAt.current=lastFrame;fresh.current=true;
    latest.current={...state,position:state.position+(state.playing?age/1000:0)};
    setLive(true);setPhase('live:http');callback.current(state,age);
   }catch{setPhase('invalid-message');}
  };
  void fetch('/api/realtime',{signal:AbortSignal.timeout(10000)}).then(r=>r.json()).then(value=>{
   if(stopped||!value||typeof value!=='object'||!('url' in value)||typeof value.url!=='string'){if(!stopped)setPhase('polling');return;}
   source=new EventSource('/api/realtime/stream'+(guildId?'?guildId='+guildId:''));
   source.addEventListener('open',()=>{if(!stopped){setPhase('connected');void clock();}});
   source.addEventListener('message',receive);
   source.addEventListener('error',()=>{if(!stopped)setPhase('http-reconnecting');});
  }).catch(()=>{if(!stopped)setPhase('polling');});
  const measure=setInterval(()=>{if(source)void clock();},10000);
  const watch=setInterval(()=>{if(fresh.current&&performance.now()-lastFrame>7000)lost();},1000);
  return()=>{stopped=true;fresh.current=false;clearInterval(measure);clearInterval(watch);source?.close();};
 },[guildId,enabled]);
 return {live,rtt,fresh,latest,sampleAt,phase,socketState:-1};
}
