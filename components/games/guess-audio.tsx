'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useLanguage } from '@/components/language';
import type { SyntheticPreview } from '@/hooks/use-guess-game';
/** Synthetic preview harness only. A real catalog and media transport need separate review. */
export function GuessAudio({ preview, roundId, active, elapsed, remaining }: { preview?: SyntheticPreview; roundId: string; active: boolean; elapsed: number; remaining: number }) {
  const { t } = useLanguage();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false), [error, setError] = useState('');
  const stop = useCallback(() => { const value = audio.current; audio.current = null; if (value) { value.pause(); value.removeAttribute('src'); value.load(); } setPlaying(false); }, []);
  useEffect(() => { const hidden = () => { if (document.visibilityState === 'hidden' || !navigator.onLine) stop(); }; document.addEventListener('visibilitychange', hidden); window.addEventListener('offline', hidden); return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('offline', hidden); stop(); }; }, [roundId, active, stop]);
  const eligible = preview?.kind === 'synthetic-fixture' && preview.dataUrl.length < 100000 && /^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/.test(preview.dataUrl);
  const listen = async () => {
    if (!eligible || !active || !navigator.onLine || document.visibilityState === 'hidden') return;
    stop(); setError(''); const value = new Audio(preview.dataUrl); audio.current = value; value.volume = 0.5;
    value.onended = () => { if (audio.current === value) stop(); }; value.onerror = () => { if (audio.current === value) { stop(); setError('Preview audio is unavailable.'); } };
    try { value.currentTime = Math.max(0, elapsed); await value.play(); if (audio.current === value) setPlaying(true); else value.pause(); }
    catch { if (audio.current === value) { stop(); setError('Your browser needs another tap to play audio.'); } }
  };
  return <div className="guess-audio"><button className="button" disabled={!eligible || !active || remaining <= 0} onClick={() => playing ? stop() : void listen()}>{playing ? <VolumeX size={17} /> : <Volume2 size={17} />}{t(playing ? 'Stop preview' : 'Listen to preview')}</button><small>{t(eligible ? 'Synthetic test audio. Not a playable music catalog.' : 'Music preview awaits a reviewed catalog adapter.')}</small>{error && <p role="status">{t(error)}</p>}</div>;
}
