import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Social } from '../src/social.ts';
import { Store } from '../src/store.ts';
import { Rooms } from '../src/rooms.ts';
const initialRevision = 100000;
const playback = { playbackKey: 'concert:one', videoId: 'M7lc1UVf-VE', position: 42.8 };
function fixture() {
  const store = new Store(':memory:'); let now = 100000;
  const social = new Social(store, 'test-only-key', () => now);
  const scope = { scope: 'room', scopeId: 'TESTROOM' };
  const joined = social.apply({ ...scope, action: 'join' }, playback, false);
  const action = (input: Record<string, unknown>, host = false, current = playback) => social.apply({ ...scope, token: joined.token, playbackKey: current.playbackKey, eventId: randomUUID(), ...input }, current, host);
  return { store, social, scope, joined, action, tick: (ms: number) => { now += ms; } };
}
test('social is scoped, signed, expiring and rejects cross-room/guild tokens', () => {
  const f = fixture(); try {
    for (const scope of [{ scope: 'room', scopeId: 'OTHERROM' }, { scope: 'guild', scopeId: '123456789012345' }]) assert.throws(() => f.social.apply({ ...scope, action: 'read', token: f.joined.token }, playback, false), /Join social/);
    assert.throws(() => f.action({ action: 'read', token: f.joined.token + 'x' }), /Join social/);
    f.tick(1800001); assert.throws(() => f.action({ action: 'read' }), /Join social/);
  } finally { f.store.close(); }
});
test('highlight timestamp is authoritative, reconnect restores bounded data without private identity', () => {
  const f = fixture(); try {
    const result = f.action({ action: 'highlight', text: 'Great solo', position: 999999 });
    assert.equal(result.social.highlights[0].position, 42);
    const reconnected = new Social(f.store, 'test-only-key', () => 100001).apply({ ...f.scope, action: 'read', token: f.joined.token }, playback, false);
    assert.deepEqual(reconnected.social.highlights, result.social.highlights);
    assert.equal(JSON.stringify(reconnected).includes(f.joined.token!), false);
    assert.throws(() => f.action({ action: 'highlight', text: 'again', eventId: result.social.highlights[0].id }), /already received/);
    const next = f.action({ action: 'read' }, false, { ...playback, playbackKey: 'concert:two' });
    assert.equal(next.social.highlights.length, 0);
    assert.equal(next.social.revision, initialRevision + 2);
    assert.throws(() => f.action({ action: 'highlight', text: 'stale', playbackKey: 'concert:one' }, false, { ...playback, playbackKey: 'concert:two' }), /concert changed/);
  } finally { f.store.close(); }
});
test('manual bingo and disable controls require host and current social revision', () => {
  const f = fixture(); try {
    const cells = Array.from({ length: 9 }, (_, i) => 'Song ' + i);
    assert.throws(() => f.action({ action: 'bingo-start', cells, revision: initialRevision + 0 }), /Host access/);
    let result = f.action({ action: 'bingo-start', cells, revision: initialRevision + 0 }, true);
    assert.equal(result.social.bingo?.cells.length, 9);
    assert.throws(() => f.action({ action: 'bingo-mark', cell: 0, revision: initialRevision + 0 }, true), /Social changed/);
    result = f.action({ action: 'bingo-mark', cell: 0, revision: initialRevision + 1 }, true);
    assert.deepEqual(result.social.bingo?.marked, [0]);
    result = f.action({ action: 'configure', enabled: false, revision: initialRevision + 2 }, true);
    assert.equal(result.social.enabled, false);
    assert.throws(() => f.action({ action: 'reaction', emoji: '🔥' }), /disabled/);
    assert.equal(f.action({ action: 'configure', enabled: true, revision: initialRevision + 3 }, true).social.enabled, true);
  } finally { f.store.close(); }
});
test('malicious payloads, repeated events and reaction pressure are rejected; reactions expire', () => {
  const f = fixture(); try {
    for (const text of ['', 'x'.repeat(161), 'bad\u0000text']) assert.throws(() => f.action({ action: 'highlight', text }), /caption/);
    assert.throws(() => f.action({ action: 'reaction', emoji: '<script>' }), /Choose a reaction/);
    const eventId = randomUUID(); f.action({ action: 'reaction', emoji: '🔥', eventId });
    assert.throws(() => f.action({ action: 'reaction', emoji: '🔥', eventId }), /already received/);
    for (let i = 0; i < 5; i++) f.action({ action: 'reaction', emoji: '👏' });
    assert.throws(() => f.action({ action: 'reaction', emoji: '🔥' }), /busy/);
    assert.equal(f.store.prepare('SELECT count(*) AS n FROM concert_social').get()!.n, 1);
    f.tick(6001); assert.equal(f.action({ action: 'read' }).social.reactions.length, 0);
  } finally { f.store.close(); }
});
test('social changes cannot mutate a room timeline, queue or playback revision', () => {
  const f = fixture(), rooms = new Rooms(f.store, () => 100000);
  try {
    rooms.import({ code: 'TESTROOM', name: 'Concert', owner_hash: 'a'.repeat(64), state: { current: { id: playback.videoId, title: 'Concert', artist: 'Artist', duration: 600, live: false, image: '', embeddable: true }, queue: [], playing: false, position: 42 }, version: 7, updated_at: 100000, expires_at: 200000 });
    const before = rooms.snapshot('TESTROOM');
    f.action({ action: 'highlight', text: 'Great show' });
    f.action({ action: 'reaction', emoji: '❤️' });
    f.action({ action: 'bingo-start', revision: initialRevision + 1, cells: Array.from({ length: 9 }, (_, i) => 'Moment ' + i) }, true);
    assert.deepEqual(rooms.snapshot('TESTROOM'), before);
  } finally { rooms.dispose(); f.store.close(); }
});
test('reaction-only playback rollover never shows reactions from the previous concert', () => {
  const f = fixture(); try {
    f.action({ action: 'reaction', emoji: '🔥' });
    assert.equal(f.action({ action: 'read' }, false, { ...playback, playbackKey: 'concert:two' }).social.reactions.length, 0);
  } finally { f.store.close(); }
});
test('social broadcasts carry only their scope and durable changes retain a separate revision', () => {
  const f = fixture(); try {
    const received: { key: string; reaction: boolean; revision: number }[] = [];
    f.social.on('change', (key, state, reaction) => received.push({ key, reaction, revision: state.revision }));
    f.action({ action: 'stream' });
    f.action({ action: 'reaction', emoji: '🔥' });
    f.action({ action: 'highlight', text: 'Solo' });
    assert.deepEqual(received, [{ key: 'room:TESTROOM', reaction: true, revision: initialRevision + 0 }, { key: 'room:TESTROOM', reaction: false, revision: initialRevision + 1 }]);
  } finally { f.store.close(); }
});
test('disabled social still allows host removal and stopping bingo without re-enabling participation', () => {
  const f = fixture(); try {
    const highlight = f.action({ action: 'highlight', text: 'Caption to moderate' }).social.highlights[0];
    f.action({ action: 'bingo-start', cells: Array.from({ length: 9 }, (_, i) => 'Song ' + i), revision: initialRevision + 1 }, true);
    f.action({ action: 'configure', enabled: false, revision: initialRevision + 2 }, true);
    f.action({ action: 'remove-highlight', highlightId: highlight.id, revision: initialRevision + 3 }, true);
    f.action({ action: 'bingo-stop', revision: initialRevision + 4 }, true);
    const state = f.action({ action: 'read' }).social;
    assert.equal(state.enabled, false); assert.equal(state.highlights.length, 0); assert.equal(state.bingo?.active, false);
    assert.throws(() => f.action({ action: 'bingo-start', cells: Array(9).fill('duplicate'), revision: initialRevision + 5 }, true), /disabled/);
  } finally { f.store.close(); }
});
test('removed highlights cannot replay after restart, including with a renewed scoped session', () => {
  const f = fixture(); try {
    const eventId = randomUUID();
    f.action({ action: 'highlight', text: 'Removed caption', eventId });
    f.action({ action: 'remove-highlight', highlightId: eventId, revision: initialRevision + 1 }, true);
    const restarted = new Social(f.store, 'test-only-key', () => 100001);
    const joined = restarted.apply({ ...f.scope, action: 'join' }, playback, false);
    assert.equal(joined.social.highlights.length, 0);
    assert.throws(() => restarted.apply({ ...f.scope, action: 'highlight', token: joined.token, eventId, text: 'Replayed caption', playbackKey: playback.playbackKey }, playback, false), /already received/);
    assert.equal('receipts' in joined.social, false);
    assert.equal(JSON.stringify(joined.social).includes(eventId), false);
    assert.equal(f.store.prepare('SELECT count(*) AS n FROM concert_social_receipts').get()!.n, 2);
  } finally { f.store.close(); }
});
test('guest receipt exhaustion preserves host disable and removal capacity', () => {
  const f = fixture(); try {
    const eventId = randomUUID();
    f.action({ action: 'highlight', text: 'Moderate this', eventId });
    const insert = f.store.prepare('INSERT INTO concert_social_receipts(scope,event_id,expires,kind) VALUES(?,?,?,?)');
    for (let i = 1; i < 128; i++) insert.run('room:TESTROOM', randomUUID(), 86500000, 'guest');
    assert.throws(() => f.action({ action: 'highlight', text: 'One too many' }), /Daily social action limit/);
    f.action({ action: 'configure', enabled: false, revision: initialRevision + 1 }, true);
    const result = f.action({ action: 'remove-highlight', highlightId: eventId, revision: initialRevision + 2 }, true);
    assert.equal(result.social.enabled, false);
    assert.equal(result.social.highlights.length, 0);
    assert.equal(f.store.prepare("SELECT count(*) AS n FROM concert_social_receipts WHERE kind='host'").get()!.n, 2);
    f.tick(86400001);
    f.social.apply({ ...f.scope, action: 'join' }, playback, false);
    assert.equal(f.store.prepare('SELECT count(*) AS n FROM concert_social_receipts').get()!.n, 0);
    assert.equal(f.store.prepare('SELECT count(*) AS n FROM concert_social').get()!.n, 1);
  } finally { f.store.close(); }
});
test('retention expiry with unchanged playback key produces a newer persisted revision and valid host CAS', () => {
  const f = fixture(); try {
    const old = f.action({ action: 'highlight', text: 'Before expiry' }).social;
    f.tick(86400001);
    const joined = f.social.apply({ ...f.scope, action: 'join' }, playback, true);
    assert.equal(joined.social.playbackKey, old.playbackKey);
    assert.ok(joined.social.revision > old.revision);
    const revision = joined.social.revision;
    f.tick(200);
    const read = f.social.apply({ ...f.scope, action: 'read', token: joined.token }, playback, true);
    assert.equal(read.social.revision, revision);
    const result = f.social.apply({ ...f.scope, action: 'configure', token: joined.token, playbackKey: playback.playbackKey, eventId: randomUUID(), revision, enabled: false }, playback, true);
    assert.equal(result.social.revision, revision + 1);
    assert.equal(result.social.enabled, false);
  } finally { f.store.close(); }
});
