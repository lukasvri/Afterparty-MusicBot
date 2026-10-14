'use client';
import {useLanguage} from './language';
import {Captions,RefreshCw,Settings2} from 'lucide-react';
import type {SyncMode} from '@/lib/playback-sync';
import type {ReactNode} from 'react';
type Props={compact?:boolean;open:boolean;onOpen:(open:boolean)=>void;mode:SyncMode;onMode:(mode:SyncMode)=>void;quality:string;enabled:boolean;onRetry:()=>void;onSync:()=>void;children?:ReactNode};
export function PlayerSettings({compact=false,open,onOpen,mode,onMode,quality,enabled,onRetry,onSync,children}:Props){
 const {t}=useLanguage();
 return <details className="video-settings" open={open} onToggle={event=>onOpen(event.currentTarget.open)} data-player-chrome>
  <summary aria-label={t("Videoinnstillinger")} title={t("Videoinnstillinger")}><Settings2 size={compact?20:18}/><span className="settings-label">{t("Videoinnstillinger")}</span>{!compact&&<span className="settings-quality">{quality||'YouTube'}</span>}</summary>
  <div className="video-settings-body">
   <p><strong>{t("Kvalitet:")}</strong> {t("Tannhjulet i videoen. Velg 1440p eller lavere, gjerne 720p ved bufring.")} <Captions size={15}/> <strong>{t("Teksting:")}</strong> {t("CC-knappen når videoen har teksting.")}</p>
   <label>{t("Synkronisering")} <select value={mode} onChange={event=>onMode(event.target.value as SyncMode)}><option value="precise">{t("Tett synk (standard)")}</option><option value="stable">{t("Stabil avspilling")}</option></select></label>
   <small>{mode==='stable'?t("Færre automatiske hopp. Små tidsavvik tolereres for å gi videoen tid til å bufre."):t("Korrigerer mindre tidsavvik oftere. Kan gi flere hopp på tregt nett.")} {t("Valget lagres på denne enheten.")}</small>
   <div className="video-settings-actions"><button className="button subtle" disabled={!enabled} onClick={onSync}><RefreshCw size={14}/> {t("Synk nå")}</button><button className="button subtle" disabled={!enabled} onClick={onRetry}><RefreshCw size={14}/> {t("Last videoen på nytt")}</button></div>
   {children}
   <small>{t("YouTube Auto kan ikke begrenses til 1440p av siden. Bruk «Pause for alle» for å styre konserten i Discord og på nettsiden. I egne rom styrer verten avspillingen. Volum og kvalitet gjelder bare deg. F: fullskjerm. M: mute.")}</small>
  </div>
 </details>;
}
