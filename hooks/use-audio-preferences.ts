'use client';
import {browserStorage} from '@/lib/browser-storage';
import {useCallback,useEffect,useRef,useState} from 'react';
import {adoptPlayerAudio,changeAudioLevel,defaultAudio,readAudioPreferences,toggleAudioMute} from '@/lib/audio-preferences';
export function useAudioPreferences(){
  const [value,setValue]=useState({...defaultAudio});
  const [loaded,setLoaded]=useState(false);
  const current=useRef(value);current.current=value;
  useEffect(()=>{
    try{setValue(readAudioPreferences(browserStorage.get('afterparty-audio'),browserStorage.get('afterparty-volume')));}catch{/* preferences still work in memory */}
    setLoaded(true);
  },[]);
  useEffect(()=>{
    if(!loaded)return;
    try{browserStorage.set('afterparty-audio',JSON.stringify(value));}catch{/* browsers can block persistent storage */}
  },[value,loaded]);
  const setLevel=useCallback((level:number)=>setValue(previous=>changeAudioLevel(previous,level)),[]);
  const toggleMute=useCallback(()=>setValue(toggleAudioMute),[]);
  const fromPlayer=useCallback((level:number,muted:boolean)=>setValue(previous=>adoptPlayerAudio(previous,level,muted)),[]);
  return {value,current,setLevel,toggleMute,fromPlayer,loaded};
}
