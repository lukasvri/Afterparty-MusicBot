'use client';
import { browserStorage } from '@/lib/browser-storage';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useBrowserValue, useClientReady } from './use-browser-value';
import { adoptPlayerAudio, changeAudioLevel, readAudioPreferences, toggleAudioMute, type AudioPreferences } from '@/lib/audio-preferences';

export function useAudioPreferences() {
  const saved = useBrowserValue('afterparty-audio');
  const legacy = useBrowserValue('afterparty-volume');
  const value = useMemo(() => readAudioPreferences(saved, legacy), [saved, legacy]);
  const loaded = useClientReady();
  const current = useRef(value);
  useLayoutEffect(() => { current.current = value; }, [value]);
  const update = useCallback((change: (previous: AudioPreferences) => AudioPreferences) => {
    const next = change(current.current);
    if(next === current.current) return;
    current.current = next;
    browserStorage.set('afterparty-audio', JSON.stringify(next));
  }, []);
  const setLevel = useCallback((level: number) => update(previous => changeAudioLevel(previous, level)), [update]);
  const toggleMute = useCallback(() => update(toggleAudioMute), [update]);
  const fromPlayer = useCallback((level: number, muted: boolean) => update(previous => adoptPlayerAudio(previous, level, muted)), [update]);
  return { value, current, setLevel, toggleMute, fromPlayer, loaded };
}
