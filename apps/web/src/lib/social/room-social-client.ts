import { browserStorage } from '../../../../../lib/browser-storage.ts';
import type { Room } from '../../../../../lib/types.ts';
import {
  SOCIAL_HOST_ACTIONS,
  validSocial,
  type SocialAction,
  type SocialState,
} from '../../../../../services/core/src/social-protocol.ts';
export {
  SOCIAL_REACTIONS,
  validSocial,
  type SocialAction,
} from '../../../../../services/core/src/social-protocol.ts';
import { createReactionWindow } from '../../../../../lib/social-reactions.ts';

export type SocialView = {
  social: SocialState | null;
  ready: boolean;
  busy: boolean;
  canManage: boolean;
  signIn: boolean;
  error: string;
};
type Options = {
  fetch?: typeof fetch;
  storage?: Pick<typeof browserStorage, 'get' | 'set'>;
  now?: () => number;
  available?: () => boolean;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  stream?: boolean;
};
const hostActions = new Set<SocialAction>(SOCIAL_HOST_ACTIONS);

/** Independent opt-in social channel. Reconnection reads authority and never replays events. */
export function createRoomSocialClient(
  room: Pick<Room, 'code' | 'mode' | 'guildId' | 'playbackKey'>,
  options: Options = {},
) {
  const fetcher = options.fetch ?? fetch,
    storage = options.storage ?? browserStorage;
  const now = options.now ?? (() => performance.now());
  const available =
    options.available ?? (() => navigator.onLine && document.visibilityState !== 'hidden');
  const schedule = options.setTimeout ?? setTimeout,
    cancel = options.clearTimeout ?? clearTimeout;
  const scope = room.mode === 'discord' ? 'guild' : 'room',
    scopeId = scope === 'guild' ? room.guildId : room.code;
  const playbackKey = room.playbackKey;
  const listeners = new Set<(view: SocialView) => void>();
  const reactions = createReactionWindow(now);
  let view: SocialView = {
    social: null,
    ready: false,
    busy: false,
    canManage: false,
    signIn: false,
    error: '',
  };
  let alive = true,
    started = false,
    token = '',
    revision = -1,
    epoch = 0,
    inflight = false,
    streaming = false,
    failures = 0,
    lastReaction = -Infinity;
  let requestController: AbortController | null = null,
    streamController: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined,
    expiry: ReturnType<typeof setTimeout> | undefined;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const lifecycle = new AbortController();
  const publish = (change: Partial<SocialView>) => {
    if (alive) {
      view = { ...view, ...change };
      listeners.forEach((listener) => listener(view));
    }
  };
  const active = (version: number) => alive && epoch === version && available();
  const headers = () => {
    let visitor = storage.get('afterparty-visitor');
    if (!visitor) {
      visitor = crypto.randomUUID();
      storage.set('afterparty-visitor', visitor);
    }
    const host = storage.get(`afterparty-host:${room.code}`);
    return {
      'Content-Type': 'application/json',
      'X-Afterparty-Visitor': visitor,
      ...(host ? { Authorization: `Bearer ${host}` } : {}),
    };
  };
  const invalidate = () => {
    epoch++;
    requestController?.abort();
    streamController?.abort();
    void activeReader?.cancel().catch(() => {});
    publish({ ready: false, canManage: false });
  };
  const accept = (data: { social: SocialState; canManage?: boolean }, version: number) => {
    if (!active(version)) return;
    const next = data.social;
    if (
      !validSocial(next) ||
      next.scope !== scope ||
      next.scopeId !== scopeId ||
      next.playbackKey !== playbackKey
    )
      throw Error('Waiting for this room’s latest social state.');
    if (next.revision < revision) return;
    revision = next.revision;
    publish({
      social: {
        ...next,
        reactions: next.enabled
          ? reactions.merge(view.social?.reactions ?? [], next.reactions)
          : [],
      },
      canManage: data.canManage === true,
      ready: true,
    });
  };
  const statusError = (status: number) =>
    status === 429
      ? 'The room is busy. Try again in a moment.'
      : status === 409
        ? 'The concert changed. Refreshing the shared panel…'
        : status === 503
          ? 'Concert extras need a connected, updated Core.'
          : 'Concert extras are unavailable. Please try again shortly.';
  async function send(
    action: SocialAction | 'join' | 'read',
    fields: Record<string, unknown> = {},
  ): Promise<boolean> {
    const mutation = action !== 'join' && action !== 'read';
    if (
      !alive ||
      inflight ||
      !available() ||
      !scopeId ||
      !playbackKey ||
      (mutation && (!view.ready || !token))
    )
      return false;
    if (mutation && hostActions.has(action as SocialAction) && !view.canManage) return false;
    if (action === 'reaction' && now() - lastReaction < 1500) return false;
    if (
      mutation &&
      !view.social?.enabled &&
      !['configure', 'remove-highlight', 'bingo-stop'].includes(action)
    )
      return false;
    const version = epoch,
      controller = new AbortController();
    requestController = controller;
    inflight = true;
    if (mutation) publish({ busy: true, error: '' });
    let reconcile = false;
    try {
      const response = await fetcher('/api/social', {
        method: 'POST',
        headers: headers(),
        cache: 'no-store',
        signal: AbortSignal.any([lifecycle.signal, controller.signal, AbortSignal.timeout(8000)]),
        body: JSON.stringify({
          ...fields,
          scope,
          scopeId,
          playbackKey,
          action,
          ...(token ? { token } : {}),
          ...(mutation ? { eventId: crypto.randomUUID(), revision } : {}),
        }),
      });
      if (!active(version)) return false;
      if (response.status === 401) {
        token = '';
        invalidate();
        publish({
          signIn: scope === 'guild',
          error:
            scope === 'guild'
              ? 'Sign in with Discord to join this concert.'
              : 'Your social session expired. Reconnect to join again.',
        });
        return false;
      }
      if (response.status === 403) {
        invalidate();
        publish({ error: 'Your access changed. Reconnect to check your permissions.' });
        return false;
      }
      if (response.status === 409) {
        reconcile = mutation;
        publish({ ready: false });
      }
      if (!response.ok) throw Error(statusError(response.status));
      const data = (await response.json()) as {
        social: SocialState;
        token?: string;
        canManage?: boolean;
      };
      if (!active(version)) return false;
      if (
        action === 'join' &&
        (typeof data.token !== 'string' || !data.token || data.token.length > 1024)
      )
        throw Error('The room did not confirm your social session.');
      accept(data, version);
      if (action === 'join') token = data.token!;
      publish({ error: '', signIn: false });
      failures = 0;
      if (action === 'reaction') lastReaction = now();
      return true;
    } catch (error) {
      if (active(version)) {
        failures = Math.min(4, failures + 1);
        publish({
          ready: false,
          error:
            error instanceof Error
              ? error.message
              : 'Connection interrupted. Reconnect to try again.',
        });
      }
      return false;
    } finally {
      inflight = false;
      if (alive && mutation) publish({ busy: false });
      if (alive && reconcile) await send('read');
    }
  }
  const queueConnect = (delay: number) => {
    if (retry !== undefined) cancel(retry);
    if (alive && available())
      retry = schedule(() => {
        void connect();
      }, delay);
  };
  async function connect() {
    if (!alive || streaming || !available() || !scopeId || !playbackKey) return;
    if (inflight) {
      queueConnect(1000);
      return;
    }
    if (!(await send(token ? 'read' : 'join'))) {
      queueConnect(Math.min(60000, 10000 * 2 ** failures));
      return;
    }
    if (!alive || !available()) return;
    if (options.stream === false) {
      queueConnect(10000);
      return;
    }
    const version = epoch,
      controller = new AbortController();
    streamController = controller;
    streaming = true;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetcher('/api/social/stream', {
        method: 'POST',
        headers: headers(),
        cache: 'no-store',
        signal: AbortSignal.any([lifecycle.signal, controller.signal, AbortSignal.timeout(75000)]),
        body: JSON.stringify({ scope, scopeId, token, action: 'stream' }),
      });
      if (!active(version)) return;
      if (response.status === 401) {
        token = '';
        publish({ ready: false, canManage: false });
      }
      if (!response.ok || !response.body) throw Error(statusError(response.status));
      reader = response.body.getReader();
      activeReader = reader;
      const decoder = new TextDecoder();
      let buffer = '';
      while (active(version) && !controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!active(version) || controller.signal.aborted) break;
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
        if (buffer.length > 65536)
          throw Error('The social update was too large. Reconnect to continue.');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const payload = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('\n');
          if (payload && active(version) && !controller.signal.aborted) {
            accept(JSON.parse(payload), version);
            publish({ error: '' });
            failures = 0;
          }
        }
      }
      if (active(version)) publish({ ready: false });
    } catch (error) {
      if (active(version)) {
        failures = Math.min(4, failures + 1);
        publish({
          ready: false,
          error:
            error instanceof Error
              ? error.message
              : 'Connection interrupted. Reconnecting concert extras…',
        });
      }
    } finally {
      await reader?.cancel().catch(() => {});
      if (activeReader === reader) activeReader = undefined;
      streaming = false;
      if (alive && available())
        queueConnect(failures ? Math.min(60000, 10000 * 2 ** failures) : 2000);
    }
  }
  const expire = () => {
    if (!alive) return;
    if (view.social)
      publish({
        social: { ...view.social, reactions: reactions.merge(view.social.reactions, []) },
      });
    expiry = schedule(expire, 2000);
  };
  return {
    subscribe(listener: (state: SocialView) => void) {
      listeners.add(listener);
      listener(view);
      return () => listeners.delete(listener);
    },
    start() {
      if (started || !alive) return;
      started = true;
      expire();
      void connect();
    },
    act(action: SocialAction, fields: Record<string, unknown> = {}) {
      return send(action, fields);
    },
    reconnect() {
      if (!alive) return;
      invalidate();
      if (retry !== undefined) cancel(retry);
      if (available()) {
        publish({ error: 'Reconnecting concert extras…' });
        if (!streaming && !inflight) void connect();
        else queueConnect(0);
      } else
        publish({
          error: 'Concert extras are paused while you are offline or this tab is hidden.',
        });
    },
    destroy() {
      alive = false;
      lifecycle.abort();
      invalidate();
      if (retry !== undefined) cancel(retry);
      if (expiry !== undefined) cancel(expiry);
      listeners.clear();
      reactions.clear();
      token = '';
    },
  };
}
