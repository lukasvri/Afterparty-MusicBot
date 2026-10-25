import { headers as browserHeaders } from '../../../../../lib/browser-api.ts';
import { validGuessCategories } from '../../../../../lib/guess-availability.ts';
import {
  GUESS_AUDIO_MAX_BYTES,
  guessWaveSeconds,
  readGuessBytes,
} from '../../../../../services/core/src/guess-audio-format.ts';
import type { GuessResult, GuessPublicState } from '../../../../../services/core/src/guess-game.ts';
export type GameScope = { scope: 'room' | 'guild'; scopeId: string; nickname: string };
export type GameResponse = GuessResult & {
  canManage: boolean;
  token?: string;
  mediaAvailable?: boolean;
  sourceState?: 'disabled' | 'unavailable' | 'loading' | 'ready';
  canPrepare?: boolean;
};
export type GameView = {
  data: GameResponse | null;
  ready: boolean;
  busy: boolean;
  error: string;
  signIn: boolean;
};
const validCount = (value: unknown, minimum: number, maximum: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
export const validGame = (game: GuessPublicState) =>
  game &&
  ['room', 'guild'].includes(game.scope) &&
  typeof game.scopeId === 'string' &&
  typeof game.sessionId === 'string' &&
  /^[a-f0-9-]{36}$/i.test(game.sessionId) &&
  Number.isSafeInteger(game.revision) &&
  game.revision >= 0 &&
  Number.isFinite(game.serverTime) &&
  ['lobby', 'round', 'reveal', 'results'].includes(game.phase) &&
  validGuessCategories(game.categories) &&
  Array.isArray(game.scoreboard) &&
  game.scoreboard.length <= 64 &&
  game.scoreboard.every(
    (p) =>
      p &&
      typeof p.id === 'string' &&
      typeof p.nickname === 'string' &&
      p.nickname.length <= 24 &&
      Number.isSafeInteger(p.total) &&
      p.total >= 0 &&
      typeof p.hasAnswered === 'boolean',
  ) &&
  game.settings &&
  Number.isFinite(game.settings.durationSeconds) &&
  game.settings.durationSeconds >= 15 &&
  game.settings.durationSeconds <= 90 &&
  Number.isSafeInteger(game.settings.maxPoints) &&
  Number.isSafeInteger(game.settings.minPoints) &&
  Number.isSafeInteger(game.settings.roundCount) &&
  typeof game.settings.hints === 'boolean' &&
  (game.settings.answerMode === undefined ||
    ['title', 'artist'].includes(game.settings.answerMode)) &&
  (game.round === null ||
    (game.round &&
      typeof game.round.roundId === 'string' &&
      Number.isFinite(game.round.startsAt) &&
      Number.isFinite(game.round.deadline) &&
      game.round.deadline >= game.round.startsAt &&
      game.round.hints &&
      (game.round.hints.artistWordCount === undefined ||
        validCount(game.round.hints.artistWordCount, 1, 120)) &&
      (game.round.hints.titleWordCount === undefined ||
        validCount(game.round.hints.titleWordCount, 1, 120)) &&
      ((game.round.skipVotes === undefined && game.round.skipRequired === undefined) ||
        (validCount(game.round.skipVotes, 0, 64) && validCount(game.round.skipRequired, 1, 64))) &&
      (game.round.answer === undefined ||
        (['reveal', 'results'].includes(game.phase) &&
          typeof game.round.answer.title === 'string' &&
          game.round.answer.title.length <= 500 &&
          typeof game.round.answer.artist === 'string'))));

/** Scoped game grants, never music commands. Mutations are never automatically replayed. */
export function createGameClient(
  scope: GameScope,
  options: {
    fetch?: typeof fetch;
    headers?: () => Record<string, string>;
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    now?: () => number;
    visible?: () => boolean;
  } = {},
) {
  const request = options.fetch ?? fetch,
    now = options.now ?? (() => performance.now());
  const visible =
    options.visible ?? (() => document.visibilityState !== 'hidden' && navigator.onLine);
  const headers =
    options.headers ?? (() => browserHeaders(scope.scope === 'room' ? scope.scopeId : undefined));
  let storage = options.storage;
  if (!storage) {
    try {
      storage = sessionStorage;
    } catch {
      /* scoped memory still works */
    }
  }
  const key = `afterparty-guess:${scope.scope}:${scope.scopeId}`;
  let token = '',
    wantJoin = true,
    alive = true,
    epoch = 0,
    failures = 0;
  try {
    token = storage?.getItem(key) ?? '';
  } catch {
    /* memory session */
  }
  let view: GameView = { data: null, ready: false, busy: false, error: '', signIn: false };
  let clock = { serverTime: 0, at: 0 };
  const listeners = new Set<(view: GameView) => void>();
  let pending: { controller: AbortController; mutation: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lifetime = new AbortController();
  const publish = (changes: Partial<GameView>) => {
    if (alive) {
      view = { ...view, ...changes };
      listeners.forEach((listener) => listener(view));
    }
  };
  const forget = () => {
    token = '';
    wantJoin = true;
    try {
      storage?.removeItem(key);
    } catch {
      /* memory session */
    }
  };
  const send = async (action: string, fields: Record<string, unknown> = {}) => {
    const mutation = !['join', 'read'].includes(action),
      snapshot = view.data?.game;
    if (
      !alive ||
      !visible() ||
      (mutation && (!snapshot || !view.ready)) ||
      (pending && (!mutation || pending.mutation))
    )
      return null;
    pending?.controller.abort();
    const current = { controller: new AbortController(), mutation },
      generation = epoch;
    pending = current;
    if (mutation) publish({ busy: true });
    try {
      const response = await request('/api/guess', {
        method: 'POST',
        headers: headers(),
        cache: 'no-store',
        signal: AbortSignal.any([
          lifetime.signal,
          current.controller.signal,
          AbortSignal.timeout(8000),
        ]),
        body: JSON.stringify({
          ...fields,
          scope: scope.scope,
          scopeId: scope.scopeId,
          action,
          ...(token ? { token } : {}),
          ...(action === 'join'
            ? {
                ...(scope.nickname.trim() ? { nickname: scope.nickname.trim() } : {}),
                eventId: crypto.randomUUID(),
              }
            : {}),
          ...(mutation && snapshot
            ? {
                sessionId: snapshot.sessionId,
                roundId: snapshot.round?.roundId ?? null,
                revision: fields.revision ?? snapshot.revision,
                eventId: crypto.randomUUID(),
              }
            : {}),
        }),
      });
      if (!alive || generation !== epoch || pending !== current) return null;
      if (!response.ok) {
        if (response.status === 419) forget();
        if (response.status === 401 && scope.scope === 'guild') publish({ signIn: true });
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw Error(error.error ?? 'The game is unavailable. Reconnect and try again.');
      }
      const data = (await response.json()) as GameResponse;
      if (!alive || generation !== epoch || pending !== current || !visible()) return null;
      if (
        !validGame(data.game) ||
        data.game.scope !== scope.scope ||
        data.game.scopeId !== scope.scopeId ||
        typeof data.canManage !== 'boolean' ||
        !data.self ||
        typeof data.self.participantId !== 'string' ||
        (data.self.skipVoted !== undefined && typeof data.self.skipVoted !== 'boolean') ||
        (data.sourceState !== undefined &&
          !['disabled', 'unavailable', 'loading', 'ready'].includes(data.sourceState)) ||
        (data.canPrepare !== undefined && typeof data.canPrepare !== 'boolean')
      )
        throw Error('Waiting for this game’s latest state.');
      if (snapshot?.sessionId === data.game.sessionId && data.game.revision < snapshot.revision)
        throw Error('Waiting for this game’s latest state.');
      if (data.token) {
        token = data.token;
        try {
          storage?.setItem(key, token);
        } catch {
          /* memory session */
        }
      }
      if (action === 'join') wantJoin = false;
      clock = { serverTime: data.game.serverTime, at: now() };
      failures = 0;
      publish({ data, ready: true, signIn: false, error: '' });
      return data;
    } catch (error) {
      if (alive && generation === epoch && pending === current) {
        failures = Math.min(4, failures + 1);
        publish({
          ready: false,
          error: error instanceof Error ? error.message : 'The game is unavailable.',
        });
      }
      return null;
    } finally {
      if (pending === current) {
        pending = null;
        if (mutation) publish({ busy: false });
      }
    }
  };
  const poll = async () => {
    clearTimeout(timer);
    if (!alive || !visible()) return;
    const generation = epoch;
    if (!pending) await send(wantJoin ? 'join' : 'read');
    if (alive && visible() && generation === epoch)
      timer = setTimeout(
        () => void poll(),
        failures ? Math.min(30000, 2500 * 2 ** failures) : 2500,
      );
  };
  const reconnect = () => {
    epoch++;
    pending?.controller.abort();
    pending = null;
    clearTimeout(timer);
    publish({
      ready: false,
      busy: false,
      error: visible() ? 'Reconnecting the game…' : 'Game paused while hidden or offline.',
    });
    if (visible()) timer = setTimeout(() => void poll(), 50);
  };
  return {
    subscribe(listener: (state: GameView) => void) {
      listeners.add(listener);
      listener(view);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      void poll();
    },
    refresh() {
      return send(wantJoin ? 'join' : 'read');
    },
    act: send,
    reconnect,
    rejoin() {
      if (!alive) return;
      wantJoin = true;
      reconnect();
    },
    clock: () => clock.serverTime + Math.max(0, now() - clock.at),
    async media(signal: AbortSignal) {
      const snapshot = view.data?.game,
        generation = epoch;
      if (
        !alive ||
        !view.ready ||
        !visible() ||
        !snapshot?.round ||
        snapshot.phase !== 'round' ||
        wantJoin
      )
        throw Error('Reconnect before listening.');
      const bounded = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(12000)]);
      const response = await request('/api/guess/media', {
        method: 'POST',
        headers: headers(),
        cache: 'no-store',
        signal: bounded,
        body: JSON.stringify({
          scope: scope.scope,
          scopeId: scope.scopeId,
          action: 'media',
          token,
          sessionId: snapshot.sessionId,
          roundId: snapshot.round.roundId,
          eventId: crypto.randomUUID(),
        }),
      });
      if (!alive || generation !== epoch || !visible() || signal.aborted) {
        void response.body?.cancel();
        throw Error('The game connection changed.');
      }
      if (!response.ok || response.headers.get('content-type') !== 'audio/wav') {
        if (response.status === 419) forget();
        if ([401, 403, 419].includes(response.status)) {
          reconnect();
          if (response.status === 401 && scope.scope === 'guild') publish({ signIn: true });
        }
        void response.body?.cancel();
        throw Error('Game preview is unavailable.');
      }
      const bytes = await readGuessBytes(response, GUESS_AUDIO_MAX_BYTES, bounded);
      guessWaveSeconds(bytes);
      if (
        !alive ||
        generation !== epoch ||
        !visible() ||
        view.data?.game.sessionId !== snapshot.sessionId ||
        view.data?.game.round?.roundId !== snapshot.round.roundId ||
        view.data?.game.phase !== 'round'
      )
        throw Error('The game round changed.');
      return new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
    },
    destroy() {
      alive = false;
      epoch++;
      lifetime.abort();
      pending?.controller.abort();
      clearTimeout(timer);
      listeners.clear();
    },
  };
}
