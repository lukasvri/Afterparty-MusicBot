import {applyAudioPreferences,type AudioPreferences} from './audio-preferences.ts';
export type AudioOutput = 'site'|'choose'|'activity'|'voice';
export function selectActivityOutput(requested:'activity'|'voice',botMutedLocally:boolean):AudioOutput {
  return requested==='activity' ? botMutedLocally ? 'activity' : 'choose' : 'voice';
}
/** Listener-only output. Never changes room transport, bot volume or voice state. */
export function applyOutputAudio(player:Parameters<typeof applyAudioPreferences>[0],preferences:AudioPreferences,output:AudioOutput) {
  if(output==='choose'||output==='voice'){player.mute();return;}
  applyAudioPreferences(player,preferences);
}
export const acceptsPlayerAudio = (output:AudioOutput) => output==='site'||output==='activity';
