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
  let reads = 0;
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === '@/lib/server') return {
      body: async (request: Request) => request.json(), hash,
      fail: (status: number, message: string) => { throw Object.assign(new Error(message), { status }); },
      limit: async (...args: unknown[]) => { limits.push(args); },
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
  assert.equal((await f.call({ action: 'configure', settings: 'invalid' })).settings, null);
  const reads = f.reads;
  const catalog = await f.call({ action: 'catalog', host: true, categories: ['forged'], mediaUrl: 'forged' });
  assert.deepEqual(JSON.parse(JSON.stringify(catalog)), { action: 'catalog' });
  assert.equal(f.reads, reads); assert.deepEqual(f.calls, []);
});
