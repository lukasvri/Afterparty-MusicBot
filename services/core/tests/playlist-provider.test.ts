import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Providers } from '../src/providers.ts';
import { SpotifyCatalog, expandSpotifyLink } from '../src/spotify.ts';
import { Store } from '../src/store.ts';
import type { YouTubeResponses } from '../src/external-types.ts';
import type { Track } from '../src/types.ts';
import { deferred } from './deferred.ts';

const youtube = 'https://www.youtube.com/playlist?list=PLsynthetic_playlist_123';
const spotify = 'https://open.spotify.com/playlist/1234567890123456789012';
const videoId = (index: number) => 'clip' + String(index).padStart(7, '0');
const track = (id: string): Track => ({ id, title: 'Synthetic set ' + id, artist: 'Synthetic artist', image: '',
  duration: 180, live: false, embeddable: true, entryId: 'original-' + id, source: 'youtube' });
const song = (index: number) => ({ id: String(index), title: 'Song ' + index, artist: 'Synthetic artist', duration: 180 });
const apiSong = (index: number) => ({ id: String(index), name: 'Song ' + index, artists: [{ name: 'Synthetic artist' }], duration_ms: 180000 });
function setup(t: TestContext, key = 'synthetic-key') {
  const dir = mkdtempSync(join(tmpdir(), 'afterparty-playlist-import-')), store = new Store(join(dir, 'db.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, provider: new Providers(store, { YOUTUBE_API_KEY: key }) };
}

test('YouTube import paginates beyond the queue limit, filters private/deleted/duplicate entries and hydrates in source order', async t => {
  const { store, provider: p } = setup(t), ids = Array.from({ length: 120 }, (_, index) => videoId(index));
  store.set('queue', [track('existing001')]); const before = { settings: store.settings(), queue: store.get('queue', []) };
  const entries = [{ contentDetails: { videoId: ids[0] } }, { contentDetails: { videoId: ids[1] }, status: { privacyStatus: 'private' } },
    { contentDetails: { videoId: ids[2] }, snippet: { title: 'Deleted video' } }, { contentDetails: { videoId: ids[0] } },
    ...ids.slice(3).map(videoId => ({ contentDetails: { videoId } }))];
  const pages: string[] = [], batches: string[][] = [];
  p.youtube = async <K extends keyof YouTubeResponses>(path: K, params: Record<string, string>, signal?: AbortSignal) => {
    assert.equal(path, 'playlistItems'); assert.equal(params.maxResults, '50'); assert(signal);
    const offset = Number(params.pageToken ?? 0); pages.push(String(offset));
    return { items: entries.slice(offset, offset + 50), pageInfo: { totalResults: entries.length },
      ...(offset + 50 < entries.length ? { nextPageToken: String(offset + 50) } : {}) } as unknown as YouTubeResponses[K];
  };
  p.video = async (batch, skip) => { assert.equal(skip, true); batches.push(batch);
    return [...batch.filter(id => id !== ids[8]).reverse().map(id => ({ ...track(id), embeddable: id !== ids[9] })), track('unrelated01')]; };
  const result = await p.importPlaylist(youtube, new AbortController().signal);
  assert.deepEqual(result.videos.map(t => t.id), ids.filter((_, index) => ![1, 2, 8, 9].includes(index)));
  assert.equal(result.skipped, 5); assert.equal(result.total, 121); assert.equal(result.limited, false);
  assert.deepEqual(pages, ['0', '50', '100']); assert(batches.every(batch => batch.length <= 50));
  assert.equal(result.videos.length, 116); assert.deepEqual({ settings: store.settings(), queue: store.get('queue', []) }, before);
});

test('YouTube API imports stop at 500 entries and report remaining pages without draining an unbounded playlist', async t => {
  const { provider: p } = setup(t); let calls = 0, hydrated = 0;
  p.youtube = async <K extends keyof YouTubeResponses>(_path: K, params: Record<string, string>) => {
    const offset = Number(params.pageToken ?? 0); calls++;
    return { items: Array.from({ length: 50 }, (_, index) => ({ contentDetails: { videoId: videoId(offset + index) } })),
      pageInfo: { totalResults: 50000 }, nextPageToken: String(offset + 50) } as unknown as YouTubeResponses[K];
  };
  p.video = async ids => { hydrated += ids.length; return ids.map(track); };
  const result = await p.importPlaylist(youtube, new AbortController().signal);
  assert.equal(result.videos.length, 500); assert.equal(hydrated, 500); assert.equal(calls, 10);
  assert.equal(result.total, 50000); assert.equal(result.limited, true); assert.equal(result.skipped, 0);
});

test('extractor fallback is metadata-only, bounded at 501 and never trusts flat-playlist titles as hydrated videos', async t => {
  for (const key of ['', 'synthetic-failing-key']) {
    const { provider: p } = setup(t, key); let api = 0, extracts = 0;
    p.youtube = async () => { api++; throw Error('synthetic unavailable API'); };
    p.extract = async (args, signal) => {
      extracts++; assert(signal); assert.deepEqual(args.slice(0, -1), ['--flat-playlist', '--dump-single-json', '--skip-download',
        '--ignore-config', '--no-cache-dir', '--js-runtimes', 'node', '--playlist-end', '501', '--']);
      assert.equal(args.at(-1), youtube);
      return { playlist_count: 800, entries: Array.from({ length: 501 }, (_, index) => ({ id: videoId(index),
        title: index === 0 ? '[Private video]' : 'Untrusted flat title', ...(index === 1 ? { availability: 'private' } : {}) })) };
    };
    p.video = async ids => ids.map(track);
    const result = await p.importPlaylist(youtube, new AbortController().signal);
    assert.equal(extracts, 1); assert.equal(api, key ? 1 : 0); assert.equal(result.videos.length, 498);
    assert.equal(result.videos[0].title, 'Synthetic set ' + videoId(2)); assert.equal(result.skipped, 2);
    assert.equal(result.total, 800); assert.equal(result.limited, true);
  }
});

test('cancellation waits for a raw API operation to settle and never starts fallback or hydration', async t => {
  const { provider: p } = setup(t), gate = deferred<YouTubeResponses['playlistItems']>(), started = deferred<void>(), controller = new AbortController();
  let settled = false;
  p.youtube = async <K extends keyof YouTubeResponses>() => { started.resolve(); return await gate.promise as YouTubeResponses[K]; };
  p.extract = async () => { assert.fail('aborted API cannot start fallback'); };
  p.video = async () => { assert.fail('aborted API cannot start hydration'); };
  const pending = p.importPlaylist(youtube, controller.signal).finally(() => { settled = true; });
  await started.promise; controller.abort(); await Promise.resolve(); assert.equal(settled, false);
  gate.resolve({ items: [{ contentDetails: { videoId: videoId(0) } }] });
  await assert.rejects(pending, { name: 'AbortError' });
});

test('cancellation during shared hydration keeps its raw work accounted for and prevents the next batch', async t => {
  const { provider: p } = setup(t), gate = deferred<Track[]>(), started = deferred<void>(), controller = new AbortController();
  let calls = 0, settled = false;
  p.youtube = async <K extends keyof YouTubeResponses>(_path: K, params: Record<string, string>) => ({
    items: Array.from({ length: params.pageToken ? 10 : 50 }, (_, index) => ({ contentDetails: { videoId: videoId(Number(params.pageToken ?? 0) + index) } })),
    ...(params.pageToken ? {} : { nextPageToken: '50' }),
  }) as YouTubeResponses[K];
  p.video = async () => { calls++; started.resolve(); return gate.promise; };
  const pending = p.importPlaylist(youtube, controller.signal).finally(() => { settled = true; });
  await started.promise; controller.abort(); await Promise.resolve(); assert.equal(settled, false);
  gate.resolve([track(videoId(0))]); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 1);
});

test('Spotify API summary distinguishes exhausted pages from embed previews and retains unavailable counts', async t => {
  const { provider: p } = setup(t), requests: string[] = [];
  p.spotifyCatalog = new SpotifyCatalog('id', 'secret', async input => {
    const url = String(input); requests.push(url);
    if (url.includes('/api/token')) return Response.json({ access_token: 'synthetic', expires_in: 3600 });
    return Response.json(url.includes('offset=2') ? { items: [{ track: apiSong(2) }, { track: { ...apiSong(3), is_local: true } }], total: 4, next: null }
      : { items: [{ track: apiSong(0) }, { track: { ...apiSong(1), type: 'episode' } }], total: 4, next: 'https://api.spotify.com/v1/playlists/123/items?offset=2' });
  });
  p.matchSong = async item => { if (item.id === '2') throw Error('synthetic no reliable match'); return track(videoId(Number(item.id))); };
  const result = await p.importPlaylist(spotify, new AbortController().signal);
  assert.deepEqual(result.videos.map(t => t.id), [videoId(0)]); assert.equal(result.total, 4);
  assert.equal(result.skipped, 3); assert.equal(result.limited, false); assert.equal(requests.length, 3);
  const loaded = await p.spotifyCatalog.load('playlist', '1234567890123456789012', 500);
  assert.deepEqual(loaded.map(s => s.id), ['0', '2'], 'existing bot callers still receive CatalogSong[]');
});

test('a Spotify embed response is explicitly limited and never claims a complete total', async t => {
  const { provider: p } = setup(t);
  p.spotifyCatalog = new SpotifyCatalog('', '', async input => {
    assert.equal(String(input), 'https://open.spotify.com/embed/playlist/1234567890123456789012');
    return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { state: { data: { entity: {
      trackList: [{ uri: 'spotify:track:one', title: 'Synthetic one', subtitle: 'Synthetic artist', duration: 180000 }],
    } } } } } }) + '</script>');
  });
  p.matchSong = async () => track(videoId(0));
  const result = await p.importPlaylist(spotify, new AbortController().signal);
  assert.equal(result.videos.length, 1); assert.equal(result.limited, true); assert.equal(result.total, undefined);
});

test('Spotify matching preserves order with at most three workers, skips errors/duplicate recordings and waits on cancellation', async t => {
  const { provider: p } = setup(t), gate = deferred<void>(), started = deferred<void>();
  p.spotifyCatalog.loadWithSummary = async () => ({ items: Array.from({ length: 8 }, (_, index) => song(index)), total: 8, skipped: 0, limited: false });
  let active = 0, maximum = 0;
  p.matchSong = async item => { active++; maximum = Math.max(maximum, active); if (active === 3) started.resolve(); await gate.promise; active--;
    if (item.id === '3') throw Error('synthetic missing match'); return track(videoId(item.id === '4' ? 2 : Number(item.id))); };
  const pending = p.importPlaylist(spotify, new AbortController().signal); await started.promise; gate.resolve();
  const result = await pending; assert.equal(maximum, 3); assert.deepEqual(result.videos.map(t => t.id), [0, 1, 2, 5, 6, 7].map(videoId)); assert.equal(result.skipped, 2);
  const held = deferred<Track>(), entered = deferred<void>(), controller = new AbortController(); let calls = 0, settled = false;
  p.matchSong = async () => { calls++; if (calls === 3) entered.resolve(); return held.promise; };
  const cancelled = p.importPlaylist(spotify, controller.signal).finally(() => { settled = true; });
  await entered.promise; controller.abort(); await Promise.resolve(); assert.equal(settled, false); held.resolve(track(videoId(0)));
  await assert.rejects(cancelled, { name: 'AbortError' }); assert.equal(calls, 3);
});

test('strict playlist parsing rejects unsafe and expanded non-playlist URLs before provider loading', async t => {
  const { provider: p } = setup(t); let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return new Response(null, { status: 302,
    headers: { location: 'https://open.spotify.com/track/1234567890123456789012' } }); });
  p.spotifyCatalog.loadWithSummary = async () => { assert.fail('non-playlist redirect cannot load provider'); };
  for (const url of ['http://www.youtube.com/playlist?list=PLsynthetic_playlist_123', 'https://evil.test/playlist?list=PLsynthetic_playlist_123',
    'https://spotify.link:443/test', 'https://user@spotify.link/test']) await assert.rejects(p.importPlaylist(url, new AbortController().signal));
  assert.equal(fetches, 0);
  await assert.rejects(p.importPlaylist('https://spotify.link/synthetic', new AbortController().signal)); assert.equal(fetches, 1);
});

test('ordinary Spotify load retains the configured 1000-song limit while import requests exactly 500', async t => {
  let pages = 0;
  const catalog = new SpotifyCatalog('id', 'secret', async input => {
    const url = String(input);
    if (url.includes('/api/token')) return Response.json({ access_token: 'synthetic', expires_in: 3600 });
    const offset = Number(new URL(url).searchParams.get('offset') ?? 0); pages++;
    return Response.json({ items: Array.from({ length: 50 }, (_, index) => ({ track: apiSong(offset + index) })), total: 1000,
      next: offset + 50 < 1000 ? 'https://api.spotify.com/v1/playlists/list/items?offset=' + (offset + 50) : null });
  });
  const loaded = await catalog.load('playlist', '1234567890123456789012', 1000);
  assert.equal(loaded.length, 1000); assert.equal(loaded.at(-1)?.id, '999'); assert.equal(pages, 20);
  const { provider: p } = setup(t);
  p.spotifyCatalog.loadWithSummary = async (_kind, _id, limit) => { assert.equal(limit, 500);
    return { items: [song(0)], total: 1000, skipped: 0, limited: true }; };
  p.matchSong = async () => track(videoId(0));
  assert.equal((await p.importPlaylist(spotify, new AbortController().signal)).limited, true);
});

test('known source totals prevent partial API pages from being reported as complete', async t => {
  const { provider: p } = setup(t);
  p.youtube = async <K extends keyof YouTubeResponses>() => ({ items: [{ contentDetails: { videoId: videoId(0) } }],
    pageInfo: { totalResults: 20 } }) as unknown as YouTubeResponses[K];
  p.video = async ids => ids.map(track);
  assert.equal((await p.importPlaylist(youtube, new AbortController().signal)).limited, true);
  const catalog = new SpotifyCatalog('id', 'secret', async input => String(input).includes('/api/token')
    ? Response.json({ access_token: 'synthetic', expires_in: 3600 })
    : Response.json({ items: [{ track: apiSong(0) }], next: null, total: 20 }));
  const result = await catalog.loadWithSummary('playlist', '1234567890123456789012', 500);
  assert.equal(result.total, 20); assert.equal(result.limited, true);
});

test('Spotify sharing rejects ports and spoofed authorities on every redirect before fetching them', async () => {
  for (const location of ['https://spotify.link:443/second', '//spotify.link:443/second', 'https://spotify.link:444/second',
    'https://open.spotify.com:443/playlist/1234567890123456789012', 'https://user@spotify.link/second', 'https://spotify.link.evil.test/second']) {
    const requests: string[] = [];
    await assert.rejects(expandSpotifyLink('https://spotify.link/first', async input => {
      requests.push(String(input)); return new Response(null, { status: 302, headers: { location } });
    }), /Invalid Spotify sharing link/);
    assert.deepEqual(requests, ['https://spotify.link/first']);
  }
  let requests = 0;
  await assert.rejects(expandSpotifyLink('https://spotify.link:443/first', async () => { requests++; throw Error(); }));
  assert.equal(requests, 0);
});

test('Spotify cancellation waits for an abort-ignoring raw API response and never begins embed fallback', async () => {
  const gate = deferred<Response>(), entered = deferred<void>(), controller = new AbortController(); let requests = 0, settled = false;
  const catalog = new SpotifyCatalog('id', 'secret', async input => {
    if (String(input).includes('/api/token')) return Response.json({ access_token: 'synthetic', expires_in: 3600 });
    requests++; entered.resolve(); return gate.promise;
  });
  const pending = catalog.loadWithSummary('playlist', '1234567890123456789012', 500, controller.signal).finally(() => { settled = true; });
  await entered.promise; controller.abort(); await Promise.resolve(); assert.equal(settled, false);
  gate.resolve(Response.json({ items: [{ track: apiSong(0) }], next: null }));
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(requests, 1);
});
