import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const hash = async (value: string) => createHash('sha256').update(value).digest('hex');
const code = ts.transpileModule(readFileSync(new URL('../lib/guess-server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
async function fixture() {
  const owner = await hash('synthetic-owner'), cohost = await hash('synthetic-cohost');
  const state = { current: null, queue: [], playing: false, position: 0, cohostHashes: [cohost], engineOwnerHash: 'e'.repeat(64) };
  const room = { code: 'TESTROOM', name: 'Synthetic', owner_hash: owner, guild_id: null as string | null,
    state: JSON.stringify(state), expires_at: Date.now() + 60_000 };
  let session: { token_cipher: string } | null = null, configured = true;
  const calls: unknown[][] = [], limits: unknown[][] = [], exports: Record<string, unknown> = {};
  let reads = 0; const rates = new Map<string, number>();
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === '@/lib/server') return {
      body: async (request: Request) => request.json(), hash,
      fail: (status: number, message: string) => { throw Object.assign(new Error(message), { status }); },
      limit: async (...args: unknown[]) => { limits.push(args); const key = String(args[1]); const count = (rates.get(key) ?? 0) + 1; rates.set(key, count); if (count > Number(args[2])) throw Object.assign(Error('Rate limited.'), { status: 429 }); },
      row: async () => { reads++; if (room.expires_at <= Date.now()) throw Object.assign(new Error('Room expired.'), { status: 404 }); return structuredClone(room); },
      isAdmin: () => { throw Error('Owner recovery must never authorize a game.'); },
    };
    if (name === '@/lib/discord-auth') return { discordSession: async () => session };
    if (name === '@/lib/core-server') return { coreUrl: () => configured ? 'https://core.example' : null,
      coreRequest: async (...args: unknown[]) => { calls.push(args); throw Error('Game authority must not import or mutate a room.'); } };
    throw Error('Unexpected module: ' + name);
  } });
  const guessInput = exports.guessInput as (request: Request) => Promise<Record<string, unknown>>;
  const call = (fields: Record<string, unknown>, credential = '') => guessInput(new Request('https://site.example/api/guess', {
    method: 'POST', headers: { 'Content-Type': 'application/json', authorization: credential ? 'Bearer ' + credential : '', cookie: 'gk-admin=synthetic-recovery' },
    body: JSON.stringify({ scope: 'room', scopeId: room.code, action: 'read', ...fields }),
  }));
  return { room, state, calls, limits, call, get reads() { return reads; }, login(value: typeof session) { session = value; }, offline() { configured = false; } };
}

test('game proxy strips forged authority, answers, timestamps and catalog/media fields without owner recovery', async () => {
  const f = await fixture();
  const input = await f.call({ host: true, admin: true, canManage: true, tokenCipher: 'forged', actor: 'forged', userId: 'forged',
    score: 2000, correct: true, answer: 'forged', aliases: ['forged'], receivedAt: 0, startsAt: 0, deadline: 9999999999999,
    mediaKey: 'client-media', mediaUrl: 'https://example.test/client.wav', categories: [{ tracks: [] }], tracks: [],
    roomExpiresAt: 9999999999999, token: 'verified-scoped-token' }, 'synthetic-recovery');
  assert.equal(input.host, false); assert.equal(input.token, 'verified-scoped-token');
  assert.equal(input.roomExpiresAt, f.room.expires_at);
  for (const key of ['admin', 'canManage', 'tokenCipher', 'actor', 'userId', 'score', 'correct', 'answer', 'aliases',
    'receivedAt', 'startsAt', 'deadline', 'mediaKey', 'mediaUrl', 'categories', 'tracks']) assert.equal(key in input, false, key);
  assert.deepEqual(f.calls, []);
  assert(f.limits.every(args => args[4] !== true), 'a visitor cannot charge a shared proxy allowance');
});

test('browser owner/cohost roles and expiry are read fresh, with no playback imports or Discord-room fallback', async () => {
  const f = await fixture();
  assert.equal((await f.call({ action: 'join' }, 'synthetic-owner')).host, true);
  assert.equal((await f.call({}, 'synthetic-cohost')).host, true);
  f.room.state = JSON.stringify({ ...f.state, cohostHashes: [] });
  assert.equal((await f.call({ host: true }, 'synthetic-cohost')).host, false);
  f.room.owner_hash = await hash('replacement-owner');
  assert.equal((await f.call({ host: true }, 'synthetic-owner')).host, false);
  assert.equal((await f.call({}, 'replacement-owner')).host, true);
  f.room.expires_at = Date.now() - 1;
  await assert.rejects(f.call({ roomExpiresAt: Date.now() + 60_000 }, 'replacement-owner'), { status: 404 });
  f.room.expires_at = Date.now() + 60_000; f.room.guild_id = '111111111111111111';
  await assert.rejects(f.call({ action: 'join' }, 'replacement-owner'), { status: 403 });
  f.room.guild_id = null;
  await assert.rejects(f.call({ scopeId: 'DISCORD1' }), { status: 403 });
  assert.deepEqual(f.calls, []);
});

test('guild proxy requires current ordinary sign-in and never inherits recovery or supplied grants', async () => {
  const f = await fixture(), scope = { scope: 'guild', scopeId: '111111111111111111', host: true, tokenCipher: 'forged', roomExpiresAt: 9999999999999 };
  await assert.rejects(f.call(scope, 'synthetic-owner'), { status: 401 });
  f.login({ token_cipher: 'fresh-session-one' });
  const first = await f.call(scope);
  assert.equal(first.tokenCipher, 'fresh-session-one'); assert.equal('host' in first, false); assert.equal('roomExpiresAt' in first, false);
  f.login({ token_cipher: 'fresh-session-two' });
  assert.equal((await f.call(scope)).tokenCipher, 'fresh-session-two');
  f.login(null); await assert.rejects(f.call(scope), { status: 401 });
  await assert.rejects(f.call({ scope: 'activity' }), /Invalid game scope/);
  await assert.rejects(f.call({ scopeId: '../other' }), /Invalid game scope/);
  assert.equal(f.reads, 0); assert.deepEqual(f.calls, []);
  f.offline(); await assert.rejects(f.call({}), { status: 503 });
});

test('configure whitelists setting keys without coercing illegal values, and catalog never imports a room', async () => {
  const f = await fixture();
  const settings = { durationSeconds: 30, roundCount: 5, maxPoints: 1000, minPoints: 100, hints: true };
  const configured = await f.call({ action: 'configure', categoryId: '2010s', settings: { ...settings, score: 9999, source: 'client-upload' } }, 'synthetic-owner');
  assert.deepEqual(JSON.parse(JSON.stringify(configured.settings)), settings);
  const invalid = await f.call({ action: 'configure', settings: { ...settings, durationSeconds: '30', hints: 'true' } });
  assert.equal((invalid.settings as Record<string, unknown>).durationSeconds, '30');
  assert.equal((invalid.settings as Record<string, unknown>).hints, 'true', 'model must receive and reject the illegal type');
  const artist = await f.call({ action: 'configure', settings: { ...settings, answerMode: 'artist' } }, 'synthetic-owner');
  assert.equal((artist.settings as Record<string, unknown>).answerMode, 'artist');
  const badMode = await f.call({ action: 'configure', settings: { ...settings, answerMode: 1 } });
  assert.equal((badMode.settings as Record<string, unknown>).answerMode, 1, 'Core must validate the mode without browser coercion');
  assert.equal((await f.call({ action: 'configure', settings: 'invalid' })).settings, null);
  const reads = f.reads;
  const catalog = await f.call({ action: 'catalog', host: true, categories: ['forged'], mediaUrl: 'forged' });
  assert.deepEqual(JSON.parse(JSON.stringify(catalog)), { action: 'catalog' });
  assert.equal(f.reads, reads); assert.deepEqual(f.calls, []);
});

test('skip votes retain fresh room authority and strip forged vote totals, participant identity and host claims', async () => {
  const f = await fixture();
  const input = await f.call({ action: 'skip', host: true, actor: 'other-player', participantId: 'other-player',
    skipVotes: 64, skipRequired: 1, skipVoted: false, awarded: 2000, answer: 'forged', mediaUrl: 'https://example.test/secret.wav' });
  assert.equal(input.action, 'skip'); assert.equal(input.host, false);
  for (const key of ['actor', 'participantId', 'skipVotes', 'skipRequired', 'skipVoted', 'awarded', 'answer', 'mediaUrl']) assert.equal(key in input, false);
  assert.deepEqual(f.calls, []);
  f.room.owner_hash = await hash('new-owner');
  assert.equal((await f.call({ action: 'skip', host: true }, 'synthetic-owner')).host, false);
  f.room.expires_at = Date.now() - 1;
  await assert.rejects(f.call({ action: 'skip', roomExpiresAt: Date.now() + 60_000 }), { status: 404 });
});

async function audioProxy(fetcher: typeof fetch) {
  const format = await import('../services/core/src/guess-audio-format.ts');
  const source = ts.transpileModule(readFileSync(new URL('../lib/core-server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(source, { exports, URL, Response, AbortSignal, fetch: fetcher, require: (name: string) => {
    if (name === 'cloudflare:workers') return { env: { GUTTA_CORE_PUBLIC_URL: 'https://core.example', ADMIN_BRIDGE_KEY: 'synthetic-bridge-key' } };
    if (name.endsWith('guess-audio-format.ts')) return format;
    throw Error('Unexpected audio proxy dependency: ' + name);
  } });
  return exports.coreGuessAudio as (input: unknown, signal: AbortSignal) => Promise<Response>;
}

test('binary game proxy forwards only the fixed authenticated Core action and returns canonical private WAV', async () => {
  const { guessWave } = await import('../services/core/src/guess-audio-format.ts');
  const wave = guessWave(new Uint8Array(16000 * 2 * 15));
  const input = { action: 'media', scope: 'room', scopeId: 'TESTROOM', token: 'synthetic-game-token' };
  const proxy = await audioProxy((async (url, init) => {
    assert.equal(url, 'https://core.example/v1/guess'); assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'manual'); assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bearer synthetic-bridge-key');
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return new Response(wave.buffer as ArrayBuffer, { headers: { 'Content-Type': 'audio/wav', 'Content-Disposition': 'inline; filename=secret-song.wav', 'X-Provider-Title': 'Secret title', 'Access-Control-Allow-Origin': '*' } });
  }) as typeof fetch);
  const response = await proxy(input, new AbortController().signal);
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  for (const key of ['content-disposition', 'x-provider-title', 'access-control-allow-origin']) assert.equal(response.headers.get(key), null);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), wave);
});

test('binary game proxy rejects metadata, invalid bodies and upstream failures without exposing provider details', async () => {
  for (const response of [new Response('Secret title at https://provider.example/secret.mp3', { status: 403 }),
    new Response('Secret title', { headers: { 'Content-Type': 'application/json' } }),
    new Response('bad', { headers: { 'Content-Type': 'audio/wav' } }),
    new Response('oversized', { headers: { 'Content-Type': 'audio/wav', 'Content-Length': '960045' } })]) {
    const proxy = await audioProxy((async () => response) as typeof fetch);
    await assert.rejects(proxy({ action: 'media' }, new AbortController().signal), error => {
      const failure = error as Error; assert.equal(typeof failure.message, 'string'); assert.equal(failure.message.includes('Secret'), false); assert.equal(failure.message.includes('provider.example'), false); return true;
    });
  }
});

test('media proxy derives fresh authority and propagates cancellation into the bounded Core request', async () => {
  const f = await fixture();
  const input = await f.call({ action: 'media', host: true, mediaKey: 'forged', providerUrl: 'https://provider.example/secret.mp3' });
  assert.equal(input.action, 'media'); assert.equal(input.host, false);
  assert.equal('mediaKey' in input, false); assert.equal('providerUrl' in input, false);
  const controller = new AbortController();
  const proxy = await audioProxy(((_url, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init!.signal!;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    if (signal.aborted) reject(signal.reason);
  })) as typeof fetch);
  const pending = proxy(input, controller.signal); controller.abort(); await assert.rejects(pending);
});

// The fixture enforces each web allowance for requests sharing one synthetic IP.
test('ten players behind one IP can poll for a minute, join and answer within bounded game capacity', async () => {
  const f = await fixture();
  for (let player = 0; player < 10; player++) {
    await f.call({ action: 'join' });
    for (let poll = 0; poll < 24; poll++) await f.call({ action: 'read' });
    await f.call({ action: 'guess', text: 'Test Tone One' });
    await f.call({ action: 'media' });
  }
  assert.equal(f.calls.length, 0, 'game traffic never invokes playback');
  let bounded = false;
  for (let extra = 0; extra < 700; extra++) {
    try { await f.call({ action: 'read' }); } catch (error) { assert.equal((error as { status: number }).status, 429); bounded = true; break; }
  }
  assert(bounded, 'shared-IP game capacity remains bounded');
});
