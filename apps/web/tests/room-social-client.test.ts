import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRoomSocialClient,
  validSocial,
  type SocialView,
} from '../src/lib/social/room-social-client.ts';
import type { SocialState } from '../../../services/core/src/social.ts';
const code = 'TESTROOM',
  playbackKey = 'synthetic-playback';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const social = (overrides: Partial<SocialState> = {}): SocialState => ({
  scope: 'room',
  scopeId: code,
  playbackKey,
  revision: 5,
  enabled: true,
  reactions: [],
  highlights: [],
  bingo: null,
  ...overrides,
});
function fixture(
  options: {
    host?: boolean;
    stream?: boolean;
    handler?: (
      body: Record<string, unknown>,
      path: string,
      init: RequestInit,
    ) => Response | undefined | Promise<Response | undefined>;
  } = {},
) {
  let state!: SocialView,
    at = 0,
    available = true;
  const calls: Array<{ path: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const values = new Map<string, string>([[`afterparty-host:${code}`, 'a'.repeat(64)]]);
  const client = createRoomSocialClient(
    { code, playbackKey },
    {
      stream: options.stream ?? false,
      now: () => at,
      available: () => available,
      storage: {
        get: (key) => values.get(key) ?? null,
        set: (key, value) => {
          values.set(key, value);
          return true;
        },
      },
      setTimeout: ((fn: () => void, ms: number) => {
        const timer = { fn, ms, cancelled: false };
        timers.push(timer);
        return timer;
      }) as unknown as typeof setTimeout,
      clearTimeout: ((timer: { cancelled: boolean }) => {
        timer.cancelled = true;
      }) as unknown as typeof clearTimeout,
      fetch: (async (path: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        calls.push({ path, init, body });
        const result = await options.handler?.(body, path, init);
        if (result) return result;
        return Response.json({
          social: social(),
          ...(body.action === 'join' ? { token: 'synthetic.scoped-grant' } : {}),
          canManage: options.host ?? false,
        });
      }) as typeof fetch,
    },
  );
  client.subscribe((value) => (state = value));
  return {
    client,
    calls,
    timers,
    state: () => state,
    now(value: number) {
      at = value;
    },
    availability(value: boolean) {
      available = value;
    },
  };
}

test('social joins only on explicit start, preserves room headers and protects authority fields', async () => {
  const f = fixture({ host: true });
  try {
    assert.equal(f.calls.length, 0);
    f.client.start();
    await tick();
    assert.equal(f.calls[0].body.action, 'join');
    assert.equal(f.calls[0].body.scopeId, code);
    assert.equal(
      (f.calls[0].init.headers as Record<string, string>).Authorization,
      `Bearer ${'a'.repeat(64)}`,
    );
    assert((f.calls[0].init.headers as Record<string, string>)['X-Afterparty-Visitor']);
    assert(f.state().ready);
    await f.client.act('configure', {
      enabled: false,
      scopeId: 'OTHERONE',
      scope: 'guild',
      revision: 999,
      eventId: 'forged',
      action: 'highlight',
      token: 'forged',
    });
    const write = f.calls.at(-1)!.body;
    assert.equal(write.scope, 'room');
    assert.equal(write.scopeId, code);
    assert.equal(write.playbackKey, playbackKey);
    assert.equal(write.action, 'configure');
    assert.equal(write.revision, 5);
    assert.equal(write.token, 'synthetic.scoped-grant');
    assert.match(String(write.eventId), /^[a-f0-9-]{36}$/);
    assert(f.calls.every((call) => call.init.cache === 'no-store'));
  } finally {
    f.client.destroy();
  }
});

test('guest actions never become host controls and reaction throttling does not replay events', async () => {
  const f = fixture();
  try {
    f.client.start();
    await tick();
    assert.equal(await f.client.act('configure', { enabled: false }), false);
    assert.equal(f.calls.length, 1);
    assert.equal(await f.client.act('reaction', { emoji: '🔥' }), true);
    assert.equal(await f.client.act('reaction', { emoji: '🔥' }), false);
    f.now(1501);
    assert.equal(await f.client.act('reaction', { emoji: '👏' }), true);
    assert.equal(f.calls.filter((call) => call.body.action === 'reaction').length, 2);
  } finally {
    f.client.destroy();
  }
});

test('conflicting social event is reconciled with a read and never replayed', async () => {
  const f = fixture({
    handler: (body) =>
      body.action === 'highlight'
        ? Response.json({ error: 'changed' }, { status: 409 })
        : undefined,
  });
  try {
    f.client.start();
    await tick();
    assert.equal(await f.client.act('highlight', { text: 'The chorus' }), false);
    assert.deepEqual(
      f.calls.map((call) => call.body.action),
      ['join', 'highlight', 'read'],
    );
    assert.equal(f.state().ready, true);
    assert.equal(f.state().busy, false);
  } finally {
    f.client.destroy();
  }
});

test('revoked authority disables moderation and requires a fresh authority read', async () => {
  const f = fixture({
    host: true,
    handler: (body) =>
      body.action === 'configure' ? Response.json({}, { status: 403 }) : undefined,
  });
  try {
    f.client.start();
    await tick();
    assert(f.state().canManage);
    assert.equal(await f.client.act('configure', { enabled: false }), false);
    assert.equal(f.state().ready, false);
    assert.equal(f.state().canManage, false);
    assert.equal(await f.client.act('highlight', { text: 'Do not send' }), false);
    assert.deepEqual(
      f.calls.map((call) => call.body.action),
      ['join', 'configure'],
    );
    f.client.reconnect();
    await tick();
    assert.equal(f.calls.at(-1)!.body.action, 'read');
  } finally {
    f.client.destroy();
  }
});

test('destroyed room rejects late mutation responses and aborts its requests', async () => {
  let release: ((response: Response) => void) | undefined;
  const f = fixture({
    handler: (body) =>
      body.action === 'highlight'
        ? new Promise((resolve) => {
            release = resolve;
          })
        : undefined,
  });
  f.client.start();
  await tick();
  const send = f.client.act('highlight', { text: 'A late moment' });
  const signal = f.calls.at(-1)!.init.signal!;
  const before = f.state();
  f.client.destroy();
  assert(signal.aborted);
  release!(
    Response.json({
      social: social({
        highlights: [
          { id: 'late', text: 'A late moment', videoId: 'synthetic01', position: 30, at: 123 },
        ],
      }),
    }),
  );
  assert.equal(await send, false);
  assert.equal(f.state(), before);
  assert.equal(f.calls.filter((call) => call.body.action === 'highlight').length, 1);
});

test('offline or hidden state retires access and reconnect never replays a prior event', async () => {
  const f = fixture();
  try {
    f.client.start();
    await tick();
    await f.client.act('highlight', { text: 'A moment' });
    f.availability(false);
    f.client.reconnect();
    assert.equal(f.state().ready, false);
    assert.equal(await f.client.act('reaction', { emoji: '🔥' }), false);
    f.availability(true);
    f.client.reconnect();
    await tick();
    assert.deepEqual(
      f.calls.map((call) => call.body.action),
      ['join', 'highlight', 'read'],
    );
  } finally {
    f.client.destroy();
  }
});

test('SSE refuses frames for another room or playback and never exposes their messages', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const f = fixture({
    stream: true,
    handler: (_body, path) =>
      path.endsWith('/stream')
        ? new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller;
              },
              cancel() {
                cancelled = true;
              },
            }),
          )
        : undefined,
  });
  try {
    f.client.start();
    await tick();
    assert(f.state().ready);
    const wrong = social({
      scopeId: 'OTHERONE',
      revision: 99,
      highlights: [
        {
          id: 'private',
          text: 'Other room private note',
          videoId: 'synthetic01',
          position: 10,
          at: 1,
        },
      ],
    });
    stream.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify({ social: wrong, canManage: true })}\n\n`),
    );
    await tick();
    assert.equal(f.state().ready, false);
    assert.equal(f.state().canManage, false);
    assert.deepEqual(f.state().social?.highlights, []);
    assert.equal(f.state().social?.scopeId, code);
    assert(cancelled);
  } finally {
    f.client.destroy();
  }
});

test('SSE handles split frames, rejects older revisions and does not revive expired reactions', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const f = fixture({
    stream: true,
    handler: (_body, path) =>
      path.endsWith('/stream')
        ? new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller;
              },
            }),
          )
        : undefined,
  });
  const emit = (value: SocialState) =>
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ social: value })}\n\n`));
  try {
    f.client.start();
    await tick();
    const current = social({
      revision: 6,
      reactions: [{ id: 'reaction-1', emoji: '🔥', at: 900 }],
    });
    const frame = `data: ${JSON.stringify({ social: current })}\r\n\r\n`,
      split = frame.length - 3;
    stream.enqueue(new TextEncoder().encode(frame.slice(0, split)));
    stream.enqueue(new TextEncoder().encode(frame.slice(split)));
    await tick();
    assert.equal(f.state().social?.revision, 6);
    assert.equal(f.state().social?.reactions.length, 1);
    emit(social({ revision: 5, enabled: false }));
    await tick();
    assert.equal(f.state().social?.enabled, true);
    f.now(6100);
    f.timers.find((timer) => timer.ms === 2000 && !timer.cancelled)!.fn();
    assert.equal(f.state().social?.reactions.length, 0);
    emit(current);
    await tick();
    assert.equal(f.state().social?.reactions.length, 0);
  } finally {
    f.client.destroy();
  }
});

test('expired grants are dropped and cannot send a social mutation', async () => {
  const f = fixture({
    handler: (body) =>
      body.action === 'highlight' ? Response.json({}, { status: 401 }) : undefined,
  });
  try {
    f.client.start();
    await tick();
    await f.client.act('highlight', { text: 'expired' });
    assert.equal(f.state().ready, false);
    assert.equal(await f.client.act('reaction', { emoji: '🔥' }), false);
    f.client.reconnect();
    await tick();
    assert.equal(f.calls.at(-1)!.body.action, 'join');
  } finally {
    f.client.destroy();
  }
});

test('social payload validation bounds messages, reactions and bingo', () => {
  assert(validSocial(social()));
  assert(
    !validSocial(
      social({
        highlights: [
          {
            id: 'bad',
            text: '<script>plain text</script>',
            videoId: 'invalid',
            position: 10,
            at: 1,
          },
        ],
      }),
    ),
  );
  assert(!validSocial(social({ reactions: [{ id: 'bad', emoji: '<svg>', at: 1 }] })));
  assert(
    !validSocial(
      social({ bingo: { cells: Array(9).fill('Same square'), marked: [], active: true } }),
    ),
  );
  assert(!validSocial(social({ revision: Infinity })));
});
