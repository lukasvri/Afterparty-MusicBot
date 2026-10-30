import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { Providers } from '../src/providers.ts';
import { Engine } from '../src/engine.ts';
import { Commands } from '../src/commands.ts';
import { createServers } from '../src/server.ts';
import type { Sink } from '../src/audio.ts';
import type { Track, PublicTrack } from '../src/types.ts';
import type { YouTubeResponses } from '../src/external-types.ts';
import { deferred } from './deferred.ts';

const id = (index: number) => 'result'+String(index).padStart(5, '0');
const track = (index: number): Track => ({ id: id(index), entryId: 'private-entry-'+index, title: 'Synthetic Song '+index, artist: 'Synthetic Artist', duration: 180,
  image: '', live: false, embeddable: true, source: 'youtube', requestedBy: 'private-member', genres: ['house'] });
const key = (query: string, count: number, musicOnly: boolean) => 'search:v7:'+JSON.stringify([query.trim().normalize('NFKC').toLowerCase(), count, musicOnly]);

test('authenticated catalog separates thirty public search results from twenty music-only radio candidates', async () => {
  const store = new Store(':memory:'), providers = new Providers(store, {});
  const sink: Sink = { onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false };
  const engine = new Engine(store, providers, sink), commands = new Commands(engine);
  const calls: { query: string; count: number; musicOnly: boolean }[] = [];
  let complete = true;
  providers.searchResult = async (query, count = 30, musicOnly = false) => { calls.push({ query, count, musicOnly }); return { tracks: Array.from({ length: complete ? count : 1 }, (_, i) => track(i)), complete }; };
  const servers = await createServers(engine, commands, { key: 'synthetic-key', origin: 'https://site.example', host: '127.0.0.1', publicPort: 0 });
  const base = 'http://127.0.0.1:'+(servers.publicServer.address() as { port: number }).port;
  const request = (path: string, authorized = true) => fetch(base+path, { headers: authorized ? { Authorization: 'Bearer synthetic-key' } : {} });
  const initial = JSON.stringify({ queue: engine.queue, current: engine.current, settings: engine.settings });
  try {
    assert.equal((await request('/v1/catalog?q=Example', false)).status, 403); assert.equal(calls.length, 0);
    const user = await request('/v1/catalog?q=%20Example%20'); assert.equal(user.status, 200);
    const userData = await user.json() as { videos: PublicTrack[]; complete: boolean }; assert.equal(userData.videos.length, 30); assert.equal(userData.complete, true);
    assert(!JSON.stringify(userData).includes('private-')); assert.deepEqual(calls.at(-1), { query: 'Example', count: 30, musicOnly: false });
    const radio = await request('/v1/catalog?q=Example&mode=radio'); assert.equal(radio.status, 200); assert.equal(((await radio.json()) as { videos: PublicTrack[] }).videos.length, 20);
    assert.deepEqual(calls.at(-1), { query: 'Example', count: 20, musicOnly: true });
    await request('/v1/catalog?q=Example&count=500'); assert.equal(calls.at(-1)?.count, 30, 'clients cannot increase the fixed admission limit');
    const before = calls.length;
    for (const query of ['?q=Example&mode=unknown', '?q=Example&mode=', '?q=Example&mode=radio&mode=unknown', '?q=%20%20']) assert.equal((await request('/v1/catalog'+query)).status, 400);
    assert.equal(calls.length, before); assert.equal(JSON.stringify({ queue: engine.queue, current: engine.current, settings: engine.settings }), initial);
    complete = false;
    const partial = await (await request('/v1/catalog?q=Partial')).json() as { videos: PublicTrack[]; complete: boolean };
    assert.equal(partial.complete, false); assert.equal(partial.videos.length, 1);
    assert(!JSON.stringify(partial).includes('private-'));
  } finally { await servers.close(); commands.close(); engine.close(); store.close(); }
});

test('provider search defaults to thirty and validates count before any provider call', async () => {
  const store = new Store(':memory:'), p = new Providers(store, {}); let count = '', calls = 0;
  p.youtube = async <K extends keyof YouTubeResponses>(_path: K, params: Record<string, string>) => { calls++; count = params.maxResults; return { items: Array.from({ length: 30 }, (_, i) => ({ id: { videoId: id(i) } })) } as YouTubeResponses[K]; };
  p.video = async ids => ids.map(value => track(Number(value.slice(6))));
  try {
    assert.equal((await p.search('Synthetic music')).length, 30); assert.equal(count, '30');
    const before = calls;
    for (const value of [0, -1, 51, Infinity, NaN, 1.5]) await assert.rejects(p.search('Synthetic music', value));
    for (const query of ['', '   ', 'x'.repeat(2001)]) await assert.rejects(p.search(query, 5));
    assert.equal(calls, before);
  } finally { store.close(); }
});

test('API and extractor discovery cap and deduplicate candidates before metadata hydration', async () => {
  for (const fallback of [false, true]) {
    const store = new Store(':memory:'), p = new Providers(store, {}); let hydrated: string[] = [];
    p.youtube = async <K extends keyof YouTubeResponses>() => { if (fallback) throw Error('synthetic API unavailable'); return { items: [{ id: { videoId: id(0) } }, { id: { videoId: id(0) } }, { id: { videoId: 'bad' } }, { id: { videoId: id(1) } }, { id: { videoId: id(2) } }] } as YouTubeResponses[K]; };
    p.extract = async args => { assert(args.includes('ytsearch2:Synthetic music')); return { entries: [{ id: id(0) }, { id: id(0) }, null, { id: 'bad' }, { id: id(1) }, { id: id(2) }] }; };
    p.video = async ids => { hydrated = ids; return ids.map(value => track(Number(value.slice(6)))); };
    try { assert.equal((await p.search('Synthetic music', 2)).length, 2); assert.deepEqual(hydrated, [id(0), id(1)]); } finally { store.close(); }
  }
});

test('search cache rejects malformed or future snapshots and cannot reuse smaller or radio-only pools', async () => {
  const store = new Store(':memory:'), p = new Providers(store, {}); let calls = 0;
  p.youtube = async <K extends keyof YouTubeResponses>() => { calls++; return { items: [{ id: { videoId: id(0) } }] } as YouTubeResponses[K]; };
  p.video = async () => [track(0)];
  try {
    for (const cached of [{ at: Date.now()+10000, tracks: [track(1)] }, { at: Date.now(), tracks: 'malformed' }, { at: Date.now(), tracks: [{ ...track(1), duration: NaN }] }]) {
      store.set(key('Malformed', 30, false), cached); const before = calls; assert.equal((await p.search('Malformed', 30))[0].id, id(0)); assert.equal(calls, before+1);
    }
    store.set(key('Separated', 8, false), { at: Date.now(), tracks: [track(1)] }); store.set(key('Separated', 20, true), { at: Date.now(), tracks: [track(1)] });
    const before = calls; assert.equal((await p.search('Separated', 30))[0].id, id(0)); assert.equal(calls, before+1);
    await p.search('Separated', 30); assert.equal(calls, before+1);
  } finally { store.close(); }
});

test('larger searches still coalesce in flight and give callers independent nested metadata', async () => {
  const store = new Store(':memory:'), p = new Providers(store, {}), gate = deferred<void>(); let calls = 0;
  p.youtube = async <K extends keyof YouTubeResponses>() => { calls++; await gate.promise; return { items: [{ id: { videoId: id(0) } }] } as YouTubeResponses[K]; };
  p.video = async () => [track(0)];
  try {
    const pending = Array.from({ length: 10 }, () => p.search('Same query', 30)); gate.resolve(); const results = await Promise.all(pending);
    assert.equal(calls, 1); assert.equal(new Set(results.map(result => result[0].entryId)).size, 10);
    results[0][0].genres!.push('mutated'); assert.deepEqual(results[1][0].genres, ['house']); assert.deepEqual((await p.search('Same query', 30))[0].genres, ['house']);
  } finally { gate.resolve(); store.close(); }
});

test('sixty-four distinct pending searches bound provider work while shared joins and later recovery remain available', async () => {
  const store = new Store(':memory:'), p = new Providers(store, {}), gate = deferred<void>(); let calls = 0;
  p.youtube = async <K extends keyof YouTubeResponses>() => { calls++; await gate.promise; return { items: [{ id: { videoId: id(0) } }] } as YouTubeResponses[K]; };
  p.video = async () => [track(0)];
  const pending = Array.from({ length: 64 }, (_, index) => p.search('Query '+index, 30));
  try {
    const joined = p.search('Query 0', 30); await Promise.resolve(); assert.equal(calls, 64);
    await assert.rejects(p.search('Another query', 30), /busy/); assert.equal(calls, 64);
    gate.resolve(); await Promise.all([...pending, joined]);
    assert.equal((await p.search('Another query', 30)).length, 1); assert.equal(calls, 65);
  } finally { gate.resolve(); await Promise.allSettled(pending); store.close(); }
});

test('fresh API and extractor metadata preserve explicit AI evidence while old cache namespaces are ignored', async () => {
  for (const fallback of [false, true]) {
    const store = new Store(':memory:'), p = new Providers(store, {}); let hydrated = 0;
    store.set('metadata:v5:'+id(0), { at: Date.now(), track: track(0) });
    store.set('search:v6:'+JSON.stringify(['evidence', 30, false]), { at: Date.now(), tracks: [track(0)] });
    p.youtube = async <K extends keyof YouTubeResponses>(path: K) => {
      if (path === 'search') return { items: [{ id: { videoId: id(0) } }] } as YouTubeResponses[K];
      hydrated++; if (fallback) throw Error('synthetic unavailable');
      return { items: [{ id: id(0), snippet: { title: 'Synthetic song', channelTitle: 'Artist', categoryId: '10' }, contentDetails: { duration: 'PT3M' }, status: { embeddable: true, containsSyntheticMedia: true } }] } as YouTubeResponses[K];
    };
    p.extract = async () => ({ id: id(0), title: 'Synthetic song', uploader: 'Artist', description: 'Created using Suno', duration: 180, playable_in_embed: true });
    try { const [result] = await p.search('Evidence', 30); assert.equal(result.aiGenerated, true); assert.equal(hydrated, 1); } finally { store.close(); }
  }
});

test('user discovery ranks hydrated title/artist relevance once while radio retains its provider pool', async () => {
  const store = new Store(':memory:'), p = new Providers(store, {});
  let calls = 0;
  const pool: Track[] = [
    { ...track(0), title: 'Janji - Heroes Tonight (Remix)', artist: 'Janji' },
    { ...track(1), title: 'Janji - Heroes Tonight (Official Audio)', artist: 'Janji - Topic' },
    { ...track(2), title: 'Unrelated video', artist: 'Other Artist' },
  ];
  p.youtube = async <K extends keyof YouTubeResponses>() => {
    calls++; return { items: pool.map(track => ({ id: { videoId: track.id } })) } as YouTubeResponses[K];
  };
  p.video = async () => pool;
  try {
    assert.deepEqual((await p.search('Janji Heroes Tonight')).map(track => track.id), [id(1), id(0), id(2)]);
    assert.deepEqual((await p.search('Janji Heroes Tonight')).map(track => track.id), [id(1), id(0), id(2)]);
    assert.equal(calls, 1, 'local ranking does not make extra discovery or metadata requests');
    assert.deepEqual((await p.search('Janji Heroes Tonight', 20, true)).map(track => track.id), pool.map(track => track.id));
    assert.equal(calls, 2, 'radio keeps its own fixed pool and cache identity');
  } finally { store.close(); }
});
