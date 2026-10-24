import { request as browserRequest } from '../../../../lib/browser-api.ts';
import type { DiscordState, Room } from '../../../../lib/types.ts';

export type AdminGuild = { id: string; name: string; roomCode: string; installed: boolean };
export type AdminDetail = {
  guildId: string;
  roomCode: string;
  state: DiscordState;
  settings: Record<string, number | boolean>;
  player: {
    loopCurrentSong: boolean;
    loopCurrentQueue: boolean;
    bitrate: number;
    radioProvider: string;
    radioError?: string;
  };
  snapshots: Array<{ id: string; name: string; songCount: number }>;
  commands: Array<{ id: string; status: string; result?: string; payload: { action: string } }>;
  sleepTimerEndsAt: number | null;
  audio?: {
    interruptions: number;
    maxInterruptionMs: number;
    missedFrames?: number;
    events: Array<{ at: number; reason: string; durationMs: number }>;
  };
  performance?: { eventLoopP95Ms: number; eventLoopMaxMs: number };
};
export type AdminState = {
  checking: boolean;
  authenticated: boolean;
  globalAdmin: boolean;
  guilds: AdminGuild[];
  guildId: string;
  detail: AdminDetail | null;
  busy: boolean;
  error: string;
  notice: string;
  invite: string;
  ownerUpdateUrl: string;
  coreUnavailable: boolean;
  channels: Array<{ id: string; name: string; voice: boolean }>;
  rooms: Room[];
};
export const adminSettingGroups = [
  {
    title: 'Audio playback',
    description: 'Playback defaults for this Discord server.',
    fields: [
      {
        key: 'defaultVolume',
        label: 'Default volume',
        min: 0,
        max: 100,
        help: '0–100%. Current playback volume has its own control.',
      },
      {
        key: 'audioBitrateKbps',
        label: 'Audio bitrate',
        min: 64,
        max: 384,
        help: '64–384 kbit/s. Applies at the next playback start, capped by the voice channel.',
      },
      {
        key: 'crossfade',
        label: 'Crossfade',
        min: 0,
        max: 12,
        help: '0–12 seconds between tracks. Set 0 to turn crossfade off.',
      },
      {
        key: 'radio',
        label: 'Radio when the queue is empty',
        toggle: true,
        help: 'Prepare related music when the manual queue runs out.',
      },
    ],
  },
  {
    title: 'Voice and listeners',
    description: 'Connection behavior and volume while people speak.',
    fields: [
      {
        key: 'secondsToWaitAfterQueueEmpties',
        label: 'Wait after the queue empties',
        min: 0,
        max: 86400,
        help: '0–86400 seconds. Set 0 to stay connected indefinitely after the queue ends.',
      },
      {
        key: 'leaveIfNoListeners',
        label: 'Leave when no listeners remain',
        toggle: true,
        help: 'Disconnect when everyone else leaves the voice channel.',
      },
      {
        key: 'turnDownVolumeWhenPeopleSpeak',
        label: 'Lower volume while people speak',
        toggle: true,
        help: 'Reconnect after changing this option to update voice detection.',
      },
      {
        key: 'turnDownVolumeWhenPeopleSpeakTarget',
        label: 'Volume while people speak',
        min: 0,
        max: 100,
        help: '0–100%. Used while voice volume reduction is enabled.',
      },
    ],
  },
  {
    title: 'Queue and playlists',
    description: 'Import limits and the Discord queue display.',
    fields: [
      {
        key: 'playlistLimit',
        label: 'Playlist limit',
        min: 1,
        max: 1000,
        help: '1–1000 tracks imported from a playlist.',
      },
      {
        key: 'defaultQueuePageSize',
        label: 'Tracks per queue page',
        min: 1,
        max: 30,
        help: '1–30 tracks shown by the Discord queue command.',
      },
    ],
  },
] as const;

export function safeAdminLink(value: string, guildId?: string): string {
  if (!value) return '';
  try {
    const relative = value.startsWith('/') && !value.startsWith('//');
    const url = new URL(value, 'https://afterparty.invalid');
    if (!relative && url.protocol !== 'https:') return '';
    if (guildId) {
      if (!/^\d{14,22}$/.test(guildId)) return '';
      url.searchParams.set('guild_id', guildId);
      url.searchParams.set('disable_guild_select', 'true');
    }
    return relative ? `${url.pathname}${url.search}${url.hash}` : url.href;
  } catch {
    return '';
  }
}

export function createAdminClient(
  options: {
    request?: typeof browserRequest;
    delay?: (signal: AbortSignal) => Promise<void>;
    now?: () => number;
  } = {},
) {
  const request = options.request ?? browserRequest;
  const now = options.now ?? (() => performance.now());
  const listeners = new Set<(state: AdminState) => void>();
  let state: AdminState = {
    checking: true,
    authenticated: false,
    globalAdmin: false,
    guilds: [],
    guildId: '',
    detail: null,
    busy: false,
    error: '',
    notice: '',
    invite: '',
    ownerUpdateUrl: '',
    coreUnavailable: false,
    channels: [],
    rooms: [],
  };
  let alive = true,
    generation = 0,
    accessSerial = 0,
    readSerial = 0;
  let scope = new AbortController();
  const message = (error: unknown) =>
    error instanceof Error ? error.message : 'The server is temporarily unavailable.';
  const publish = (update: Partial<AdminState>) => {
    if (alive) {
      state = { ...state, ...update };
      listeners.forEach((listener) => listener(state));
    }
  };
  const valid = (version: number) => alive && version === generation && !scope.signal.aborted;
  const call = <T>(url: string, method = 'GET', body?: unknown, controller = scope) =>
    request<T>(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const retire = () => {
    scope.abort();
    scope = new AbortController();
    generation++;
    readSerial++;
  };
  const accept = (detail: AdminDetail, id: string) => {
    if (detail.guildId !== id || (detail.state.guildId && detail.state.guildId !== id))
      throw Error('The server returned a different Discord server. Reload your access.');
    publish({ detail });
  };
  const delay =
    options.delay ??
    ((signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, 500);
        signal.addEventListener('abort', abort, { once: true });
      }));
  async function loadAccess(requested = state.guildId, reloadDetail = true) {
    const serial = ++accessSerial,
      controller = scope;
    try {
      const result = await call<{
        authenticated: boolean;
        globalAdmin: boolean;
        guilds: AdminGuild[];
        invite: string;
        ownerUpdateUrl?: string;
        coreUnavailable?: boolean;
      }>('/api/admin/guilds', 'GET', undefined, controller);
      if (!alive || serial !== accessSerial) return;
      let ownerUpdateUrl = '';
      if (result.ownerUpdateUrl) {
        const session = await call<{ authenticated: boolean; method: string }>(
          '/api/admin/session',
          'GET',
          undefined,
          controller,
        );
        if (!alive || serial !== accessSerial) return;
        if (session.authenticated && session.method === 'password')
          ownerUpdateUrl = safeAdminLink(result.ownerUpdateUrl);
      }
      const previouslyInstalled = state.guilds.find(
        (guild) => guild.id === state.guildId,
      )?.installed;
      publish({
        authenticated: result.authenticated,
        globalAdmin: result.globalAdmin,
        guilds: result.guilds,
        invite: safeAdminLink(result.invite),
        ownerUpdateUrl,
        coreUnavailable: Boolean(result.coreUnavailable),
        checking: false,
      });
      const selected = result.authenticated
        ? (result.guilds.find((g) => g.id === requested) ??
          result.guilds.find((g) => g.installed) ??
          result.guilds[0])
        : undefined;
      if (
        state.guildId !== (selected?.id ?? '') ||
        !result.authenticated ||
        previouslyInstalled !== selected?.installed
      )
        select(selected?.id ?? '');
      else if (selected?.installed && reloadDetail) await refresh();
    } catch (error) {
      if (alive && serial === accessSerial)
        publish({ checking: false, error: message(error), ownerUpdateUrl: '' });
    }
  }
  function select(id: string) {
    if (id && !state.guilds.some((g) => g.id === id)) return;
    retire();
    publish({ guildId: id, detail: null, channels: [], busy: false, error: '', notice: '' });
    if (state.authenticated && state.guilds.find((g) => g.id === id)?.installed) void refresh();
  }
  async function refresh(clearError = true) {
    const id = state.guildId,
      version = generation,
      serial = ++readSerial;
    if (
      !id ||
      !state.authenticated ||
      state.busy ||
      !state.guilds.find((g) => g.id === id)?.installed
    )
      return;
    try {
      const detail = await call<AdminDetail>(
        `/api/admin/control?guildId=${encodeURIComponent(id)}`,
      );
      if (valid(version) && serial === readSerial) {
        accept(detail, id);
        if (clearError) publish({ error: '' });
      }
    } catch (error) {
      if (valid(version) && serial === readSerial) {
        const denied = [401, 403].includes((error as { status?: number })?.status ?? 0);
        publish({
          error: message(error),
          ...(denied ? { detail: null, ownerUpdateUrl: '', globalAdmin: false, rooms: [] } : {}),
        });
        if (denied) void loadAccess(id, false);
      }
    }
  }
  async function control(operation: string, extra: Record<string, unknown> = {}) {
    const id = state.guildId,
      version = generation,
      controller = scope;
    if (
      !id ||
      !state.authenticated ||
      !state.detail ||
      state.busy ||
      !state.guilds.find((g) => g.id === id)?.installed
    )
      return null;
    ++readSerial;
    publish({ busy: true, error: '', notice: '' });
    try {
      const result = await call<{
        id: string;
        status: string;
        settings?: Record<string, number | boolean>;
        channels?: AdminState['channels'];
      }>('/api/admin/control', 'POST', { ...extra, guildId: id, operation }, controller);
      if (!valid(version)) return null;
      if (operation === 'command') {
        const until = now() + 35000;
        let status = result.status;
        while (status === 'processing' && now() < until && valid(version)) {
          await delay(controller.signal);
          const detail = await call<AdminDetail>(
            `/api/admin/control?guildId=${encodeURIComponent(id)}`,
            'GET',
            undefined,
            controller,
          );
          if (!valid(version)) return null;
          accept(detail, id);
          const job = detail.commands.find((job) => job.id === result.id);
          status = job?.status ?? 'processing';
          if (job && ['failed', 'unknown'].includes(job.status))
            throw Error(job.result ?? 'The action failed.');
        }
        if (status !== 'done')
          throw Error(
            'The bot has not confirmed this action. Check the queue before trying again.',
          );
      }
      if (!valid(version)) return null;
      if (operation === 'settings') {
        const settings = extra.settings as Record<string, number | boolean>;
        if (
          !result.settings ||
          Object.keys(settings).some((key) => result.settings![key] !== settings[key])
        )
          throw Error(
            'The server did not confirm these settings. Reload and check before trying again.',
          );
      }
      if (result.channels) publish({ channels: result.channels });
      publish({
        notice:
          operation === 'settings'
            ? 'Settings saved for this server.'
            : operation === 'command'
              ? 'Action confirmed.'
              : 'Saved.',
      });
      return result;
    } catch (error) {
      if (valid(version)) {
        publish({ error: message(error) });
        if ([401, 403].includes((error as { status?: number })?.status ?? 0)) {
          publish({ detail: null, ownerUpdateUrl: '', globalAdmin: false, rooms: [] });
          void loadAccess(id, false);
        }
      }
      return null;
    } finally {
      if (valid(version)) {
        publish({ busy: false });
        await refresh(false);
      }
    }
  }
  async function loadRooms() {
    if (!state.globalAdmin) return;
    const serial = accessSerial;
    try {
      const result = await call<{ rooms: Room[] }>('/api/admin/rooms');
      if (alive && serial === accessSerial && state.globalAdmin) publish({ rooms: result.rooms });
    } catch (error) {
      if (alive && serial === accessSerial) publish({ error: message(error), rooms: [] });
    }
  }
  return {
    subscribe(listener: (state: AdminState) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    loadAccess,
    select,
    refresh,
    control,
    loadRooms,
    async validateOwnerSession() {
      if (!state.ownerUpdateUrl) return;
      const serial = accessSerial;
      try {
        const result = await call<{ authenticated: boolean; method: string }>('/api/admin/session');
        if (
          alive &&
          serial === accessSerial &&
          (!result.authenticated || result.method !== 'password')
        ) {
          publish({ ownerUpdateUrl: '', rooms: [], globalAdmin: false });
          await loadAccess();
        }
      } catch {
        if (alive && serial === accessSerial)
          publish({ ownerUpdateUrl: '', rooms: [], globalAdmin: false });
      }
    },
    command(action: string, extra: Record<string, unknown> = {}) {
      if (!state.detail) return Promise.resolve(null);
      return control('command', {
        commandId: crypto.randomUUID(),
        command: { ...extra, action, queueRevision: state.detail.state.queueRevision },
      });
    },
    async login(password: string) {
      if (state.busy) return;
      publish({ busy: true, error: '' });
      try {
        await call('/api/admin/session', 'POST', { password });
        await loadAccess();
      } catch (error) {
        publish({ error: message(error) });
      } finally {
        publish({ busy: false });
      }
    },
    async logout() {
      retire();
      accessSerial++;
      publish({
        checking: true,
        authenticated: false,
        globalAdmin: false,
        ownerUpdateUrl: '',
        rooms: [],
        guilds: [],
        guildId: '',
        detail: null,
      });
      try {
        await call('/api/admin/session', 'DELETE', {});
        publish({ checking: false });
      } catch (error) {
        publish({ checking: false, error: message(error) });
      }
    },
    async closeRoom(code: string) {
      if (
        !state.globalAdmin ||
        state.busy ||
        !state.rooms.some((room) => room.code === code && room.mode !== 'discord')
      )
        return;
      publish({ busy: true, error: '' });
      try {
        await call('/api/admin/rooms', 'DELETE', { code });
        await loadRooms();
      } catch (error) {
        publish({ error: message(error) });
      } finally {
        publish({ busy: false });
      }
    },
    destroy() {
      alive = false;
      retire();
      accessSerial++;
      listeners.clear();
    },
  };
}
