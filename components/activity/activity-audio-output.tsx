"use client";
import {useLanguage} from '@/components/language';
import type {AudioOutput} from '@/lib/activity-audio';
export function ActivityAudioOutput({output,confirmed,onConfirm,onSelect,voiceAvailable=true}:{voiceAvailable?:boolean;output:AudioOutput;confirmed:boolean;onConfirm:(value:boolean)=>void;onSelect:(value:'activity'|'voice')=>void}) {
 const {t}=useLanguage();
 return <fieldset className="activity-audio-output" data-player-chrome>
  <legend>{t('Audio output for you')}</legend>
  {voiceAvailable && <label><input type="checkbox" checked={confirmed} onChange={event=>onConfirm(event.target.checked)} />{t('I muted the bot locally in Discord')}</label>}
  <div><button type="button" aria-pressed={output==='activity'} disabled={voiceAvailable&&!confirmed} onClick={()=>onSelect('activity')}>{t('Play audio in Activity')}</button>
  {voiceAvailable && <button type="button" aria-pressed={output==='voice'} onClick={()=>onSelect('voice')}>{t('Use Discord voice audio')}</button>}</div>
  <small>{output==='choose'?t('Choose an output before enabling sound here.'):output==='activity'?t('Activity audio follows this concert. Volume affects only you.'):t('This video is muted. Unmute the bot locally to listen in Discord voice.')}</small>
  <small>{voiceAvailable?t('Mute the bot only for yourself before enabling Activity audio to avoid hearing both. This view cannot verify that local mute.'):t('This Activity has its own queue and audio. It does not join or control Discord voice. If another bot is audible, mute it locally.')}</small>
 </fieldset>;
}
