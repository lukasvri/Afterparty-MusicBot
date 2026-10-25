import { defaultSettings, validSettingValue } from '../../../../../services/core/src/settings.ts';
import type { AdminDetail } from './admin-client.ts';

export type DJSettings = { crossfade: number; radio: boolean };
export function readDJSettings(settings: AdminDetail['settings']): DJSettings {
  return {
    crossfade: validSettingValue('crossfade', settings.crossfade)
      ? Number(settings.crossfade)
      : defaultSettings.crossfade,
    radio: typeof settings.radio === 'boolean' ? settings.radio : defaultSettings.radio,
  };
}
export function djSettingsPatch(
  previous: DJSettings,
  next: DJSettings,
): Record<string, number | boolean> {
  if (!validSettingValue('crossfade', next.crossfade) || typeof next.radio !== 'boolean')
    throw Error('Choose a valid crossfade and radio setting.');
  return {
    ...(next.crossfade !== previous.crossfade ? { crossfade: next.crossfade } : {}),
    ...(next.radio !== previous.radio ? { radio: next.radio } : {}),
  };
}
export function djTrackIdentity(detail: AdminDetail): string {
  if (!detail.state.current) return '';
  const playbackKey = (detail.state as AdminDetail['state'] & { playbackKey?: unknown })
    .playbackKey;
  return JSON.stringify([
    detail.guildId,
    detail.state.current.id,
    typeof playbackKey === 'string' && playbackKey ? playbackKey : detail.state.queueRevision,
  ]);
}
export function djCuePosition(position: number, duration: number): number | null {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.min(Math.max(0, position), Math.max(0, duration - 0.1));
}
export function canDJSeek(detail: AdminDetail): boolean {
  const { current } = detail.state;
  return Boolean(
    current && !current.live && Number.isFinite(current.duration) && current.duration > 0,
  );
}
