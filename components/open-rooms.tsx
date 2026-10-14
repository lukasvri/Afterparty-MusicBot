'use client';
import {useCallback,useEffect,useState} from 'react';
import {ArrowUpRight,DoorOpen,LoaderCircle,Plus,RefreshCw,Users} from 'lucide-react';
import {useLanguage} from './language';
import type {OpenRoom} from '@/lib/types';
export function OpenRooms({onJoin,onCreate,joining,currentCode}:{onJoin:(code:string)=>void;onCreate:()=>void;joining:boolean;currentCode?:string}){
 const {t}=useLanguage();
 const [rooms,setRooms]=useState<OpenRoom[]>([]),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false);
 const refresh=useCallback(async(signal:AbortSignal)=>{setLoading(true);try{const response=await fetch('/api/rooms',{signal,cache:'no-store'});if(!response.ok)throw new Error('directory');const result=await response.json() as {rooms:OpenRoom[]};if(!signal.aborted){setRooms(result.rooms);setFailed(false);}}catch{if(!signal.aborted)setFailed(true);}finally{if(!signal.aborted)setLoading(false);}},[]);
 const [revision,setRevision]=useState(0);
 useEffect(()=>{const controller=new AbortController();void refresh(controller.signal);const timer=setInterval(()=>{if(!document.hidden)void refresh(controller.signal);},30000);return()=>{controller.abort();clearInterval(timer);};},[refresh,revision]);
 return <section className="room-directory" aria-labelledby="directory-heading">
  <header className="directory-heading"><div><span className="directory-symbol"><DoorOpen size={23}/></span><h2 id="directory-heading">{t('Finn et rom. Bli med på kvelden.')}</h2><p>{t('Rom som vertene har åpnet for alle. Ingen konto nødvendig.')}</p></div><button className="button subtle" disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16} className={loading?'spin':''}/>{t('Oppdater')}</button></header>
  {failed?<div className="notice error" role="alert">{t('Romlisten kunne ikke lastes. Prøv igjen.')}</div>:loading&&!rooms.length?<p className="directory-loading" role="status"><LoaderCircle className="spin" size={20}/>{t('Henter rom …')}</p>:rooms.length?<div className="room-cards">{rooms.map(room=><article className="open-room-card" key={room.code}><div className="room-card-icon"><Users size={24}/></div><div className="room-card-copy"><h3>{room.name}</h3><p><Users size={14}/>{t('inRoom',{count:room.viewers})}</p><small>{t('roomExpiry',{hours:Math.max(1,Math.ceil((room.expiresAt-Date.now())/3600000))})}</small></div><button className="button primary" disabled={joining} onClick={()=>onJoin(room.code)}>{t(room.code===currentCode?'Tilbake til musikken':'Bli med')}<ArrowUpRight size={16}/></button></article>)}</div>:<div className="directory-empty"><Users size={36}/><h3>{t('Ingen åpne rom akkurat nå.')}</h3><p>{t('Start et rom og la andre bli med.')}</p></div>}
  <footer><button className="button primary" onClick={onCreate}><Plus size={17}/>{t('Opprett rom')}</button><button className="button subtle" disabled={joining} onClick={()=>onJoin('DISCORD1')}>{t('Konsertrommet')}<ArrowUpRight size={16}/></button></footer>
 </section>;
}
