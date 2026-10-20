'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useLanguage } from '@/components/language';
function seekPreview(value: HTMLAudioElement, elapsed: number) {
  if (Number.isFinite(value.duration)) value.currentTime = Math.min(Math.max(0, elapsed), Math.max(0, value.duration - 0.1));
}
/** Actual browser decoder; source bytes arrive only through the authenticated game route. */
export function GuessAudio({ available, fetchAudio, roundId, active, elapsed, remaining }: { available: boolean; fetchAudio: (signal: AbortSignal) => Promise<Blob>; roundId: string; active: boolean; elapsed: number; remaining: number }) {
  const { t } = useLanguage();
  const elapsedNow = useRef({ elapsed: 0, at: 0 });
  useEffect(() => { elapsedNow.current = { elapsed, at: performance.now() }; }, [elapsed]);
  const position = () => elapsedNow.current.elapsed + (performance.now() - elapsedNow.current.at) / 1000;
  const audio = useRef<HTMLAudioElement | null>(null), url = useRef(''), pending = useRef<AbortController | null>(null), epoch = useRef(0);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'playing'>('idle'), [error, setError] = useState('');
  const stop = useCallback(() => {
    epoch.current++; pending.current?.abort(); pending.current = null;
    const value = audio.current; audio.current = null;
    if (value) { value.onended = value.onerror = value.onloadedmetadata = null; value.pause(); value.removeAttribute('src'); value.load(); }
    if (url.current) { URL.revokeObjectURL(url.current); url.current = ''; } setPhase('idle');
  }, []);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden' || !navigator.onLine) stop(); };
    document.addEventListener('visibilitychange', hidden); window.addEventListener('offline', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('offline', hidden); stop(); };
  }, [roundId, active, available, stop]);
  const listen = async () => {
    if (pending.current || phase === 'playing') { stop(); return; }
    if (!available || !active || remaining <= 0 || !navigator.onLine || document.visibilityState === 'hidden') return;
    setError(''); const generation = epoch.current;
    let value = audio.current;
    try {
      if (!value) {
        const controller = new AbortController(); pending.current = controller; setPhase('loading');
        const blob = await fetchAudio(controller.signal);
        if (controller.signal.aborted || generation !== epoch.current) return;
        pending.current = null; url.current = URL.createObjectURL(blob); value = new Audio(url.current); audio.current = value; value.volume = 0.5;
        const current = value;
        current.onended = () => { if (audio.current === current) stop(); };
        current.onerror = () => { if (audio.current === current) { stop(); setError('Preview audio is unavailable.'); } };
        current.onloadedmetadata = () => { if (audio.current === current) seekPreview(current, position()); };
      }
      // A second explicit tap reuses a decoded clip if mobile autoplay blocked the first play promise.
      seekPreview(value, position());
      await value.play();
      if (generation === epoch.current && audio.current === value) setPhase('playing'); else value.pause();
    } catch {
      if (generation !== epoch.current) return;
      pending.current = null;
      if (audio.current) { setPhase('ready'); setError('Your browser needs another tap to play audio.'); }
      else { stop(); setError('Preview audio is unavailable.'); }
    }
  };
  const engaged = phase === 'playing' || phase === 'loading';
  return <div className="guess-audio"><button className="button" disabled={!available || !active || remaining <= 0} onClick={() => void listen()}>{engaged ? <VolumeX size={17} /> : <Volume2 size={17} />}{t(phase === 'loading' ? 'Cancel preview' : phase === 'playing' ? 'Stop preview' : 'Listen to preview')}</button><small>{t(available ? 'Preview audio is private to this game round.' : 'Music preview awaits a reviewed catalog adapter.')}</small>{error && <p role="status">{t(error)}</p>}</div>;
}
