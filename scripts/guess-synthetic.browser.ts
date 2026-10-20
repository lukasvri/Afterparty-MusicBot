// Local synthetic acceptance: real Core HTTP, source, game and Chromium decoder.
// The website authority/proxy is an explicit Playwright fixture, not deployment proof.
// coreUrl requires HTTPS and guessInput requires a D1 room; this runner supplies neither.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { Page } from 'playwright';
import type { Sink } from '../services/core/src/audio.ts';
import { Commands } from '../services/core/src/commands.ts';
import { Engine } from '../services/core/src/engine.ts';
import { Providers } from '../services/core/src/providers.ts';
import { Store } from '../services/core/src/store.ts';
import { createServers } from '../services/core/src/server.ts';
import { SyntheticGuessSource } from '../services/core/src/guess-synthetic.ts';
import { DEFAULT_GUESS_SETTINGS, type GuessResult } from '../services/core/src/guess-game.ts';
import { GUESS_AUDIO_MAX_BYTES, guessWaveSeconds } from '../services/core/src/guess-audio-format.ts';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as typeof import('playwright');
const baseUrl = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:8787');
assert(['localhost', '127.0.0.1'].includes(baseUrl.hostname), 'Only a loopback website preview is allowed');
assert.equal(baseUrl.protocol, 'http:');
const base = baseUrl.origin, key = 'synthetic-browser-only-bridge-key';
const shots = process.env.SCREENSHOT_DIR ?? '/tmp/afterparty-guess-synthetic-shots';
const savedAudio = '{"level":23,"muted":false,"lastAudible":23}';
type Result = GuessResult & { canManage: boolean; mediaAvailable: boolean; token?: string };
type AudioState = { created: number; active: number; urls: number; revoked: number; last?: HTMLAudioElement };
type Gate = { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred>; finished: ReturnType<typeof deferred>; canceled: boolean };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('Synthetic bridge did not settle.')), 10000); })]); }
  finally { clearTimeout(timer); }
}
const source = new SyntheticGuessSource(), store = new Store(':memory:'), sinkCalls: string[] = [];
const sink: Sink = { onIdle: null, onError: null, play() { sinkCalls.push('play'); }, pause() { sinkCalls.push('pause'); }, resume() { sinkCalls.push('resume'); }, stop() { sinkCalls.push('stop'); }, duration: () => 0, advancing: () => false, buffering: () => false };
const engine = new Engine(store, new Providers(store, { NODE_ENV: 'test' }), sink), commands = new Commands(engine);
clearInterval(engine.timer); engine.ready = true;
engine.current = { id: 'abcdefghijk', entryId: 'synthetic-ordinary-current', title: 'Independent fixture music', artist: 'Fixture artist', image: '', duration: 600, live: false, embeddable: true, concert: false };
engine.queue = [{ ...engine.current, entryId: 'synthetic-ordinary-queued' }];
const music = () => structuredClone({ current: engine.current, queue: engine.queue, revision: engine.revision(), queueRevision: commands.concertQueue.revision(), paused: engine.paused });
const initialMusic = music(), initialSinkCalls = [...sinkCalls];
let server: Awaited<ReturnType<typeof createServers>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let hold: Gate | null = null;
const routeErrors: string[] = [], forbiddenWrites: string[] = [];
let mediaReads = 0;

async function playing(page: Page) {
  await page.waitForFunction(() => (window as unknown as { syntheticAudio: AudioState }).syntheticAudio.active === 1);
}
async function released(page: Page) {
  await page.waitForFunction(() => {
    const s = (window as unknown as { syntheticAudio: AudioState }).syntheticAudio;
    return s.active === 0 && s.urls === s.revoked && (!s.last || (s.last.paused && !s.last.hasAttribute('src')));
  });
}
async function layout(page: Page, label: string) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}/${width} horizontal overflow`);
    await page.screenshot({ path: `${shots}/${label}-${width}.png`, fullPage: true, animations: 'disabled' });
  }
}
async function score(page: Page, nickname: string, total: number) {
  await page.waitForFunction(({ nickname, total }) => [...document.querySelectorAll('.guess-board li')].some(row => row.querySelector('strong')?.textContent?.startsWith(nickname) && Number(row.querySelector('b')?.textContent) === total), { nickname, total });
}

try {
  await mkdir(shots, { recursive: true });
  server = await createServers(engine, commands, { key, origin: base, host: '127.0.0.1', publicPort: 0, guessCatalog: source, guessMedia: source });
  const core = `http://127.0.0.1:${(server.publicServer.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  async function client(host: boolean) {
    const context = await browser!.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addInitScript(({ savedAudio }) => {
      localStorage.setItem('gutta-language', 'en'); localStorage.setItem('afterparty-audio', savedAudio);
      // The no-network container reports offline even though its loopback Core/preview is reachable.
      // Model an online local client explicitly; offline/reconnect behavior is covered by guess.browser.ts.
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      const s: AudioState = { created: 0, active: 0, urls: 0, revoked: 0 };
      (window as unknown as { syntheticAudio: AudioState }).syntheticAudio = s;
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL), NativeAudio = window.Audio;
      URL.createObjectURL = blob => { s.urls++; return create(blob); };
      URL.revokeObjectURL = url => { s.revoked++; revoke(url); };
      window.Audio = function(src?: string) {
        const audio = new NativeAudio(src); s.last = audio; s.created++; let counted = false;
        audio.addEventListener('playing', () => { if (!counted) { counted = true; s.active++; } });
        const quiet = () => { if (counted) { counted = false; s.active--; } };
        audio.addEventListener('pause', quiet); audio.addEventListener('ended', quiet); audio.addEventListener('error', quiet);
        const pause = audio.pause.bind(audio); audio.pause = () => { pause(); quiet(); };
        return audio;
      } as unknown as typeof Audio;
    }, { savedAudio });
    let latest: Result | undefined, token = '', calls = 0;
    const replies: { action: unknown; status: number; error?: string }[] = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (!['/api/guess', '/api/guess/media'].includes(url.pathname)) {
        if (route.request().method() !== 'GET') forbiddenWrites.push(url.pathname);
        return route.fulfill({ json: {} });
      }
      calls++;
      try {
        const input = route.request().postDataJSON() as Record<string, unknown>;
        // Explicit fixture authority. Browser-supplied roles/room expiry never pass through.
        const fields = Object.fromEntries(['scope', 'scopeId', 'action', 'token', 'eventId', 'sessionId', 'revision', 'roundId', 'categoryId', 'settings', 'nickname', 'text'].filter(name => input[name] !== undefined).map(name => [name, input[name]]));
        if (input.action !== 'catalog') { assert.equal(input.scope, 'room'); assert.equal(input.scopeId, 'TESTROOM'); }
        const response = await fetch(core + '/v1/guess', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ ...fields, host, roomExpiresAt: Date.now() + 3_600_000 }), signal: AbortSignal.timeout(12000) });
        if (url.pathname === '/api/guess/media' && response.ok) {
          const bytes = new Uint8Array(await response.arrayBuffer()); mediaReads++;
          assert.equal(response.headers.get('content-type'), 'audio/wav');
          assert.equal(response.headers.get('cache-control'), 'private, no-store');
          assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
          assert.equal(bytes.length, GUESS_AUDIO_MAX_BYTES); assert.equal(guessWaveSeconds(bytes), 30);
          const gate = hold;
          if (gate) { gate.entered.resolve(); await gate.release.promise; }
          try {
            if (gate?.canceled) { await route.abort('aborted').catch(() => {}); return; }
            await route.fulfill({ body: Buffer.from(bytes), headers: { 'content-type': 'audio/wav', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
          } finally { gate?.finished.resolve(); }
          return;
        }
        const value = await response.json() as Result;
        replies.push({ action: input.action, status: response.status, error: (value as unknown as { error?: string }).error });
        if (response.ok && input.action !== 'catalog') {
          latest = value; if (value.token) token = value.token;
          if (value.game.phase === 'round') {
            const publicRound = JSON.stringify(value.game);
            for (const secret of ['Test Tone ', 'Synthetic Test Generator', 'synthetic_test_tone_', 'synthetic-test-']) assert.equal(publicRound.includes(secret), false, `Core round leaks ${secret}`);
          }
        }
        if (input.action === 'catalog') {
          assert.equal((value as unknown as { syntheticTest: boolean }).syntheticTest, true);
          assert.equal((value as unknown as { playable: boolean }).playable, true);
        }
        await route.fulfill({ status: response.status, json: value });
      } catch (error) {
        routeErrors.push(error instanceof Error ? error.message : String(error));
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/games?room=TESTROOM');
    await page.getByText('Synthetic audio test', { exact: true }).waitFor();
    return { context, page, errors, diagnostics: () => ({ replies, routeErrors, calls, tokenPresent: Boolean(token), latest: latest ? { phase: latest.game.phase, scope: latest.game.scope, players: latest.game.scoreboard.length } : null }), latest: () => { assert(latest); return latest; }, token: () => token, calls: () => calls };
  }
  const host = await client(true), guest = await client(false), page = host.page;
  for (const c of [host, guest]) {
    await c.page.getByRole('heading', { name: 'Synthetic test tones', exact: true }).waitFor();
    await c.page.getByText('Available', { exact: true }).waitFor();
    await c.page.getByRole('note').filter({ hasText: 'No real songs or provider music.' }).waitFor();
    assert.equal(await c.page.locator('iframe').count(), 0);
    assert.equal(c.token(), '', 'Opening Games does not join');
  }
  await layout(page, 'synthetic-entry-en');
  await page.getByRole('button', { name: 'Bokmål', exact: true }).click();
  for (const label of ['Syntetisk lydtest', 'Velg opptil fem genererte testtoner og runder på opptil 30 sekunder.', 'Dette tester den delte spillflyten, ikke en sangkatalog eller musikkrettigheter.']) await page.getByText(label, { exact: true }).waitFor();
  await page.getByRole('note').filter({ hasText: 'Ingen ekte sanger eller leverandørmusikk.' }).waitFor();
  await page.getByRole('note').filter({ hasText: 'Testsvar: Test Tone One' }).waitFor();
  await layout(page, 'synthetic-entry-nb');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  for (const [c, nickname] of [[host, 'Red'], [guest, 'Blue']] as const) {
    await c.page.getByLabel('Nickname', { exact: true }).fill(nickname);
    await c.page.getByRole('button', { name: 'Join lobby', exact: true }).click();
    try { await c.page.getByRole('complementary', { name: 'Scoreboard', exact: true }).waitFor({ timeout: 10000 }); }
    catch (error) {
      await c.page.screenshot({ path: `${shots}/synthetic-join-failure.png`, fullPage: true });
      console.error(JSON.stringify({ stage: 'join', nickname, diagnostics: c.diagnostics(), browserState: await c.page.evaluate(() => ({ visibility: document.visibilityState, online: navigator.onLine })), errors: c.errors, body: await c.page.locator('body').innerText() }));
      throw error;
    }
    assert.deepEqual(c.latest().game.settings, DEFAULT_GUESS_SETTINGS);
    assert.equal(c.latest().game.categoryId, 'synthetic-test');
    assert.equal(c.latest().canManage, c === host);
  }
  // Joining changes the revision; edit only after the host has the shared roster.
  await score(page, 'Blue', 0);
  for (const [name, minimum, maximum, value] of [['Round seconds', '15', '30', '30'], ['Rounds', '1', '5', '5']] as const) {
    const input = page.getByLabel(name, { exact: true });
    assert.equal(await input.getAttribute('min'), minimum); assert.equal(await input.getAttribute('max'), maximum); assert.equal(await input.inputValue(), value);
    await input.fill(String(Number(maximum) + 1));
    assert.equal(await input.evaluate(element => (element as HTMLInputElement).validity.rangeOverflow), true);
    await input.fill(value);
    assert(await guest.page.getByLabel(name, { exact: true }).isDisabled());
  }
  assert(await guest.page.getByRole('button', { name: 'Start game', exact: true }).isDisabled());
  assert.equal(await guest.page.getByRole('button', { name: 'Save game settings', exact: true }).count(), 0);
  const guestState = guest.latest();
  assert.equal(await guest.page.evaluate(async input => (await fetch('/api/guess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status, { action: 'start', scope: 'room', scopeId: 'TESTROOM', host: true, token: guest.token(), sessionId: guestState.game.sessionId, roundId: null, revision: guestState.game.revision, eventId: randomUUID() }), 403, 'Core rejects guest management even when browser input claims host');
  // Save the unchanged defaults after checking native input limits.
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guess') && r.request().postDataJSON()?.action === 'configure');
  await page.getByRole('button', { name: 'Save game settings', exact: true }).click(); assert.equal((await saved).status(), 200);
  await page.getByRole('button', { name: 'Start game', exact: true }).click();

  const answers = new Set<string>();
  let redTotal = 0, blueTotal = 0;
  for (let round = 1; round <= 5; round++) {
    for (const c of [host, guest]) {
      await c.page.getByRole('heading', { name: 'What’s the song?', exact: true }).waitFor();
      await c.page.getByRole('button', { name: 'Listen to preview', exact: true }).waitFor();
      assert.equal(await c.page.locator('.guess-stage-top').innerText().then(text => text.includes(`${round}/5`)), true);
      await c.page.getByRole('button', { name: 'Listen to preview', exact: true }).click(); await playing(c.page);
      const decoded = await c.page.evaluate(() => { const audio = (window as unknown as { syntheticAudio: AudioState }).syntheticAudio.last!; return { duration: audio.duration, ready: audio.readyState, position: audio.currentTime }; });
      assert.equal(decoded.duration, 30); assert(decoded.ready >= 2);
      await c.page.waitForTimeout(150);
      assert((await c.page.evaluate(() => (window as unknown as { syntheticAudio: AudioState }).syntheticAudio.last!.currentTime)) > decoded.position, 'Native decoder clock advances');
      assert.equal(c.latest().game.settings.roundCount, 5); assert.equal(c.latest().game.settings.durationSeconds, 30);
    }
    assert.equal(await guest.page.getByRole('button', { name: 'Reveal answer', exact: true }).count(), 0);
    if (round === 1) {
      await page.getByRole('button', { name: 'Stop preview', exact: true }).click(); await released(page);
      const gate: Gate = { entered: deferred(), release: deferred(), finished: deferred(), canceled: false }; hold = gate;
      const created = await page.evaluate(() => (window as unknown as { syntheticAudio: AudioState }).syntheticAudio.created);
      await page.getByRole('button', { name: 'Listen to preview', exact: true }).click(); await bounded(gate.entered.promise);
      await page.getByRole('button', { name: 'Cancel preview', exact: true }).click(); gate.canceled = true; gate.release.resolve();
      await bounded(gate.finished.promise); hold = null; await released(page);
      assert.equal(await page.evaluate(() => (window as unknown as { syntheticAudio: AudioState }).syntheticAudio.created), created, 'Canceled completed Core response never creates browser audio');
      await page.getByRole('button', { name: 'Listen to preview', exact: true }).click(); await playing(page);
      await layout(page, 'synthetic-round-en');
    }
    let correct = '';
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      const answer = `Test Tone ${name}`;
      const reply = page.waitForResponse(r => r.url().endsWith('/api/guess') && r.request().postDataJSON()?.action === 'guess');
      await page.getByLabel('Song title', { exact: true }).fill(answer); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
      const response = await reply; assert.equal(response.status(), 200); const result = await response.json() as Result;
      if (result.self.result?.correct) {
        correct = answer; assert(result.self.result.awarded >= 100 && result.self.result.awarded <= 1000);
        redTotal += result.self.result.awarded; await page.getByText('Correct! Points saved for this round.', { exact: false }).waitFor(); break;
      }
      assert.deepEqual(result.self.result, { correct: false, awarded: 0 });
      await page.getByText('Not quite. Try another title.', { exact: true }).waitFor();
    }
    assert(correct, 'One of the five documented synthetic answers must match'); assert(!answers.has(correct)); answers.add(correct);
    await score(guest.page, 'Red', redTotal);
    const guestReply = guest.page.waitForResponse(r => r.url().endsWith('/api/guess') && r.request().postDataJSON()?.action === 'guess');
    await guest.page.getByLabel('Song title', { exact: true }).fill(correct); await guest.page.getByRole('button', { name: 'Send guess', exact: true }).click();
    const guestResponse = await guestReply; assert.equal(guestResponse.status(), 200); const guestResult = await guestResponse.json() as Result;
    assert(guestResult.self.result?.correct); blueTotal += guestResult.self.result.awarded;
    await score(page, 'Blue', blueTotal); await score(guest.page, 'Blue', blueTotal);
    assert(await page.getByRole('button', { name: 'Send guess', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Reveal answer', exact: true }).click();
    for (const c of [host, guest]) {
      await c.page.getByRole('heading', { name: correct, exact: true }).waitFor(); await released(c.page);
      await score(c.page, 'Red', redTotal); await score(c.page, 'Blue', blueTotal);
    }
    await page.getByRole('button', { name: 'Next round', exact: true }).click();
  }
  assert.equal(answers.size, 5);
  for (const c of [host, guest]) {
    await c.page.getByRole('heading', { name: 'That’s a wrap. Play another?', exact: true }).waitFor();
    await score(c.page, 'Red', redTotal); await score(c.page, 'Blue', blueTotal);
  }
  assert.equal(await guest.page.getByRole('button', { name: 'New game', exact: true }).count(), 0);
  await layout(page, 'synthetic-results-en');
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('heading', { name: 'Game settings', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  await page.getByRole('button', { name: 'Listen to preview', exact: true }).click(); await playing(page);
  await page.getByRole('button', { name: 'Leave game', exact: true }).click(); await released(page);
  const afterLeave = host.calls(); await page.waitForTimeout(2800); assert.equal(host.calls(), afterLeave, 'Leaving stops participant polling');
  assert.equal(await page.getByRole('button', { name: 'Join lobby', exact: true }).evaluate(element => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('afterparty-audio')), savedAudio);
  assert.deepEqual(music(), initialMusic); assert.deepEqual(sinkCalls, initialSinkCalls);
  assert.deepEqual(forbiddenWrites, []); assert.deepEqual(routeErrors, []); assert.deepEqual(host.errors, []); assert.deepEqual(guest.errors, []);
  assert(mediaReads >= 12, 'Both clients receive generated Core WAV in every round');
  await guest.context.close(); await host.context.close();
  console.log(`Synthetic Core/browser acceptance passed; fixture website authority/proxy only; screenshots: ${shots}`);
} finally {
  hold?.release.resolve();
  await browser?.close(); await server?.close(); commands.close(); engine.close(); store.close();
}
