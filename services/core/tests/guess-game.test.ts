import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GuessGame, DEFAULT_GUESS_SETTINGS, type GuessAccess, type GuessSettings } from '../src/guess-game.ts';
import { OperatorGuessCatalog, type GuessCatalog, type OperatorGuessRecord } from '../src/guess-catalog.ts';

const host: GuessAccess = { scope: 'room', scopeId: 'ROOM0001', host: true, actor: 'private-anonymous-host-grant' };
const guest: GuessAccess = { ...host, host: false, actor: 'private-anonymous-guest-grant' };
function records(count = 20): OperatorGuessRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1, key = `synthetic_media_${String(n).padStart(4, '0')}`;
    return { rightsCleared: true, categoryIds: ['2010s'],
      song: { id: `synthetic-${n}`, title: `Fictional Signal ${n}`, artist: `Sample Artist ${n}`, aliases: [`Invented Alias ${n}`, `Déjà Vu ${n}`], mediaKey: key },
      media: { key, mimeType: 'audio/wav', durationSeconds: 120 } };
  });
}
function fixture(catalog: GuessCatalog = new OperatorGuessCatalog(records(), () => 0)) {
  let time = 1_000_000, sequence = 0;
  const id = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const model = new GuessGame({ catalog, now: () => time, id });
  let current = model.apply(host, { action: 'join', eventId: id(), nickname: 'Red' }).game;
  const command = (action: string, fields: Record<string, unknown> = {}, access = host) => {
    const result = model.apply(access, { action, sessionId: current.sessionId, roundId: current.round?.roundId ?? null,
      revision: current.revision, eventId: id(), ...fields });
    current = result.game; return result;
  };
  const join = (access = guest, nickname?: string) => {
    const result = model.apply(access, { action: 'join', eventId: id(), ...(nickname !== undefined ? { nickname } : {}) });
    current = result.game; return result;
  };
  const read = (access = host) => { const result = model.apply(access, { action: 'read' }); current = result.game; return result; };
  return { model, id, command, read, join, get current() { return current; },
    configure: (settings: Partial<GuessSettings> = {}) => command('configure', { categoryId: '2010s', settings: { ...DEFAULT_GUESS_SETTINGS, ...settings } }),
    setTime: (next: number) => { time = next; }, now: () => time };
}

test('join creates anonymous stable participants, validates nicknames and requires joined actors for reads', () => {
  const f = fixture();
  assert.throws(() => f.read(guest), { status: 403 });
  const joined = f.join(); assert.equal(joined.game.scoreboard[1].nickname, 'Player 2');
  const rejoined = f.join(guest, 'Changed nickname');
  assert.equal(rejoined.self.participantId, joined.self.participantId);
  assert.equal(rejoined.game.scoreboard.find(player => player.id === joined.self.participantId)!.nickname, 'Player 2');
  assert.equal(rejoined.game.revision, joined.game.revision);
  for (const nickname of ['', ' ', 'x'.repeat(25), 'Bad\nName', 'Bad\u202eName', 12]) {
    assert.throws(() => f.model.apply({ ...guest, actor: 'new-actor' }, { action: 'join', eventId: f.id(), nickname }), /nickname/);
  }
  const serialized = JSON.stringify(f.read(guest));
  assert.equal(serialized.includes(host.actor), false); assert.equal(serialized.includes(guest.actor), false);
  const initial = new GuessGame();
  assert.throws(() => initial.apply(host, { action: 'read' }), { status: 403 });
});

test('default production games expose unavailable categories and cannot start invented music', () => {
  let n = 0; const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const model = new GuessGame({ id });
  const joined = model.apply(host, { action: 'join', eventId: id() });
  assert(joined.game.categories.every(category => !category.available && category.count === 0));
  assert.deepEqual(joined.game.settings, DEFAULT_GUESS_SETTINGS);
  assert.throws(() => model.apply(host, { action: 'start', sessionId: joined.game.sessionId, roundId: null,
    revision: joined.game.revision, eventId: id() }), { status: 503 });
  assert.equal(model.apply(host, { action: 'read' }).game.phase, 'lobby');
});

test('host authorization and strict action fields reject forged roles, catalogs, scores and media before quotas', () => {
  const f = fixture(); f.join();
  for (let n = 0; n < 300; n++) for (const action of ['configure', 'start', 'next', 'reveal', 'end', 'reset']) {
    assert.throws(() => f.command(action, { host: true }, guest), { status: 403 });
  }
  assert.throws(() => f.model.apply(host, { action: { toString: () => 'start' } }), /Unknown/);
  for (const fields of [{ tracks: [] }, { categories: [] }, { mediaUrl: 'https://example.test/source.wav' }, { score: 10000 }, { correct: true }]) {
    assert.throws(() => f.command('configure', { ...fields, categoryId: '2010s', settings: DEFAULT_GUESS_SETTINGS }), /field/);
  }
  f.configure(); f.command('start');
  assert.equal(f.current.phase, 'round');
});

test('settings validate all types/ranges and freeze a complete game and each round without rescoring', () => {
  const f = fixture();
  const invalid: unknown[] = [null, {}, [], { ...DEFAULT_GUESS_SETTINGS, extra: true }];
  for (const [key, values] of Object.entries({ durationSeconds: [14, 91, 30.5, '30', NaN], roundCount: [0, 21, '5', Infinity],
    maxPoints: [99, 2001, '1000'], minPoints: [-1, 1001, '100'], hints: [0, 'true', undefined] })) {
    for (const value of values) invalid.push({ ...DEFAULT_GUESS_SETTINGS, [key]: value });
  }
  for (const settings of invalid) assert.throws(() => f.command('configure', { categoryId: '2010s', settings }));
  assert.throws(() => f.command('configure', { categoryId: 'custom-upload', settings: DEFAULT_GUESS_SETTINGS }), /category/);
  const chosen = { ...DEFAULT_GUESS_SETTINGS, durationSeconds: 15, roundCount: 2, maxPoints: 2000, minPoints: 0, hints: false };
  f.command('configure', { categoryId: '2010s', settings: chosen }); chosen.maxPoints = 100;
  f.command('start'); f.setTime(f.current.round!.startsAt);
  assert.equal(f.current.round!.deadline - f.current.round!.startsAt, 15_000);
  assert.equal(f.command('guess', { text: 'Fictional Signal 1' }).self.result!.awarded, 2000);
  assert.throws(() => f.configure({ maxPoints: 100 }), /lobby/);
  f.current.settings.maxPoints = 100;
  f.command('reveal'); f.command('next');
  assert.equal(f.read().game.settings.maxPoints, 2000);
  assert.equal(f.current.scoreboard[0].total, 2000);
  f.setTime(f.current.round!.startsAt + 14_000);
  assert.deepEqual(f.read().game.round!.hints, {});
});

test('competitive scoring awards every actor independently using server receipt time and exact trusted aliases', () => {
  const f = fixture(); const other = { ...guest, actor: 'private-third-grant' };
  const green = { ...guest, actor: 'private-fourth-grant' };
  f.join(guest, 'Blue'); f.join(other, 'Gold'); f.join(green, 'Green'); f.configure({ roundCount: 1 }); f.command('start');
  assert.throws(() => f.command('guess', { text: 'Fictional Signal 1' }, guest), /accepting/);
  const startsAt = f.current.round!.startsAt;
  f.setTime(startsAt);
  for (const text of ['', ' ', '!', 'Bad\u0000guess', 'Bad\u202eguess', 'x'.repeat(121)]) {
    assert.throws(() => f.command('guess', { text }, guest), /short|control/);
  }
  for (const text of ['Fictional', 'Fictional Signal', 'Fictional Signal 1 extra', 'Invented Alias 2']) {
    assert.deepEqual(f.command('guess', { text }, guest).self.result, { correct: false, awarded: 0 });
  }
  assert.deepEqual(f.command('guess', { text: 'DE\u0301JA---VU 1!!' }, guest).self.result, { correct: true, awarded: 1000 });
  assert.equal(f.current.phase, 'round'); assert.equal(f.current.round!.answer, undefined);
  f.setTime(startsAt + 15_000);
  assert.deepEqual(f.command('guess', { text: 'Invented Alias 1' }, other).self.result, { correct: true, awarded: 550 });
  f.setTime(startsAt + 29_999);
  assert.deepEqual(f.command('guess', { text: 'Fictional Signal 1' }, green).self.result, { correct: true, awarded: 100 });
  assert.equal(f.current.answeredCount, 3);
  assert.deepEqual(f.read(guest).self.result, { correct: true, awarded: 1000 });
  assert.equal(f.read().self.result, null);
  assert.throws(() => f.command('guess', { text: 'Fictional Signal 1' }, guest), /accepting/);
  f.setTime(startsAt + 30_000);
  const scores = f.read().game.scoreboard.map(player => player.total);
  assert.deepEqual(scores, [1000, 550, 100, 0]);
  assert.equal(f.current.phase, 'reveal');
  assert.equal(f.current.round!.answer!.title, 'Fictional Signal 1');
});

test('scoring limits include constant points and a zero minimum without accepting deadline answers', () => {
  for (const [minPoints, elapsed, expected] of [[100, 0, 100], [100, 14_999, 100], [0, 14_999, 0]]) {
    const f = fixture(); f.configure({ durationSeconds: 15, roundCount: 1, maxPoints: 100, minPoints }); f.command('start');
    f.setTime(f.current.round!.startsAt + elapsed);
    const result = f.command('guess', { text: 'Fictional Signal 1' });
    assert.equal(result.self.result!.awarded, expected);
    assert.equal(result.game.answeredCount, 1, 'a zero-point correct answer is still final for this actor');
    assert.throws(() => f.command('guess', { text: 'Invented Alias 1' }), { status: 409 });
  }
  for (const delay of [0, 60_000]) {
    const f = fixture(); f.configure(); f.command('start'); const round = f.current.round!, revision = f.current.revision;
    f.setTime(round.deadline + delay);
    assert.throws(() => f.command('guess', { text: 'Fictional Signal 1' }), { status: 409 });
    const result = f.read(); assert.equal(result.game.revision, revision + 1); assert.equal(result.game.phase, 'reveal');
    assert.equal(result.game.scoreboard[0].total, 0); assert.equal(result.self.result, null);
    assert.equal(f.read().game.revision, revision + 1);
  }
});

test('hints use the server clock and configured round duration, never a client timestamp', () => {
  for (const durationSeconds of [15, 30, 90]) {
    const f = fixture(); f.configure({ durationSeconds }); f.command('start'); const startsAt = f.current.round!.startsAt;
    const artistAt = startsAt + durationSeconds * 1000 * 20 / 30, wordsAt = startsAt + durationSeconds * 1000 * 25 / 30;
    f.setTime(artistAt - 1); assert.deepEqual(f.read().game.round!.hints, {});
    f.setTime(artistAt); assert.deepEqual(f.read().game.round!.hints, { artistInitial: 'S' });
    f.setTime(wordsAt); assert.deepEqual(f.read().game.round!.hints, { artistInitial: 'S', titleWordCount: 3 });
    assert.throws(() => f.command('guess', { text: 'Wrong', now: wordsAt + 100000 }), /field/);
  }
});

test('stale CAS, duplicate/conflicting receipts, normalized duplicate guesses and reconnect never award twice', () => {
  const f = fixture(); f.join(); f.configure({ roundCount: 2 }); f.command('start'); f.setTime(f.current.round!.startsAt);
  f.command('guess', { text: 'Wrong---Title' }, guest); const wrongRevision = f.current.revision;
  for (let n = 0; n < 100; n++) assert.throws(() => f.command('guess', { text: 'WRONG TITLE!!' }, guest), /already received/);
  assert.equal(f.read().game.revision, wrongRevision);
  const request = { action: 'guess', text: 'Fictional Signal 1', sessionId: f.current.sessionId,
    revision: f.current.revision, roundId: f.current.round!.roundId, eventId: f.id() };
  const first = f.model.apply(guest, request);
  assert.throws(() => f.model.apply(guest, { ...request, eventId: f.id() }), { status: 409 });
  assert.throws(() => f.model.apply(guest, { ...request, revision: first.game.revision }), /already received/);
  assert.throws(() => f.model.apply(host, { ...request, action: 'reveal', text: undefined, revision: first.game.revision }), /field/);
  const conflicting = { action: 'reveal', sessionId: request.sessionId, roundId: request.roundId,
    revision: request.revision, eventId: request.eventId };
  assert.throws(() => f.model.apply(host, { ...conflicting, action: 'reveal', revision: first.game.revision }), /already received/);
  f.read(); f.join(guest); assert.equal(f.read(guest).self.result!.awarded, 1000);
  f.command('reveal'); const oldRound = f.current.round!.roundId;
  f.command('next');
  assert.throws(() => f.command('guess', { roundId: oldRound, text: 'Fictional Signal 2' }, guest), { status: 409 });
  assert.throws(() => f.command('end', { sessionId: f.id() }), { status: 409 });
  assert.equal(f.read(guest).self.result, null);
});

test('concurrent participants refresh CAS independently and each receives exactly one award', () => {
  const f = fixture(); f.join(); f.configure(); f.command('start'); f.setTime(f.current.round!.startsAt);
  const shared = { action: 'guess', text: 'Fictional Signal 1', sessionId: f.current.sessionId,
    revision: f.current.revision, roundId: f.current.round!.roundId };
  const first = f.model.apply(guest, { ...shared, eventId: f.id() });
  assert.equal(first.self.result!.awarded, 1000);
  assert.throws(() => f.model.apply(host, { ...shared, eventId: f.id() }), { status: 409 });
  f.read();
  assert.equal(f.command('guess', { text: 'Fictional Signal 1' }).self.result!.awarded, 1000);
  assert.deepEqual(f.current.scoreboard.map(player => player.total), [1000, 1000]);
  assert.equal(f.current.answeredCount, 2); assert.equal(f.current.round!.answer, undefined);
});

test('catalog selection is atomic, complete and without repeats, and next/reset honor lobby lifecycle', () => {
  const insufficient = fixture(new OperatorGuessCatalog(records(1), () => 0));
  const revision = insufficient.current.revision;
  assert.throws(() => insufficient.command('start'), { status: 503 });
  assert.equal(insufficient.read().game.revision, revision);
  const f = fixture(); f.configure({ roundCount: 2 }); f.command('start');
  assert.throws(() => f.command('next'), /Reveal/);
  assert.throws(() => f.command('reset'), /End this game/);
  assert.equal(f.command('reveal').game.round!.answer!.title, 'Fictional Signal 1');
  f.command('next'); assert.equal(f.current.roundNumber, 2);
  assert.equal(f.command('reveal').game.round!.answer!.title, 'Fictional Signal 2');
  f.command('next'); assert.equal(f.current.phase, 'results');
  assert.throws(() => f.command('start'), /already started/);
  const gameId = f.current.gameId, sessionId = f.current.sessionId, publicId = f.read().self.participantId;
  f.command('reset'); assert.equal(f.current.phase, 'lobby'); assert.equal(f.current.round, null);
  assert.notEqual(f.current.gameId, gameId); assert.equal(f.current.sessionId, sessionId);
  assert.equal(f.current.settings.roundCount, 2); assert.equal(f.current.scoreboard[0].total, 0);
  assert.equal(f.read().self.participantId, publicId);
});

test('public serialization hides internal catalog/answer/grant data; media descriptor access is private and round scoped', () => {
  const f = fixture(); f.join(); f.configure(); f.command('start'); f.setTime(f.current.round!.startsAt);
  f.command('guess', { text: 'Private wrong guess' }, guest);
  const serialized = JSON.stringify(f.read().game);
  for (const secret of ['Fictional', 'Sample Artist', 'Invented Alias', 'synthetic-', 'synthetic_media', 'mediaKey',
    'Private wrong guess', host.actor, guest.actor, 'guestReceipts', 'aliases', 'correct', 'awarded']) assert.equal(serialized.includes(secret), false, secret);
  const descriptor = f.model.media(guest, { sessionId: f.current.sessionId, roundId: f.current.round!.roundId });
  assert.equal(descriptor.key, 'synthetic_media_0001'); assert.equal('url' in descriptor, false);
  assert.throws(() => f.model.media({ ...guest, actor: 'not-joined' }, { sessionId: f.current.sessionId, roundId: f.current.round!.roundId }), { status: 403 });
  assert.throws(() => f.model.media(guest, { sessionId: f.current.sessionId, roundId: f.id() }), { status: 409 });
  const other = { ...host, scope: 'guild' as const, scopeId: '123456789012345' };
  const otherGame = f.model.apply(other, { action: 'join', eventId: f.id() }).game;
  assert.equal(otherGame.round, null); assert.equal(otherGame.scoreboard.length, 1);
  assert.throws(() => f.model.apply(other, { action: 'end', sessionId: f.current.sessionId, revision: otherGame.revision, roundId: null, eventId: f.id() }), { status: 409 });
  f.command('end'); assert.equal(f.current.round!.answer!.artist, 'Sample Artist 1');
  assert.throws(() => f.model.media(guest, { sessionId: f.current.sessionId, roundId: f.current.round!.roundId }), { status: 409 });
});

test('guess and ordinary host saturation cannot exhaust reserved reveal/end/reset controls', () => {
  const f = fixture(); f.join(); f.configure(); f.command('start'); f.setTime(f.current.round!.startsAt);
  for (let n = 0; n < 20; n++) f.command('guess', { text: `Wrong ${n}` }, guest);
  assert.throws(() => f.command('guess', { text: 'More guesses' }, guest), { status: 429 });
  f.command('reveal'); f.command('end'); f.command('reset');
  // Configure and start spent two ordinary host actions. Another 58 valid
  // lobby edits saturate that lane while moderation keeps its own capacity.
  for (let n = 0; n < 58; n++) f.configure();
  assert.throws(() => f.configure(), { status: 429 });
  assert.equal(f.command('end').game.phase, 'results');
});

test('global and scoped participant saturation leave host moderation available', () => {
  const f = fixture();
  for (let scope = 0; scope < 5; scope++) {
    const access = { ...host, scopeId: `GLOBAL0${scope}` };
    let state = f.model.apply(access, { action: 'join', eventId: f.id() }).game;
    const players = Array.from({ length: 12 }, (_, n) => ({ ...access, host: false, actor: `guest-${n}` }));
    for (const player of players) state = f.model.apply(player, { action: 'join', eventId: f.id() }).game;
    const act = (action: string, fields: Record<string, unknown> = {}, actor = access) => {
      const result = f.model.apply(actor, { action, sessionId: state.sessionId, revision: state.revision,
        roundId: state.round?.roundId ?? null, eventId: f.id(), ...fields });
      state = result.game;
    };
    act('start'); f.setTime(state.round!.startsAt);
    for (const player of players) for (let n = 0; n < 20; n++) act('guess', { text: `Wrong ${n}` }, player);
    assert.throws(() => act('guess', { text: 'One more wrong answer' }), { status: 429 });
    act('end'); assert.equal(state.phase, 'results');
  }
  f.command('start'); f.setTime(f.current.round!.startsAt);
  assert.throws(() => f.command('guess', { text: 'Anything' }), { status: 429 });
  assert.equal(f.command('end').game.phase, 'results');
});

test('participant/scope limits, inactive expiry and restart retire anonymous sessions safely', () => {
  const f = fixture();
  for (let n = 0; n < 63; n++) f.join({ ...guest, actor: `actor-${n}` });
  assert.equal(f.current.scoreboard.length, 64);
  assert.throws(() => f.join(guest), { status: 429 });
  for (let n = 1; n < 128; n++) f.model.apply({ ...host, scopeId: `R${String(n).padStart(7, '0')}` }, { action: 'join', eventId: f.id() });
  assert.throws(() => f.model.apply({ ...host, scopeId: 'OVERFLOW' }, { action: 'join', eventId: f.id() }), { status: 429 });
  const stale = f.current;
  f.setTime(f.now() + 30 * 60_000);
  assert.throws(() => f.read(), { status: 403 });
  assert.throws(() => f.command('end'), { status: 403 });
  const fresh = f.join(host).game; assert.notEqual(fresh.sessionId, stale.sessionId);
  assert.throws(() => f.command('end', { sessionId: stale.sessionId }), { status: 409 });
  const restarted = new GuessGame({ id: f.id, now: f.now });
  assert.throws(() => restarted.apply(host, { action: 'read' }), { status: 403 });
  assert.notEqual(restarted.apply(host, { action: 'join', eventId: f.id() }).game.sessionId, fresh.sessionId);
});

test('game source has no playback, provider, store or production media dependencies', () => {
  const source = readFileSync(new URL('../src/guess-game.ts', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]), ['node:crypto', './types.ts', './guess-catalog.ts']);
  const catalog = readFileSync(new URL('../src/guess-catalog.ts', import.meta.url), 'utf8');
  assert.equal(/fetch\s*\(|https?:\/\//.test(catalog), false);
});
