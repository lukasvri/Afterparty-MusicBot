import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { GameResponse, GameView } from '../src/lib/game-client.ts';
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/lib/browser-api.ts') && specifier === './browser-storage')
      return next('./browser-storage.ts', context);
    return next(specifier, context);
  },
});
const { createGameClient } = await import('../src/lib/game-client.ts');
hook.deregister();
const response = (revision = 1): GameResponse => ({
  canManage: true,
  token: 'scoped-synthetic-token',
  sourceState: 'ready',
  mediaAvailable: false,
  self: { participantId: 'player', result: null, skipVoted: false },
  game: {
    scope: 'room',
    scopeId: 'ROOM0001',
    sessionId: '11111111-1111-4111-8111-111111111111',
    gameId: 'game',
    revision,
    phase: 'lobby',
    serverTime: 1000,
    categoryId: 'synthetic-test',
    settings: {
      durationSeconds: 30,
      roundCount: 1,
      maxPoints: 1000,
      minPoints: 100,
      hints: true,
      answerMode: 'title',
    },
    categories: [{ id: 'synthetic-test', name: 'Synthetic test', available: true, count: 1 }],
    scoreboard: [{ id: 'player', nickname: 'Player', total: 0, hasAnswered: false }],
    answeredCount: 0,
    roundNumber: 0,
    round: null,
  },
});
function fixture(request: (init: RequestInit) => Promise<Response>) {
  let state!: GameView;
  const storage = new Map<string, string>();
  const client = createGameClient(
    { scope: 'room', scopeId: 'ROOM0001', nickname: 'Synthetic player' },
    {
      fetch: (async (_url, init) => request(init!)) as typeof fetch,
      headers: () => ({
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-host',
      }),
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
        removeItem: (key) => {
          storage.delete(key);
        },
      },
      visible: () => true,
      now: () => 50,
    },
  );
  client.subscribe((value) => {
    state = value;
  });
  return { client, storage, state: () => state };
}
test('scoped grants are reused and every mutation carries current session, round, revision and unique id', async () => {
  const bodies: Record<string, unknown>[] = [];
  const f = fixture(async (init) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    return Response.json(response(bodies.length));
  });
  try {
    await f.client.refresh();
    await f.client.act('configure', {
      settings: response().game.settings,
      revision: 1,
      scopeId: 'OTHER001',
      token: 'attacker',
    });
    assert.equal(bodies[0].action, 'join');
    assert.equal(bodies[1].scopeId, 'ROOM0001');
    assert.equal(bodies[1].token, 'scoped-synthetic-token');
    assert.equal(bodies[1].sessionId, response().game.sessionId);
    assert.equal(bodies[1].revision, 1);
    assert.equal(bodies[1].roundId, null);
    assert.notEqual(bodies[0].eventId, bodies[1].eventId);
    assert.match(String(bodies[1].eventId), /^[a-f0-9-]{36}$/);
    assert.equal(f.storage.get('afterparty-guess:room:ROOM0001'), 'scoped-synthetic-token');
    assert.equal(f.state().ready, true);
  } finally {
    f.client.destroy();
  }
});
test('stale or cross-room snapshots cannot replace accepted game state', async () => {
  let calls = 0;
  const f = fixture(async () => {
    const data = response(++calls === 1 ? 5 : 4);
    if (calls === 3) {
      data.game.revision = 6;
      data.game.scopeId = 'OTHER001';
    }
    return Response.json(data);
  });
  try {
    await f.client.refresh();
    await f.client.refresh();
    assert.equal(f.state().data?.game.revision, 5);
    assert.equal(f.state().ready, false);
    await f.client.refresh();
    assert.equal(f.state().data?.game.scopeId, 'ROOM0001');
    assert.equal(f.state().ready, false);
  } finally {
    f.client.destroy();
  }
});
test('an expired anonymous grant rejoins and a failed mutation is never replayed', async () => {
  const actions: string[] = [];
  const f = fixture(async (init) => {
    const body = JSON.parse(String(init.body));
    actions.push(body.action);
    if (body.action === 'start') return Response.json({ error: 'Grant expired.' }, { status: 419 });
    if (actions.length === 3) assert.equal('token' in body, false);
    return Response.json(response());
  });
  try {
    await f.client.refresh();
    await f.client.act('start');
    assert.equal(f.state().ready, false);
    assert.equal(f.storage.size, 0);
    await f.client.refresh();
    assert.deepEqual(actions, ['join', 'start', 'join']);
    assert.equal(f.state().ready, true);
  } finally {
    f.client.destroy();
  }
});
test('destroy aborts in-flight requests and late responses do not publish', async () => {
  let complete!: (value: Response) => void, signal: AbortSignal | undefined;
  const f = fixture((init) => {
    signal = init.signal as AbortSignal;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const pending = f.client.refresh();
  const before = f.state();
  f.client.destroy();
  assert.equal(signal?.aborted, true);
  complete(Response.json(response()));
  await pending;
  assert.equal(f.state(), before);
});
test('an explicit command preempts a background read without accepting its late response', async () => {
  let complete!: (value: Response) => void,
    reads = 0;
  const f = fixture(async (init) => {
    const body = JSON.parse(String(init.body));
    if (body.action === 'read' && ++reads === 1)
      return new Promise((resolve) => {
        complete = resolve;
      });
    return Response.json(response(body.action === 'configure' ? 3 : 1));
  });
  try {
    await f.client.refresh();
    const background = f.client.refresh();
    await f.client.act('configure', { settings: response().game.settings });
    complete(Response.json(response(2)));
    await background;
    assert.equal(f.state().data?.game.revision, 3);
    assert.equal(f.state().busy, false);
  } finally {
    f.client.destroy();
  }
});

test('preview requests use the scoped grant and reject clips after a round changes', async () => {
  const { guessWave } = await import('../../../services/core/src/guess-audio-format.ts');
  let complete!: (value: Response) => void;
  let read = 0;
  const f = fixture(async (init) => {
    const input = JSON.parse(String(init.body));
    if (input.action === 'media') {
      assert.equal(input.token, 'scoped-synthetic-token');
      assert.equal(input.scopeId, 'ROOM0001');
      assert.equal(input.roundId, 'round-one');
      return new Promise((resolve) => {
        complete = resolve;
      });
    }
    const data = response(++read);
    data.game.phase = read === 1 ? 'round' : 'reveal';
    data.game.round = { roundId: 'round-one', startsAt: 1000, deadline: 31000, hints: {} };
    return Response.json(data);
  });
  try {
    await f.client.refresh();
    const pending = f.client.media(new AbortController().signal);
    const rejected = assert.rejects(pending, /round changed/);
    await f.client.refresh();
    complete(
      new Response(guessWave(new Uint8Array([0, 0])).buffer as ArrayBuffer, {
        headers: { 'Content-Type': 'audio/wav' },
      }),
    );
    await rejected;
  } finally {
    f.client.destroy();
  }
});

test('preview authorization expiry retires readiness and the scoped anonymous grant', async () => {
  const f = fixture(async (init) => {
    const input = JSON.parse(String(init.body));
    if (input.action === 'media') return Response.json({ error: 'Expired' }, { status: 419 });
    const data = response();
    data.game.phase = 'round';
    data.game.round = { roundId: 'round-one', startsAt: 1000, deadline: 31000, hints: {} };
    return Response.json(data);
  });
  try {
    await f.client.refresh();
    await assert.rejects(f.client.media(new AbortController().signal), /unavailable/);
    assert.equal(f.state().ready, false);
    assert.equal(f.storage.size, 0);
  } finally {
    f.client.destroy();
  }
});
