import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { ConcertState, ConcertView } from '../src/lib/concert/discord-client.ts';
import type { ConcertAudioOptions } from '../src/lib/concert/concert-audio.ts';

const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/lib/browser-api.ts') && specifier === './browser-storage')
      return next('./browser-storage.ts', context);
    return next(specifier, context);
  },
});
const { createDiscordClient } = await import('../src/lib/concert/discord-client.ts');
hook.deregister();
const guildA = '123456789012345678',
  guildB = '223456789012345678';
const video = (concert = true) => ({
  id: 'concert0001',
  entryId: 'entry-1',
  title: concert ? 'Public concert' : 'Private music',
  artist: 'Synthetic artist',
  duration: 180,
  image: '',
  live: false,
  embeddable: true,
  concert,
});
const state = (guildId = guildA): ConcertState => ({
  guildId,
  guildName: 'Synthetic server',
  ready: true,
  connected: true,
  playing: false,
  position: 12,
  volume: 50,
  current: video(),
  queue: [video()],
  queueRevision: 'transport-1',
  lastSeen: 1000,
  online: true,
  playbackKey: 'playback-1',
});
function fixture(
  fetcher: (path: string, init: RequestInit) => Promise<unknown>,
  now?: () => number,
  audio?: ConcertAudioOptions,
) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const data = new Map<string, string>([['afterparty-visitor', 'synthetic-visitor']]);
  const client = createDiscordClient({
    pollMs: 60000,
    now,
    audio,
    storage: {
      get: (key) => data.get(key) ?? null,
      set: (key, value) => {
        data.set(key, value);
        return true;
      },
    },
    request: async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      calls.push({ path, init });
      return (await fetcher(path, init)) as T;
    },
  });
  let view!: ConcertView;
  client.subscribe((value) => {
    view = value;
  });
  return {
    client,
    calls,
    get view() {
      return view;
    },
  };
}
const queue = (canManage = false) => ({
  canManage,
  state: { revision: 'queue-1', queue: [video()], voteCounts: {} },
});

test('a selected guild rejects another guild response and never loads its queue', async () => {
  const f = fixture(async () => ({ state: state(guildB) }));
  try {
    assert.equal(await f.client.connect(guildA), false);
    assert.equal(f.view.connected, false);
    assert.equal(f.view.state, null);
    assert.equal(f.calls.length, 1);
  } finally {
    f.client.destroy();
  }
});

test('a late response cannot replace the selected server even when abort is ignored', async () => {
  let finish!: (value: unknown) => void;
  const slow = new Promise((resolve) => {
    finish = resolve;
  });
  const f = fixture(async (path) =>
    path.includes('/queue') ? queue() : path.includes(guildA) ? slow : { state: state(guildB) },
  );
  try {
    const previous = f.client.connect(guildA);
    await f.client.connect(guildB);
    finish({ state: state(guildA) });
    await previous;
    assert.equal(f.view.guildId, guildB);
    assert.equal(f.view.state?.guildId, guildB);
  } finally {
    f.client.destroy();
  }
});

test('ordinary Discord music is removed from current, queue and requests defensively', async () => {
  const f = fixture(async (path) =>
    path.includes('/queue')
      ? {
          ...queue(),
          state: { revision: 'queue-1', queue: [video(false)], requests: [video(false)] },
        }
      : { state: { ...state(), current: video(false), queue: [video(false)], playing: true } },
  );
  try {
    await f.client.connect(guildA);
    assert.equal(f.view.state?.current, null);
    assert.deepEqual(f.view.state?.queue, []);
    assert.deepEqual(f.view.queue?.state.queue, []);
    assert.deepEqual(f.view.queue?.state.requests, []);
    assert.equal(f.view.state?.playing, false);
    assert.equal(f.view.state?.position, 0);
    assert.equal(await f.client.control('resume'), false);
  } finally {
    f.client.destroy();
  }
});

test('guest voting uses selected guild and queue revision while management stays blocked', async () => {
  const f = fixture(async (path) => (path.includes('/queue') ? queue() : { state: state() }));
  try {
    await f.client.connect(guildA);
    assert.equal(await f.client.queueAction('remove', { videoId: 'entry-1' }), false);
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
    await f.client.queueAction('vote', { videoId: 'entry-1', guildId: guildB, revision: 'forged' });
    const sent = f.calls.find((call) => call.init.method === 'POST')!;
    assert.deepEqual(JSON.parse(String(sent.init.body)), {
      action: 'vote',
      videoId: 'entry-1',
      guildId: guildA,
      revision: 'queue-1',
    });
  } finally {
    f.client.destroy();
  }
});

test('a stale queue conflict refreshes without replaying a mutation', async () => {
  const f = fixture(async (path, init) => {
    if (init.method === 'POST') throw Object.assign(new Error('Queue changed'), { status: 409 });
    return path.includes('/queue') ? queue(true) : { state: state() };
  });
  try {
    await f.client.connect(guildA);
    assert.equal(await f.client.queueAction('remove', { videoId: 'entry-1' }), false);
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 1);
    assert.equal(f.view.error, 'Queue changed');
    assert.equal(f.view.busy, false);
    assert.equal(f.view.connected, true);
  } finally {
    f.client.destroy();
  }
});

test('shared transport captures playback key and command receipt without optimistic success', async () => {
  let receiptId = '';
  const f = fixture(async (path, init) => {
    if (init.method === 'POST') {
      receiptId = 'public:' + JSON.parse(String(init.body)).commandId;
      return { id: receiptId, status: 'pending' };
    }
    if (path.includes('/queue')) return queue();
    return {
      state: state(),
      ...(path.includes('command=')
        ? { command: { id: receiptId, status: 'pending', result: null } }
        : {}),
    };
  });
  try {
    await f.client.connect(guildA);
    await f.client.control('resume');
    const sent = JSON.parse(String(f.calls.find((call) => call.init.method === 'POST')!.init.body));
    assert.equal(sent.guildId, guildA);
    assert.equal(sent.playbackKey, 'playback-1');
    assert.equal(sent.queueRevision, 'transport-1');
    assert.equal(f.view.busy, true);
    assert.match(f.view.notice, /Waiting/);
    assert.equal(f.view.state?.playing, false);
    assert.equal(await f.client.control('resume'), false);
  } finally {
    f.client.destroy();
  }
});

test('read failures disable all controls and reconnect only reads current intent', async () => {
  let broken = false;
  const f = fixture(async (path) => {
    if (broken) throw new Error('Disconnected');
    return path.includes('/queue') ? queue() : { state: state() };
  });
  try {
    await f.client.connect(guildA);
    broken = true;
    await f.client.refresh();
    assert.equal(f.view.connected, false);
    assert.equal(await f.client.control('resume'), false);
    assert.equal(await f.client.queueAction('vote', { videoId: 'entry-1' }), false);
    broken = false;
    await f.client.refresh();
    assert.equal(f.view.connected, true);
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  } finally {
    f.client.destroy();
  }
});

test('a command confirmation deadline releases busy state even while reads fail', async () => {
  let clock = 0,
    broken = false;
  const f = fixture(
    async (path, init) => {
      if (broken) throw new Error('Disconnected');
      if (init.method === 'POST') return { id: 'public:synthetic-command', status: 'pending' };
      return path.includes('/queue') ? queue() : { state: state() };
    },
    () => clock,
  );
  try {
    await f.client.connect(guildA);
    await f.client.control('resume');
    assert.equal(f.view.busy, true);
    broken = true;
    clock = 36000;
    await f.client.refresh();
    assert.equal(f.view.busy, false);
    assert.equal(f.view.connected, false);
    assert.match(f.view.error, /did not confirm/);
    assert.equal(await f.client.control('resume'), false);
    broken = false;
    await f.client.refresh();
    assert.equal(f.view.connected, true);
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 1);
  } finally {
    f.client.destroy();
  }
});

test('bridge polls cannot authorize audio and read loss requires a fresh authoritative frame', async () => {
  let broken = false;
  const stream = {
    readyState: 1,
    onmessage: null as ((event: { data: string }) => void) | null,
    onopen: null,
    onerror: null,
    close() {},
  };
  const f = fixture(
    async (path) => {
      if (broken) throw new Error('Disconnected');
      return path.includes('/queue') ? queue() : { state: { ...state(), playing: true } };
    },
    undefined,
    {
      source: () => stream as unknown as EventSource,
      monotonic: () => 0,
      wallTime: 1000000,
      fetch: (async () => Response.json({ serverTime: 1000000 })) as typeof fetch,
      setInterval: (() => 1) as unknown as typeof setInterval,
      clearInterval: (() => {}) as typeof clearInterval,
    },
  );
  const emit = (sequence: number, playing: boolean) =>
    stream.onmessage?.({
      data: JSON.stringify({
        type: 'state',
        state: {
          ...state(),
          playing,
          engine: 'gutta-krutt-core',
          epoch: 'epoch-1',
          sequence,
          serverTime: 1000000,
          buffering: false,
        },
      }),
    });
  try {
    await f.client.connect(guildA);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.client.playback().playing, false);
    emit(1, true);
    assert.equal(f.client.playback().playing, true);
    broken = true;
    await f.client.refresh();
    assert.equal(f.client.playback().playing, false);
    assert.equal(f.view.audioRoom, null);
    broken = false;
    await f.client.refresh();
    assert.equal(f.client.playback().playing, false);
    emit(2, false);
    assert.equal(f.view.audioLive, true);
    assert.equal(f.client.playback().playing, false);
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  } finally {
    f.client.destroy();
  }
});
