// Local bundled-pack acceptance. Generated tones replace provider metadata/audio;
// real source preparation, FFmpeg, Core HTTP and Chromium decoding remain in use.
// Website authority/proxy is an explicit fixture, not deployment or rights evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { Commands } from '../services/core/src/commands.ts';
import { Engine } from '../services/core/src/engine.ts';
import { Providers } from '../services/core/src/providers.ts';
import { Store } from '../services/core/src/store.ts';
import { createServers } from '../services/core/src/server.ts';
import { prepareConfiguredGuessSource } from '../services/core/src/guess-source.ts';
import { GuessSourceManager } from '../services/core/src/guess-source-manager.ts';
import { getGuessPack } from '../services/core/src/guess-packs.ts';
import { decodeGuessClip } from '../services/core/src/guess-decode.ts';
import { guessWaveSeconds } from '../services/core/src/guess-audio-format.ts';
import type { GuessResult } from '../services/core/src/guess-game.ts';
import type { Sink } from '../services/core/src/audio.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as typeof import('playwright');
const shots = process.env.SCREENSHOT_DIR ?? '/tmp/afterparty-quiz-prepare-shots';
const base = new URL(process.env.PREVIEW_URL ?? 'http://localhost:8792').origin;
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
type Result = GuessResult & { canManage: boolean; mediaAvailable: boolean; token?: string; sourceState?: string; canPrepare?: boolean };
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const deferred = () => Promise.withResolvers<void>();
const gate = () => ({ entered: deferred(), release: deferred(), finished: deferred() });
type Gate = ReturnType<typeof gate>;
async function bounded(value: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([value, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Controlled game request did not settle.')), 6000); })]); }
  finally { clearTimeout(timer); }
}
async function released(page: Page) {
  await page.waitForFunction(() => { const s = (window as unknown as { packAudio: { last?: HTMLAudioElement; urls: number; revoked: number } }).packAudio; return s.urls === s.revoked && (!s.last || (s.last.paused && !s.last.hasAttribute('src'))); });
}
test('alpha quiz prepares and retries its default pack, then plays eight rounds for two browsers', { timeout: 120000 }, async () => {
  const pack = getGuessPack('edm-festival-hits'), lifetime = new AbortController();
  assert.equal(pack.tracks.length, 8);
  const encoded = new Map<string, Buffer>(), titlesByInput = new Map<string, string>(), titlesByWave = new Map<string, string>();
  for (const [i, track] of pack.tracks.entries()) {
    const made = spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${220 + i * 110}:sample_rate=16000:duration=61`, '-c:a', 'libopus', '-f', 'webm', 'pipe:1'], { maxBuffer: 2_000_000, timeout: 10000 });
    assert.equal(made.status, 0, made.stderr?.toString()); encoded.set(track.videoId, made.stdout); titlesByInput.set(hash(made.stdout), track.title);
  }
  let extracts = 0, fetches = 0, decodes = 0, attempts = 0;
  const failedPreparation = gate(), successfulPreparation = gate();
  const source = new GuessSourceManager({ env: { NODE_ENV: 'test' }, signal: lifetime.signal, prepare: async (env, options) => {
    const attempt = ++attempts, controlled = attempt === 1 ? failedPreparation : successfulPreparation; controlled.entered.resolve(); await controlled.release.promise;
    if (attempt === 1) throw Error('Controlled initial source failure');
    return prepareConfiguredGuessSource(env, { ...options, youtube: {
    extract: async args => { extracts++; const id = new URL(args.at(-1)!).searchParams.get('v')!; assert(encoded.has(id)); return { id, is_live: false, duration: 61, ext: 'webm', vcodec: 'none', acodec: 'opus', url: `https://rr1---synthetic.googlevideo.com/videoplayback?mime=audio%2Fwebm&fixture=${id}` }; },
    fetcher: (async input => { fetches++; const bytes = encoded.get(new URL(String(input)).searchParams.get('fixture')!); assert(bytes); return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'audio/webm' } }); }) as typeof fetch,
    decode: async (input, options, signal) => { decodes++; const title = titlesByInput.get(hash(input)); assert(title); const wave = await decodeGuessClip(input, options, signal); titlesByWave.set(hash(wave), title); return wave; },
  } }); } });
  assert.equal(source.status, 'unavailable'); assert.equal(attempts, 0); assert.equal(extracts, 0);
  const store = new Store(':memory:'), sinkCalls: string[] = [];
  const sink: Sink = { onIdle: null, onError: null, play() { sinkCalls.push('play'); }, pause() { sinkCalls.push('pause'); }, resume() { sinkCalls.push('resume'); }, stop() { sinkCalls.push('stop'); }, duration: () => 0, advancing: () => false, buffering: () => false };
  const engine = new Engine(store, new Providers(store, { NODE_ENV: 'test' }), sink), commands = new Commands(engine);
  clearInterval(engine.timer); engine.ready = true;
  engine.current = { id: 'abcdefghijk', entryId: 'separate-music', title: 'Ordinary private music', artist: 'Separate artist', image: '', duration: 600, live: false, embeddable: true, concert: false };
  engine.queue = [{ ...engine.current, entryId: 'separate-queue' }];
  const music = () => structuredClone({ current: engine.current, queue: engine.queue, revision: engine.revision(), queueRevision: commands.concertQueue.revision(), paused: engine.paused, settings: store.settings() });
  const before = music(), key = 'bundled-pack-browser-only';
  const server = await createServers(engine, commands, { key, origin: base, host: '127.0.0.1', publicPort: 0, guessCatalog: source.catalog, guessMedia: source.media, prepareSource: () => source.reload(), sourceState: () => source.status });
  const core = `http://127.0.0.1:${(server.publicServer.address() as { port: number }).port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const failures: string[] = [], playbackWrites: string[] = [], external: string[] = [], gates: Gate[] = [failedPreparation, successfulPreparation];
  try {
    async function client(host: boolean, nickname: string) {
      const context = await browser.newContext({ viewport: { width: host ? 1440 : 390, height: 1000 }, serviceWorkers: 'block' });
      await context.addInitScript(() => {
        localStorage.setItem('gutta-language', 'en'); Object.defineProperty(navigator, 'onLine', { get: () => true });
        const s = { last: undefined as HTMLAudioElement | undefined, urls: 0, revoked: 0 }; (window as unknown as { packAudio: typeof s }).packAudio = s;
        const Native = Audio, create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { s.urls++; return create(blob); }; URL.revokeObjectURL = url => { s.revoked++; revoke(url); };
        window.Audio = function(src?: string) { return s.last = new Native(src); } as unknown as typeof Audio;
      });
      let malformed: 'state' | 'capability' | undefined;
      let latest: Result | undefined, token = '', heldRead: Gate | undefined, heldMutation: Gate | undefined;
      const actions: string[] = [], waves: { round: string; title: string; hash: string }[] = [];
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) { external.push(url.origin); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (!['/api/guess', '/api/guess/media'].includes(url.pathname)) { if (route.request().method() !== 'GET') playbackWrites.push(url.pathname); return route.fulfill({ json: {} }); }
        try {
          const input = route.request().postDataJSON(); actions.push(input.action);
          const fields = Object.fromEntries(['scope', 'scopeId', 'action', 'token', 'eventId', 'sessionId', 'revision', 'roundId', 'categoryId', 'settings', 'nickname', 'text'].filter(name => input[name] !== undefined).map(name => [name, input[name]]));
          const response = await fetch(core + '/v1/guess', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ ...fields, host, roomExpiresAt: Date.now() + 3_600_000 }), signal: AbortSignal.timeout(8000) });
          if (url.pathname.endsWith('/media') && response.ok) {
            const bytes = new Uint8Array(await response.arrayBuffer()), title = titlesByWave.get(hash(bytes)); assert(title); assert.equal(guessWaveSeconds(bytes), 30);
            waves.push({ round: input.roundId, title, hash: hash(bytes) });
            return route.fulfill({ body: Buffer.from(bytes), headers: { 'content-type': 'audio/wav', 'cache-control': 'private, no-store' } });
          }
          const value = await response.json() as Result;
          if (response.ok && input.action !== 'catalog') {
            latest = value; if (value.token) token = value.token;
            if (value.game.phase === 'round') {
              const payload = JSON.stringify(value.game); assert.equal(value.game.round?.answer, undefined);
              for (const track of pack.tracks) for (const secret of [track.title, track.artist, track.videoId, track.sourceUrl]) assert.equal(payload.includes(secret), false, `Round leaked ${secret}`);
            }
          }
          if (input.action === 'read' && malformed) {
            if (malformed === 'state') value.sourceState = 'untrusted'; else (value as unknown as Record<string, unknown>).canPrepare = 'yes';
            malformed = undefined;
          }
          const held = input.action === 'read' ? heldRead : !['join', 'catalog'].includes(input.action) ? heldMutation : undefined;
          if (held) { if (input.action === 'read') heldRead = undefined; else heldMutation = undefined; held.entered.resolve(); await held.release.promise; }
          try { await route.fulfill({ status: response.status, json: value }); } finally { held?.finished.resolve(); }
        } catch (error) { failures.push(String(error)); await route.abort().catch(() => {}); }
      });
      const page = await context.newPage(); page.on('pageerror', error => failures.push(error.message));
      await page.goto(base + '/games?room=TESTROOM');
      try { await page.getByText('Quiz songs are not loaded yet.', { exact: true }).waitFor({ timeout: 8000 }); }
      catch (error) { console.error({ failures, actions, body: await page.locator('body').innerText() }); throw error; }
      await page.getByLabel('Nickname', { exact: true }).fill(nickname); await page.getByRole('button', { name: 'Join lobby', exact: true }).click();
      await page.getByRole('complementary', { name: 'Scoreboard', exact: true }).waitFor();
      return { page, context, actions, waves, token: () => token, malformed: (field: 'state' | 'capability') => { malformed = field; }, latest: () => { assert(latest); return latest; }, holdRead: () => { const g = gate(); gates.push(g); heldRead = g; return g; }, holdMutation: () => { const g = gate(); gates.push(g); heldMutation = g; return g; } };
    }
    const host = await client(true, 'Red'), guest = await client(false, 'Blue'), page = host.page;
    await page.getByText('Blue', { exact: true }).waitFor();
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: `${shots}/quiz-load-desktop-en.png`, fullPage: true });
    assert.equal(attempts, 0, 'Opening, joining and polling never download quiz songs');
    assert.equal(await guest.page.getByRole('button', { name: 'Load quiz songs', exact: true }).count(), 0);
    assert(await page.getByRole('button', { name: 'Start game', exact: true }).isDisabled());
    const preparationReply = page.waitForResponse(r => r.url().endsWith('/api/guess') && r.request().postDataJSON()?.action === 'prepare');
    await page.getByRole('button', { name: 'Load quiz songs', exact: true }).click();
    const initialResponse = await preparationReply; assert.equal(initialResponse.status(), 200); assert.equal((await initialResponse.json() as Result).sourceState, 'loading');
    await bounded(failedPreparation.entered.promise);
    assert(await page.getByRole('button', { name: 'Loading quiz songs…', exact: true }).isDisabled());
    assert(await page.getByRole('button', { name: 'Start game', exact: true }).isDisabled()); assert.equal(attempts, 1); assert.equal(extracts, 0);
    const guestState = guest.latest();
    assert.equal(await guest.page.evaluate(async input => (await fetch('/api/guess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status,
      { action: 'prepare', scope: 'room', scopeId: 'TESTROOM', host: true, token: guest.token(), sessionId: guestState.game.sessionId, roundId: null, revision: guestState.game.revision, eventId: crypto.randomUUID() }), 403);
    assert.equal(attempts, 1, 'Guest cannot start more source work');
    failedPreparation.release.resolve();
    await page.getByRole('button', { name: 'Retry loading quiz songs', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Bokmål', exact: true }).click();
    await page.getByRole('button', { name: 'Prøv å laste inn quizlåtene igjen', exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${shots}/quiz-retry-mobile-nb.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'English', exact: true }).click();
    const retryReply = page.waitForResponse(r => r.url().endsWith('/api/guess') && r.request().postDataJSON()?.action === 'prepare');
    await page.getByRole('button', { name: 'Retry loading quiz songs', exact: true }).click(); assert.equal((await retryReply).status(), 200);
    await bounded(successfulPreparation.entered.promise); assert.equal(attempts, 2);
    assert(await page.getByRole('button', { name: 'Loading quiz songs…', exact: true }).isDisabled());
    assert.equal(await guest.page.getByRole('button', { name: 'Load quiz songs', exact: true }).count(), 0);
    successfulPreparation.release.resolve();
    for (const c of [host, guest]) await c.page.locator('.guess-source-badge').getByText('Quiz songs ready', { exact: true }).waitFor();
    assert.equal(source.catalog.categories().find(category => category.id === pack.id)?.count, 8);
    assert.equal(extracts, 8); assert.equal(fetches, 8); assert.equal(decodes, 8); assert.equal(titlesByWave.size, 8);
    assert.equal(host.actions.filter(action => action === 'prepare').length, 2);
    assert.equal(await page.getByRole('button', { name: 'Load quiz songs', exact: true }).count(), 0);
    for (const field of ['state', 'capability'] as const) {
      host.malformed(field);
      await page.getByText('Waiting for this game’s latest state.', { exact: false }).waitFor();
      assert(await page.getByRole('button', { name: 'Start game', exact: true }).isDisabled());
      await page.getByRole('button', { name: 'Reconnect game', exact: true }).click();
      await page.getByRole('button', { name: 'Reconnect game', exact: true }).waitFor({ state: 'hidden' });
      assert(await page.getByRole('button', { name: 'Start game', exact: true }).isEnabled());
    }
    await page.getByLabel('Category', { exact: true }).selectOption(pack.id); await page.getByLabel('Rounds', { exact: true }).fill('8');
    const saved = page.waitForResponse(r => r.url().endsWith('/api/guess') && r.request().postDataJSON()?.action === 'configure');
    await page.getByRole('button', { name: 'Save game settings', exact: true }).click(); assert.equal((await saved).status(), 200);
    // Hold an old lobby snapshot, then the replacement mutation response. Releasing
    // the canceled read must neither roll back state nor clear the mutation's busy flag.
    const oldRead = host.holdRead(); await bounded(oldRead.entered.promise); const starting = host.holdMutation();
    await page.getByRole('button', { name: 'Start game', exact: true }).click(); await bounded(starting.entered.promise);
    oldRead.release.resolve(); await bounded(oldRead.finished.promise); await page.waitForTimeout(100);
    assert(await page.getByRole('button', { name: 'Start game', exact: true }).isDisabled());
    assert.equal(await page.getByRole('button', { name: 'Reconnect game', exact: true }).count(), 0);
    starting.release.resolve(); await bounded(starting.finished.promise);
    assert.equal(host.actions.filter(a => a === 'start').length, 1);
    const seen = new Set<string>(); let redTotal = 0, blueTotal = 0;
    for (let n = 1; n <= 8; n++) {
      for (const c of [host, guest]) {
        await c.page.getByRole('heading', { name: 'What’s the song?', exact: true }).waitFor();
        await c.page.getByRole('button', { name: 'Listen to preview', exact: true }).click();
        await c.page.waitForFunction(() => { const a = (window as unknown as { packAudio: { last?: HTMLAudioElement } }).packAudio.last; return a && !a.paused && a.readyState >= 2 && a.currentTime > 0; });
        assert.equal(await c.page.evaluate(() => (window as unknown as { packAudio: { last: HTMLAudioElement } }).packAudio.last.duration), 30);
      }
      const clip = host.waves.at(-1)!; assert.equal(clip.hash, guest.waves.at(-1)!.hash); assert(!seen.has(clip.title)); seen.add(clip.title);
      assert.equal(host.latest().game.roundNumber, n); assert.equal(host.latest().game.settings.roundCount, 8);
      let held: Gate | undefined;
      if (n === 1) { held = host.holdRead(); await bounded(held.entered.promise); }
      for (const c of [host, guest]) {
        const answer = c.page.waitForResponse(r => r.url().endsWith('/api/guess') && r.request().postDataJSON()?.action === 'guess');
        await c.page.getByLabel('Song title', { exact: true }).fill(clip.title); await c.page.getByRole('button', { name: 'Send guess', exact: true }).click();
        const response = await answer; assert.equal(response.status(), 200); const value = await response.json() as Result; assert.equal(value.self.result?.correct, true); assert(value.self.result!.awarded > 0);
        if (c === host) redTotal += value.self.result!.awarded; else blueTotal += value.self.result!.awarded;
      }
      if (held) { held.release.resolve(); await bounded(held.finished.promise); await page.waitForTimeout(100); assert(await page.getByRole('button', { name: 'Send guess', exact: true }).isDisabled()); }
      await page.waitForFunction(total => [...document.querySelectorAll('.guess-board li')].some(row => row.querySelector('strong')?.textContent?.startsWith('Blue') && Number(row.querySelector('b')?.textContent) === total), blueTotal);
      const reveal = page.waitForResponse(r => r.url().endsWith('/api/guess') && r.request().postDataJSON()?.action === 'reveal'); await page.getByRole('button', { name: 'Reveal answer', exact: true }).click(); assert.equal((await reveal).status(), 200);
      for (const c of [host, guest]) { await c.page.getByRole('heading', { name: clip.title, exact: true }).waitFor(); await released(c.page); }
      await page.getByRole('button', { name: 'Next round', exact: true }).click();
    }
    for (const c of [host, guest]) {
      await c.page.getByRole('heading', { name: 'That’s a wrap. Play another?', exact: true }).waitFor();
      await c.page.waitForFunction(({ red, blue }) => ['Red', 'Blue'].every((name, i) => [...document.querySelectorAll('.guess-board li')].some(row => row.querySelector('strong')?.textContent?.startsWith(name) && Number(row.querySelector('b')?.textContent) === [red, blue][i])), { red: redTotal, blue: blueTotal });
      assert.equal(await c.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(c.latest().game.phase, 'results'); assert.equal(c.latest().game.scoreboard.find(p => p.nickname === 'Red')?.total, redTotal); assert.equal(c.latest().game.scoreboard.find(p => p.nickname === 'Blue')?.total, blueTotal); assert.equal(c.waves.length, 8);
    }
    assert.equal(seen.size, 8); assert.equal(host.actions.filter(a => a === 'start').length, 1); assert.equal(host.actions.filter(a => a === 'guess').length, 8); assert.equal(guest.actions.filter(a => a === 'guess').length, 8);
    assert.deepEqual(music(), before); assert.deepEqual(sinkCalls, []); assert.deepEqual(playbackWrites, []); assert.deepEqual(external, []); assert.deepEqual(failures, []);
    assert.equal(await source.reload(), true, 'A healthy manager does not refresh an active catalog');
    assert.equal(extracts, 8); assert.equal(fetches, 8); assert.equal(decodes, 8, 'Serving rounds never prepares or fetches more source audio');
    console.log('Bundled EDM pack: 8/8 distinct rounds, 16 decoded clips, 16 correct answers; held-read Start/guess regressions passed.');
  } finally { for (const g of gates) g.release.resolve(); await browser.close(); await server.close(); lifetime.abort(); source.dispose(); commands.close(); engine.close(); store.close(); }
});
