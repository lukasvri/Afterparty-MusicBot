'use client';
import { useEffect, useRef, useState } from 'react';
import { headers } from '@/lib/browser-api';
import type { GuessResult, GuessPublicState } from '../services/core/src/guess-game';
export type GameScope = { scope: 'room' | 'guild'; scopeId: string; nickname: string };
export type SyntheticPreview = { kind: 'synthetic-fixture'; dataUrl: string };
export type GameResponse = GuessResult & { canManage: boolean; token?: string; preview?: SyntheticPreview };
const valid = (game: GuessPublicState) => game && ['room', 'guild'].includes(game.scope) && typeof game.scopeId === 'string' && typeof game.sessionId === 'string' && /^[a-f0-9-]{36}$/i.test(game.sessionId) && Number.isSafeInteger(game.revision) && game.revision >= 0 && Number.isFinite(game.serverTime) && ['lobby', 'round', 'reveal', 'results'].includes(game.phase) && Array.isArray(game.categories) && game.categories.length <= 32 && game.categories.every(c => c && typeof c.id === 'string' && typeof c.name === 'string' && c.name.length <= 80 && typeof c.available === 'boolean' && Number.isSafeInteger(c.count) && c.count >= 0) && Array.isArray(game.scoreboard) && game.scoreboard.length <= 64 && game.scoreboard.every(p => p && typeof p.id === 'string' && typeof p.nickname === 'string' && p.nickname.length <= 24 && Number.isSafeInteger(p.total) && p.total >= 0 && typeof p.hasAnswered === 'boolean') && game.settings && Number.isFinite(game.settings.durationSeconds) && game.settings.durationSeconds >= 15 && game.settings.durationSeconds <= 90 && Number.isSafeInteger(game.settings.maxPoints) && Number.isSafeInteger(game.settings.minPoints) && Number.isSafeInteger(game.settings.roundCount) && typeof game.settings.hints === 'boolean' && (game.round === null || (game.round && typeof game.round.roundId === 'string' && Number.isFinite(game.round.startsAt) && Number.isFinite(game.round.deadline) && game.round.deadline >= game.round.startsAt && game.round.hints && (game.round.answer === undefined || (['reveal', 'results'].includes(game.phase) && typeof game.round.answer.title === 'string' && game.round.answer.title.length <= 500 && typeof game.round.answer.artist === 'string'))));
/** Independent game snapshots; opening never subscribes to or commands playback. */
export function useGuessGame(scope: GameScope) {
  const [data, setData] = useState<GameResponse | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [signIn, setSignIn] = useState(false);
  const received = useRef({ serverTime: 0, at: 0 });
  const invoke = useRef<((action: string, fields: Record<string, unknown>) => Promise<GameResponse | null>) | null>(null), retry = useRef<(() => void) | null>(null);
  const nickname = useRef(scope.nickname);
  useEffect(() => {
    let alive = true, token = '', inflight = false, generation = 0, snapshot: GuessPublicState | null = null, failures = 0, wantJoin = true;
    const storageKey = `afterparty-guess:${scope.scope}:${scope.scopeId}`;
    try { token = sessionStorage.getItem(storageKey) ?? ''; } catch { /* in-memory session remains available */ }
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController(); let requestController = new AbortController();
    const visible = () => document.visibilityState !== 'hidden' && navigator.onLine;
    const send = async (action: string, fields: Record<string, unknown> = {}) => {
      if (!alive || !visible() || inflight || (!['join', 'read'].includes(action) && !snapshot)) return null;
      const epoch = generation, mutation = !['join', 'read'].includes(action);
      inflight = true; requestController = new AbortController(); if (mutation) setBusy(true);
      try {
        const response = await fetch('/api/guess', { method: 'POST', headers: headers(scope.scope === 'room' ? scope.scopeId : undefined), cache: 'no-store', signal: AbortSignal.any([controller.signal, requestController.signal, AbortSignal.timeout(8000)]), body: JSON.stringify({ scope: scope.scope, scopeId: scope.scopeId, action, ...(token ? { token } : {}), ...(action === 'join' ? { ...(nickname.current.trim() ? { nickname: nickname.current.trim() } : {}), eventId: crypto.randomUUID() } : {}), ...(mutation && snapshot ? { sessionId: snapshot.sessionId, roundId: snapshot.round?.roundId ?? null, revision: snapshot.revision, eventId: crypto.randomUUID() } : {}), ...fields }) });
        if (!alive || epoch !== generation) return null;
        if (!response.ok) {
          if (response.status === 401 && scope.scope === 'guild') setSignIn(true);
          // 419 is the scoped anonymous game grant; ordinary OAuth 401 keeps it.
          if (response.status === 419) { token = ''; wantJoin = true; try { sessionStorage.removeItem(storageKey); } catch {} }
          const value = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(value.error ?? (response.status === 503 ? 'Games need a connected, updated Core.' : 'The game is unavailable. Reconnect and try again.'));
        }
        const value = await response.json() as GameResponse;
        if (!alive || epoch !== generation || !visible()) return null;
        if (!valid(value.game) || value.game.scope !== scope.scope || value.game.scopeId !== scope.scopeId || !value.self || typeof value.self.participantId !== 'string') throw new Error('Waiting for this game’s latest state.');
        if (snapshot?.sessionId === value.game.sessionId && value.game.revision < snapshot.revision) throw new Error('Waiting for this game’s latest state.');
        snapshot = value.game;
        if (value.token) { token = value.token; try { sessionStorage.setItem(storageKey, token); } catch {} }
        if (action === 'join') wantJoin = false;
        received.current = { serverTime: value.game.serverTime, at: performance.now() };
        setData(value); setReady(true); setSignIn(false); setError(''); failures = 0; return value;
      } catch (cause) { if (alive && epoch === generation) { setReady(false); setError(cause instanceof Error ? cause.message : 'The game is unavailable.'); failures = Math.min(4, failures + 1); } return null;
      } finally { inflight = false; if (alive && mutation) setBusy(false); }
    };
    const poll = async () => { clearTimeout(timer); if (!alive || !visible()) return; if (!inflight) await send(wantJoin ? 'join' : 'read'); if (alive && visible()) timer = setTimeout(poll, failures ? Math.min(30000, 2500 * 2 ** failures) : 2500); };
    const reconnect = () => { generation++; requestController.abort(); clearTimeout(timer); setReady(false); if (!visible()) setError(navigator.onLine ? 'Games pause while this tab is hidden.' : 'You are offline. Reconnect to play.'); else { setError('Reconnecting the game…'); timer = setTimeout(poll, 50); } };
    invoke.current = send; retry.current = () => { wantJoin = true; reconnect(); };
    window.addEventListener('online', reconnect); window.addEventListener('offline', reconnect); document.addEventListener('visibilitychange', reconnect);
    void poll();
    return () => { alive = false; generation++; controller.abort(); requestController.abort(); clearTimeout(timer); invoke.current = null; retry.current = null; window.removeEventListener('online', reconnect); window.removeEventListener('offline', reconnect); document.removeEventListener('visibilitychange', reconnect); };
  }, [scope.scope, scope.scopeId]);
  return { data, ready, busy, error, signIn, clock: () => received.current.serverTime + Math.max(0, performance.now() - received.current.at), act: (action: string, fields: Record<string, unknown> = {}) => invoke.current?.(action, fields) ?? Promise.resolve(null), reconnect: () => retry.current?.() };
}
