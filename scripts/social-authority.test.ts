import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as socialProtocol from '../services/core/src/social-protocol.ts';
import {createReactionWindow} from '../lib/social-reactions.ts';

const hash = async (value: string) => createHash('sha256').update(value).digest('hex');
const code = ts.transpileModule(readFileSync(new URL('../lib/social-server.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
async function fixture() {
  const owner = await hash('synthetic-owner'), cohost = await hash('synthetic-cohost');
  const state = {current: null, queue: [], playing: false, position: 0, cohostHashes: [cohost], engineOwnerHash: 'e'.repeat(64)};
  const room = {code: 'TESTROOM', name: 'Synthetic', owner_hash: owner, guild_id: null as string | null, state: JSON.stringify(state)};
  let session: {token_cipher: string} | null = null, configured = true;
  const calls: unknown[][] = [], limits: unknown[][] = [];
  const exports: Record<string, unknown> = {};
  runInNewContext(code, {exports, require: (name: string) => {
    if (name === '../services/core/src/social-protocol.ts') return socialProtocol;
    if (name === '@/lib/server') return {
      body: async (request: Request) => request.json(), hash,
      fail: (status: number, message: string) => {throw Object.assign(new Error(message), {status});},
      limit: async (...args: unknown[]) => {limits.push(args);}, row: async () => structuredClone(room),
    };
    if (name === '@/lib/discord-auth') return {discordSession: async () => session};
    if (name === '@/lib/core-server') return {coreUrl: () => configured ? 'https://core.example' : null, coreRequest: async (...args: unknown[]) => {calls.push(args); return {};}};
    throw Error('Unexpected module: ' + name);
  }});
  const socialInput = exports.socialInput as (request: Request) => Promise<Record<string, unknown>>;
  const call = (fields: Record<string, unknown>, credential = '') => socialInput(new Request('https://site.example/api/social', {
    method: 'POST', headers: {'Content-Type': 'application/json', authorization: credential ? 'Bearer ' + credential : '', cookie: 'gk-admin=synthetic-recovery'},
    body: JSON.stringify({scope: 'room', scopeId: room.code, action: 'read', ...fields}),
  }));
  return {room, state, calls, limits, call, login(value: typeof session) {session = value;}, offline() {configured = false;}};
}

test('website social authority strips forged roles, grants, identities and timestamps', async () => {
  const f = await fixture();
  const input = await f.call({host: true, admin: true, canManage: true, actorHash: 'forged', tokenCipher: 'forged', userId: 'forged', position: 9999, token: 'scoped-session'});
  assert.equal(input.host, false); assert.equal(input.token, 'scoped-session');
  for (const key of ['admin', 'canManage', 'actorHash', 'tokenCipher', 'userId', 'position']) assert.equal(key in input, false, key);
  assert.deepEqual(f.calls, []);
  assert(f.limits.every(args => args[4] !== true), 'unverified participant input must not spend a shared proxy budget');
});
test('room owner/cohost authority is recomputed and join imports immutable engine ownership only once', async () => {
  const f = await fixture();
  assert.equal((await f.call({action: 'join'}, 'synthetic-owner')).host, true);
  assert.equal((await f.call({}, 'synthetic-cohost')).host, true);
  f.room.state = JSON.stringify({...f.state, cohostHashes: []});
  assert.equal((await f.call({host: true}, 'synthetic-cohost')).host, false);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], '/v1/rooms');
  const imported = f.calls[0][2] as Record<string, unknown>;
  assert.equal(imported.operation, 'import'); assert.equal(imported.owner_hash, f.state.engineOwnerHash);
});
test('guild social requires ordinary Discord sign-in and ignores owner recovery and supplied grants', async () => {
  const f = await fixture();
  const guild = {scope: 'guild', scopeId: '111111111111111111', host: true, tokenCipher: 'forged'};
  await assert.rejects(f.call(guild, 'synthetic-owner'), /Sign in with Discord/);
  f.login({token_cipher: 'verified-website-session'});
  const input = await f.call(guild);
  assert.equal(input.tokenCipher, 'verified-website-session'); assert.equal('host' in input, false);
  assert.deepEqual(f.calls, []);
});
test('Discord-linked browser scope, invalid scopes and missing Core cannot become a fallback social authority', async () => {
  const f = await fixture(); f.room.guild_id = '111111111111111111';
  await assert.rejects(f.call({action: 'join'}, 'synthetic-owner'), /through its Discord server/);
  await assert.rejects(f.call({scope: 'activity'}), /Choose a room or server/);
  await assert.rejects(f.call({scopeId: '../other'}), /Invalid social scope/);
  f.offline();
  await assert.rejects(f.call({}), (error: unknown) => typeof error === 'object' && error !== null && 'status' in error && error.status === 503);
  assert.deepEqual(f.calls, []);
});

test('the shared social contract rejects malformed frames in either frontend', () => {
  const state: socialProtocol.SocialState = {scope: 'room', scopeId: 'TESTROOM', playbackKey: 'track', revision: 1, enabled: true, reactions: [], highlights: [], bingo: null};
  assert.equal(socialProtocol.validSocial(state), true);
  assert.equal(socialProtocol.validSocial({...state, revision: -1}), false);
  assert.equal(socialProtocol.validSocial({...state, reactions: [{id: 'event', emoji: 'invalid', at: 0}]}), false);
  const bingo = {active: true, marked: [], cells: Array.from({length: 9}, (_, n) => `Cell ${n}`)};
  assert.equal(socialProtocol.validSocial({...state, bingo}), true);
  assert.equal(socialProtocol.validSocial({...state, bingo: {...bingo, cells: Array(9).fill('same')}}), false);
  assert.equal(socialProtocol.validSocial({...state, bingo: {...bingo, cells: [...bingo.cells.slice(0, 8), 'bad\u0000text']}}), false);
});

test('shared reaction receipt windows expire repeated frames and stay isolated', () => {
  let at = 0;
  const first = createReactionWindow(() => at), second = createReactionWindow(() => at);
  const events = [{id: 'event', emoji: '🔥', at: 123456}];
  assert.deepEqual(first.merge([], events), events);
  at = 6000;
  assert.deepEqual(first.merge(events, events), []);
  assert.deepEqual(second.merge([], events), events);
  first.clear();
  assert.deepEqual(first.merge([], events), events);
  const many = Array.from({length: 40}, (_, n) => ({...events[0], id: `event-${n}`}));
  assert.deepEqual(first.merge([], many), many.slice(-20));
});
