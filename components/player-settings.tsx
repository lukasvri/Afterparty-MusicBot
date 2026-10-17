'use client';
import {useLanguage} from './language';
import {Captions,RefreshCw,Settings2} from 'lucide-react';
import type {SyncMode} from '@/lib/playback-sync';
import {useId,type KeyboardEvent,type ReactNode} from 'react';
export type SettingsTab='room'|'queue'|'video';
type Props={compact?:boolean;open:boolean;active:SettingsTab;onTab:(tab:SettingsTab)=>void;onOpen:(open:boolean)=>void;mode:SyncMode;onMode:(mode:SyncMode)=>void;quality:string;enabled:boolean;onRetry:()=>void;onSync:()=>void;roomSettings:ReactNode;queueSettings?:ReactNode;children?:ReactNode};
export function PlayerSettings({compact=false,open,onOpen,active,onTab,mode,onMode,quality,enabled,onRetry,onSync,roomSettings,queueSettings,children}:Props){
 const {t}=useLanguage();
 const id=useId();
 const tabs:{key:SettingsTab;label:string}[]=[{key:'room',label:t('Rom')},...(queueSettings?[{key:'queue' as const,label:t('Kø')}]:[]),{key:'video',label:t('Video')}];
 const selected=active==='queue'&&!queueSettings?'room':active;
 function navigate(event:KeyboardEvent<HTMLButtonElement>){
  const index=tabs.findIndex(tab=>tab.key===selected);
  let next=index;
  if(event.key==='ArrowRight')next=(index+1)%tabs.length;
  else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=tabs.length-1;
  else return;
  event.preventDefault();
  onTab(tabs[next].key);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
 }
 return <details className="video-settings" open={open} onToggle={event=>onOpen(event.currentTarget.open)} data-player-chrome>
  <summary aria-label={t("Innstillinger")} title={t("Innstillinger")}><Settings2 size={compact?20:18}/><span className="settings-label">{t("Innstillinger")}</span>{!compact&&<span className="settings-quality">{quality||'YouTube'}</span>}</summary>
  <div className="video-settings-body">
   <div className="settings-tabs" role="tablist" aria-label={t('Innstillinger')}>
    {tabs.map(tab=><button type="button" key={tab.key} id={`${id}-${tab.key}-tab`} role="tab" aria-selected={selected===tab.key} aria-controls={`${id}-${tab.key}-panel`} tabIndex={selected===tab.key?0:-1} onClick={()=>onTab(tab.key)} onKeyDown={navigate}>{tab.label}</button>)}
   </div>
   <section className="settings-section room-settings" role="tabpanel" id={`${id}-room-panel`} aria-labelledby={`${id}-room-tab`} hidden={selected!=='room'} tabIndex={0}><h3>{t("Rominnstillingar")}</h3>{roomSettings}</section>
   {queueSettings&&<section className="settings-section" role="tabpanel" id={`${id}-queue-panel`} aria-labelledby={`${id}-queue-tab`} hidden={selected!=='queue'} tabIndex={0}><h3>{t("Køinnstillingar")}</h3>{queueSettings}</section>}
   <section className="settings-section" role="tabpanel" id={`${id}-video-panel`} aria-labelledby={`${id}-video-tab`} hidden={selected!=='video'} tabIndex={0}><h3>{t("Videoinnstillinger")}</h3>
   <p><strong>{t("Kvalitet:")}</strong> {t("Tannhjulet i videoen. Velg 1440p eller lavere, gjerne 720p ved bufring.")} <Captions size={15}/> <strong>{t("Teksting:")}</strong> {t("CC-knappen når videoen har teksting.")}</p>
   <label>{t("Synkronisering")} <select value={mode} onChange={event=>onMode(event.target.value as SyncMode)}><option value="precise">{t("Tett synk (standard)")}</option><option value="stable">{t("Stabil avspilling")}</option></select></label>
   <small>{mode==='stable'?t("Færre automatiske hopp. Små tidsavvik tolereres for å gi videoen tid til å bufre."):t("Korrigerer mindre tidsavvik oftere. Kan gi flere hopp på tregt nett.")} {t("Valget lagres på denne enheten.")}</small>
   <div className="video-settings-actions"><button className="button subtle" disabled={!enabled} onClick={onSync}><RefreshCw size={14}/> {t("Synk nå")}</button><button className="button subtle" disabled={!enabled} onClick={onRetry}><RefreshCw size={14}/> {t("Last videoen på nytt")}</button></div>
   {children}
   <small>{t("YouTube Auto kan ikke begrenses til 1440p av siden. Bruk «Pause for alle» for å styre konserten i Discord og på nettsiden. I egne rom styrer verten avspillingen. Volum og kvalitet gjelder bare deg. F: fullskjerm. M: mute.")}</small>
   </section>
  </div>
 </details>;
}
