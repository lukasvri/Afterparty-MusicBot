import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { checkConfiguredGuessSource, type GuessCheckFactory } from '../src/guess-check.ts';
import { prepareConfiguredGuessSource } from '../src/guess-source.ts';
import { UnavailableGuessCatalog, type GuessCategorySummary } from '../src/guess-catalog.ts';
import { deferred } from './deferred.ts';

const env = { GUESS_DEEZER_PREVIEWS: '1', GUESS_DEEZER_INVENTORY_PATH: '/private/synthetic-inventory.json' };
const signal = () => new AbortController().signal;
const stats = () => [{ id: '2010s', name: '2010s', available: true, count: 1, durations: [{ seconds: 30, count: 1 }] }];
const failed = { provider: 'deezer', status: 'unavailable', categories: [], error: 'The configured game preview source is unavailable.' };
function fixture(categories: () => unknown = stats) {
  let disposed = 0;
  const catalog = new UnavailableGuessCatalog();
  catalog.categories = () => categories() as GuessCategorySummary[];
  const source = { catalog, media: { async read() { throw Error('must not read a private answer or clip'); } }, dispose() { disposed++; } };
  return { source, disposed: () => disposed };
}
async function privateFile(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'afterparty-guess-check-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'inventory.local.json');
  await writeFile(path, JSON.stringify([{ trackId: '123', categoryIds: ['2010s'], permission: {
    approved: true, reference: 'https://permission.example.test/private-evidence', expiresAt: Date.now() + 600000,
  } }]), { mode: 0o600 });
  return { ...env, GUESS_DEEZER_INVENTORY_PATH: path };
}

test('default-off check never invokes a factory, reads a file or asks for provider credentials', async () => {
  const prepare: GuessCheckFactory = () => { assert.fail('disabled check must not prepare a source'); };
  for (const flag of [undefined, '0', 'true']) {
    assert.deepEqual(await checkConfiguredGuessSource({ ...env, GUESS_DEEZER_PREVIEWS: flag, DEEZER_METADATA: '1' }, {
      signal: signal(), fetcher: async () => { assert.fail('must not fetch'); }, decode: async () => { assert.fail('must not decode'); },
    }, prepare), { provider: 'disabled', status: 'disabled', categories: [] });
  }
});

test('synthetic mode reports local capacity without selecting songs or decoding media', async () => {
  assert.deepEqual(await checkConfiguredGuessSource({ GUESS_SYNTHETIC_TEST: '1' }, {
    signal: signal(), fetcher: async () => { assert.fail('must not fetch'); }, decode: async () => { assert.fail('must not decode'); },
  }), { provider: 'synthetic', status: 'ready', categories: [{ id: 'synthetic-test', count: 5, durations: [{ seconds: 30, count: 5 }] }] });
});

test('YouTube preflight forwards only its private configuration and reports bounded capacity', async () => {
  const f = fixture(), extract = async () => { throw Error('the injected factory must not extract'); };
  const result = await checkConfiguredGuessSource({ GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_INVENTORY_PATH: '/private/youtube.json',
    DISCORD_TOKEN: 'private-unused-token' }, { signal: signal(), youtube: { extract } }, (config, options) => {
    assert.equal(config.GUESS_YOUTUBE_CLIPS, '1'); assert.equal(config.GUESS_YOUTUBE_INVENTORY_PATH, '/private/youtube.json');
    assert(!('DISCORD_TOKEN' in config)); assert.equal(options.youtube?.extract, extract); return f.source;
  });
  assert.deepEqual(result, { provider: 'youtube', status: 'ready', categories: [{ id: '2010s', count: 1, durations: [{ seconds: 30, count: 1 }] }] });
  assert.equal(f.disposed(), 1); assert(!JSON.stringify(result).includes('/private/'));
});

test('private-file preflight decodes generated MP3 with real FFmpeg, reports measured capacity and disposes copied audio', async t => {
  const config = await privateFile(t), calls: string[] = [];
  const generated = spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=16', '-threads', '1', '-ac', '2', '-ar', '44100',
    '-metadata', 'title=Private Fictional Answer', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1'], { maxBuffer: 2 * 1024 * 1024 });
  assert.equal(generated.status, 0, String(generated.stderr));
  let prepared: Awaited<ReturnType<typeof prepareConfiguredGuessSource>> = undefined;
  const result = await checkConfiguredGuessSource(config, {
    signal: signal(), fetcher: async input => {
      calls.push(String(input));
      if (String(input) === 'https://api.deezer.com/track/123') return Response.json({ id: '123', type: 'track', readable: true,
        title: 'Private Fictional Answer', artist: { name: 'Private Fictional Performer' }, duration: 180,
        preview: 'https://cdns-preview-a.dzcdn.net/stream/c-' + 'a'.repeat(32) + '-1.mp3' });
      assert.match(String(input), /^https:\/\/cdns-preview-a\.dzcdn\.net\/stream\//);
      return new Response(generated.stdout, { headers: { 'content-type': 'audio/mpeg' } });
    },
  }, async (config, options) => prepared = await prepareConfiguredGuessSource(config, options));
  assert.deepEqual(result, { provider: 'deezer', status: 'ready', categories: [{ id: '2010s', count: 1, durations: [{ seconds: 16, count: 1 }] },
    { id: 'edm-classics', count: 0, durations: [] }, { id: 'edm-festival-hits', count: 0, durations: [] }] });
  assert.equal(calls.length, 2);
  const source = prepared as Awaited<ReturnType<typeof prepareConfiguredGuessSource>>;
  assert(source); assert(source.catalog.categories().every(category => !category.available));
  assert.throws(() => source.catalog.select('2010s', { exclude: [], durationSeconds: 15 }), { status: 503 });
  await assert.rejects(source.media.read('unavailable-key', signal()), { status: 503 });
  const output = JSON.stringify(result);
  for (const secret of [config.GUESS_DEEZER_INVENTORY_PATH, 'Fictional', '123', 'https:', 'private-evidence', 'dzcdn']) assert(!output.includes(secret));
});

test('known capacity is deeply copied and arbitrary factory/category/bin fields never reach output', async () => {
  const raw = [{ ...stats()[0], name: 'private-answer', reference: 'https://secret.example', durations: [{ seconds: 30, count: 1, answer: 'private-answer' }] }];
  const f = fixture(() => raw), result = await checkConfiguredGuessSource(env, { signal: signal() }, () => f.source);
  assert.equal(f.disposed(), 1);
  assert.deepEqual(result, { provider: 'deezer', status: 'ready', categories: [{ id: '2010s', count: 1, durations: [{ seconds: 30, count: 1 }] }] });
  raw[0].durations[0].count = 8;
  assert.equal(result.categories[0].durations[0].count, 1);
  assert(!JSON.stringify(result).includes('private'));
});

test('malformed, oversized, expired or unknown public summaries fail closed and still dispose their source', async () => {
  const invalid = [undefined, {}, [], Array.from({ length: 3 }, () => stats()[0]),
    [{ ...stats()[0], id: 'private-answer' }], [stats()[0], stats()[0]], [{ ...stats()[0], count: 9 }],
    [{ ...stats()[0], count: NaN }], [{ ...stats()[0], count: 0, available: false, durations: [] }],
    [{ ...stats()[0], available: false }], [{ ...stats()[0], durations: undefined }],
    [{ ...stats()[0], durations: [{ seconds: 31, count: 1 }] }], [{ ...stats()[0], durations: [{ seconds: 14, count: 1 }] }],
    [{ ...stats()[0], durations: [{ seconds: 30, count: -1 }] }], [{ ...stats()[0], durations: [{ seconds: 30, count: 2 }] }],
    [{ ...stats()[0], count: 2, durations: [{ seconds: 30, count: 1 }, { seconds: 30, count: 1 }] }],
  ];
  for (const value of invalid) {
    const f = fixture(() => value);
    assert.deepEqual(await checkConfiguredGuessSource(env, { signal: signal() }, () => f.source), failed);
    assert.equal(f.disposed(), 1);
  }
});

test('sync/async factory errors, missing sources and cleanup errors return only a generic failure', async () => {
  const secret = '/private/file https://secret.example/123 Private Answer';
  for (const prepare of [() => { throw Error(secret); }, async () => { throw Error(secret); }, () => undefined])
    assert.deepEqual(await checkConfiguredGuessSource(env, { signal: signal() }, prepare), failed);
  const f = fixture(() => { throw Error(secret); });
  assert.deepEqual(await checkConfiguredGuessSource(env, { signal: signal() }, () => f.source), failed);
  assert.equal(f.disposed(), 1);
  const badCleanup = fixture(); badCleanup.source.dispose = () => { throw Error(secret); };
  assert.deepEqual(await checkConfiguredGuessSource(env, { signal: signal() }, () => badCleanup.source), failed);
  assert.deepEqual(await checkConfiguredGuessSource(env, { signal: signal() }, () => 123 as never), failed);
});

test('an already aborted enabled check never invokes the factory', async () => {
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await checkConfiguredGuessSource(env, { signal: controller.signal }, () => { assert.fail('must not prepare'); }), failed);
});

test('cancellation promptly returns and disposes a late source from a factory that ignores abort', async () => {
  const controller = new AbortController(), entered = deferred<void>(), pending = deferred<ReturnType<typeof fixture>['source']>(), f = fixture();
  const checking = checkConfiguredGuessSource(env, { signal: controller.signal }, () => { entered.resolve(); return pending.promise; });
  await entered.promise; controller.abort();
  assert.deepEqual(await checking, failed); assert.equal(f.disposed(), 0);
  pending.resolve(f.source); await nextTurn();
  assert.equal(f.disposed(), 1);
});

test('cancellation at factory completion or summary extraction cannot report ready or leak an owned source', async () => {
  for (const stage of ['completion', 'summary']) {
    const controller = new AbortController(), f = fixture(() => { if (stage === 'summary') controller.abort(); return stats(); });
    const result = await checkConfiguredGuessSource(env, { signal: controller.signal }, () => {
      if (stage === 'completion') queueMicrotask(() => controller.abort());
      return f.source;
    });
    assert.deepEqual(result, failed); assert.equal(f.disposed(), 1);
  }
});

test('expired permission in the real private-file factory never reports ready or makes a provider request', async t => {
  const config = await privateFile(t);
  await writeFile(config.GUESS_DEEZER_INVENTORY_PATH, JSON.stringify([{ trackId: '123', categoryIds: ['2010s'], permission: {
    approved: true, reference: 'https://permission.example.test/private-evidence', expiresAt: Date.now() - 1,
  } }]));
  assert.deepEqual(await checkConfiguredGuessSource(config, { signal: signal(), fetcher: async () => { assert.fail('expired permission must not fetch'); } }), failed);
});

test('CLI emits one safe JSON object without bot credentials and returns the expected status codes', () => {
  const script = fileURLToPath(new URL('../src/guess-check.ts', import.meta.url));
  for (const mode of ['disabled', 'synthetic', 'unavailable', 'youtube-unavailable']) {
    const child = spawnSync(process.execPath, [script], { timeout: 10000, encoding: 'utf8', env: { ...process.env,
      GUESS_DEEZER_PREVIEWS: mode === 'unavailable' ? '1' : '0', GUESS_SYNTHETIC_TEST: mode === 'synthetic' ? '1' : '0',
      GUESS_YOUTUBE_CLIPS: mode === 'youtube-unavailable' ? '1' : '0', GUESS_YOUTUBE_INVENTORY_PATH: '/nonexistent/private-youtube.json',
      GUESS_DEEZER_INVENTORY_PATH: '/nonexistent/private-inventory.json', DISCORD_TOKEN: '', DISCORD_GUILD_ID: '', PUBLIC_SITE_ADMIN_KEY: '', PUBLIC_SITE_URL: '',
    } });
    const unavailable = mode.endsWith('unavailable');
    assert.equal(child.status, unavailable ? 1 : 0, child.stderr); assert.equal(child.stderr, '');
    const output = JSON.parse(child.stdout);
    assert.equal(output.status, unavailable ? 'unavailable' : mode === 'synthetic' ? 'ready' : mode);
    assert.equal(output.provider, mode === 'youtube-unavailable' ? 'youtube' : mode === 'unavailable' ? 'deezer' : mode);
    assert(!child.stdout.includes('private-inventory'));
    assert(!child.stdout.includes('private-youtube'));
    assert.equal(child.stdout.trim().split('\n').length, 1);
  }
});
