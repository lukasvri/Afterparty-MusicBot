export type AudioPreferences={level:number;muted:boolean;lastAudible:number};
export const defaultAudio:AudioPreferences={level:60,muted:false,lastAudible:60};
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100;
export function readAudioPreferences(saved:string|null,legacy:string|null):AudioPreferences{
  if(saved){try{const value=JSON.parse(saved);if(valid(value?.level)&&typeof value.muted==='boolean')return {level:value.level,muted:value.muted||value.level===0,lastAudible:valid(value.lastAudible)&&value.lastAudible>0?value.lastAudible:value.level>0?value.level:60};}catch{/* use the previous storage format */}}
  const level=legacy===null?60:Number(legacy);
  if(!valid(level))return {...defaultAudio};
  return {level:level||60,muted:level===0,lastAudible:level||60};
}
export function changeAudioLevel(previous:AudioPreferences,level:number):AudioPreferences{
  if(!Number.isFinite(level))return previous;
  level=Math.max(0,Math.min(100,level));
  return {level,muted:level===0,lastAudible:level>0?level:previous.lastAudible};
}
export function toggleAudioMute(previous:AudioPreferences):AudioPreferences{
  if(previous.muted||previous.level===0)return {...previous,level:previous.level||previous.lastAudible,muted:false};
  return {...previous,muted:true};
}
export function adoptPlayerAudio(previous:AudioPreferences,level:number,muted:boolean):AudioPreferences{
  if(!valid(level))return previous;
  muted=muted||level===0;
  if(previous.level===level&&previous.muted===muted)return previous;
  return {level,muted,lastAudible:level>0?level:previous.lastAudible};
}
export function applyAudioPreferences(player:{setVolume:(n:number)=>void;mute:()=>void;unMute:()=>void},value:AudioPreferences){
  player.setVolume(value.level);
  if(value.muted||value.level===0)player.mute();else player.unMute();
}
