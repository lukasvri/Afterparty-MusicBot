// Synthetic game UI and model integration. No real catalog, identity or media service.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { guessWave } from '../services/core/src/guess-audio-format.ts';
import { GuessGame, type GuessAccess } from '../services/core/src/guess-game.ts';
import { OperatorGuessCatalog, UnavailableGuessCatalog } from '../services/core/src/guess-catalog.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as typeof import('playwright');
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:8787';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const shots = process.env.SCREENSHOT_DIR ?? '/tmp/afterparty-guess-shots'; await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
let time = 1_000_000, unavailable = true, foreign = false, denied = 0;
const catalog = new OperatorGuessCatalog(Array.from({ length: 5 }, (_, i) => ({ rightsCleared: true as const, categoryIds: ['2010s'], song: { id: `fictional-${i}`, title: `Fictional Signal ${i + 1}`, artist: 'Sample Artist', aliases: [`Invented Alias ${i + 1}`], mediaKey: `synthetic_media_${String(i).padStart(4, '0')}` }, media: { key: `synthetic_media_${String(i).padStart(4, '0')}`, mimeType: 'audio/wav' as const, durationSeconds: 30 } })), () => 0);
let model = new GuessGame({ now: () => time });
const actions: string[] = [], playbackWrites: string[] = [];
const pcm = new Int16Array(16000 * 30); for (let n = 0; n < pcm.length; n++) pcm[n] = Math.round(Math.sin(n * Math.PI * 2 * 440 / 16000) * 4000);
const wave = Buffer.from(guessWave(new Uint8Array(pcm.buffer)));
let mediaCalls = 0, holdMedia: Promise<void> | null = null, mediaEntered: (() => void) | null = null;
async function waitForMedia(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('The synthetic media route was not reached.')), 5000); })]); }
  finally { clearTimeout(timer); }
}
async function client(host: boolean, nickname: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('gutta-language', 'en'); localStorage.setItem('afterparty-audio', '{"level":23,"muted":false,"lastAudible":23}');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !(window as unknown as { fixtureOffline?: boolean }).fixtureOffline });
    const state = window as unknown as { testAudioCreated: number; testAudioActive: number; lastAudio: HTMLAudioElement; blockNextPlay?: boolean; urlsCreated: number; urlsRevoked: number };
    state.testAudioCreated = state.testAudioActive = state.urlsCreated = state.urlsRevoked = 0;
    const originalCreate = URL.createObjectURL.bind(URL), originalRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { state.urlsCreated++; return originalCreate(blob); };
    URL.revokeObjectURL = url => { state.urlsRevoked++; originalRevoke(url); };
    const NativeAudio = window.Audio;
    window.Audio = function(src?: string) {
      const value = new NativeAudio(src); state.lastAudio = value; state.testAudioCreated++; let counted = false;
      value.addEventListener('playing', () => { if (!counted) { counted = true; state.testAudioActive++; } });
      const quiet = () => { if (counted) { counted = false; state.testAudioActive--; } };
      value.addEventListener('pause', quiet); value.addEventListener('ended', quiet); value.addEventListener('error', quiet);
      // load() may discard the queued pause event; observe the native pause call as well.
      const pause = value.pause.bind(value); value.pause = () => { pause(); quiet(); };
      const play = value.play.bind(value);
      value.play = () => { if (state.blockNextPlay) { state.blockNextPlay = false; return Promise.reject(new DOMException('Synthetic mobile gesture block', 'NotAllowedError')); } return play(); };
      return value;
    } as unknown as typeof Audio;
    const original = Date.now; Date.now = () => original() + 7200000;
  });
  const actor = host ? 'anonymous-host' : 'anonymous-guest';
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (!['/api/guess', '/api/guess/media'].includes(url.pathname)) { if (route.request().method() !== 'GET') playbackWrites.push(url.pathname); return route.fulfill({ json: {} }); }
    const input = route.request().postDataJSON(); actions.push(`${actor}:${input.action}`);
    if (input.action === 'catalog') return route.fulfill({ json: { categories: unavailable ? new UnavailableGuessCatalog().categories() : catalog.categories(), playable: false } });
    if (denied) return route.fulfill({ status: denied, json: { error: 'Synthetic access changed' } });
    assert.equal(input.scope, 'room'); assert.equal(input.scopeId, 'TESTROOM');
    if (input.action !== 'join') assert.equal(input.token, `synthetic-${actor}`);
    const access: GuessAccess = { scope: 'room', scopeId: 'TESTROOM', host, actor };
    if (url.pathname === '/api/guess/media') {
      mediaCalls++; if (holdMedia) { mediaEntered?.(); await holdMedia; }
      try {
        model.media(access, { sessionId: input.sessionId, roundId: input.roundId });
        return await route.fulfill({ body: wave, headers: { 'content-type': 'audio/wav', 'cache-control': 'private, no-store' } });
      } catch { return route.fulfill({ status: 409, json: { error: 'The game round changed.' } }); }
    }
    const fields = Object.fromEntries(Object.entries(input).filter(([key]) => !['scope', 'scopeId', 'token'].includes(key)));
    try {
      const value = model.apply(access, fields);
      if (value.game.phase === 'round') {
        const payload = JSON.stringify(value.game);
        for (const secret of ['Fictional Signal', 'Sample Artist', 'Invented Alias', 'synthetic_media_', 'fictional-']) assert.equal(payload.includes(secret), false, `Public round leaked ${secret}`);
      }
      if (foreign && host && input.action === 'read') { foreign = false; value.game.scopeId = 'FOREIGN1'; value.game.scoreboard[0].nickname = 'FOREIGN PLAYER'; }
      return route.fulfill({ json: { ...value, canManage: host, ...(input.action === 'join' ? { token: `synthetic-${actor}` } : {}), mediaAvailable: value.game.phase === 'round' } });
    } catch (cause) { const error = cause as Error & { status?: number }; return route.fulfill({ status: error.status ?? 500, json: { error: error.message } }); }
  });
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/games?room=TESTROOM`);
  const join = async () => {
    // The SSR form exists before hydration applies the URL room and input handlers.
    await page.waitForFunction(() => (document.querySelector('.guess-join input[pattern]') as HTMLInputElement)?.value === 'TESTROOM');
    await page.getByLabel('Nickname', { exact: true }).fill(nickname);
    const joined = page.waitForResponse(response => response.url().endsWith('/api/guess') && response.request().postDataJSON()?.action === 'join');
    await page.getByRole('button', { name: 'Join lobby', exact: true }).click();
    const response = await joined;
    assert.equal(response.request().postDataJSON().nickname, nickname, 'join sends the entered nickname');
    const value = await response.json();
    assert.equal(value.game.scoreboard.find((player: { id: string }) => player.id === value.self.participantId)?.nickname, nickname);
    await page.getByRole('complementary', { name: 'Scoreboard' }).waitFor();
  };
  return { page, context, errors, join, access: { scope: 'room', scopeId: 'TESTROOM', host, actor } as GuessAccess };
}
try {
  const host = await client(true, 'Red'); const page = host.page;
  const playing = () => page.waitForFunction(() => (window as unknown as { testAudioActive: number }).testAudioActive === 1);
  const released = async () => {
    await page.waitForFunction(() => {
      const state = window as unknown as { testAudioActive: number; urlsCreated: number; urlsRevoked: number; lastAudio?: HTMLAudioElement };
      return state.testAudioActive === 0 && state.urlsCreated === state.urlsRevoked && (!state.lastAudio || state.lastAudio.paused) && !state.lastAudio?.hasAttribute('src');
    });
  };
  await page.getByRole('heading', { name: '2010s', exact: true }).waitFor();
  assert.equal(actions.filter(a => a.endsWith(':join')).length, 0, 'Opening the dedicated tab does not join a game');
  await host.join(); assert(await page.getByRole('button', { name: 'Start game', exact: true }).isDisabled());
  await page.getByLabel('Round seconds', { exact: true }).fill('45'); await page.getByLabel('Rounds', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Save game settings' }).click();
  await page.waitForResponse(r => r.url().endsWith('/api/guess') && r.request().postDataJSON()?.action === 'read');
  assert.equal(model.apply(host.access, { action: 'read' }).game.settings.durationSeconds, 45);
  await page.screenshot({ path: `${shots}/guess-unavailable-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Leave game' }).click();
  unavailable = false; model = new GuessGame({ catalog, now: () => time });
  await host.join();
  const guest = await client(false, 'Blue'); await guest.join();
  await page.waitForTimeout(2800);
  await page.getByLabel('Round seconds', { exact: true }).fill('45');
  const lobby = model.apply(host.access, { action: 'read' }).game;
  model.apply(host.access, { action: 'configure', sessionId: lobby.sessionId, roundId: null, revision: lobby.revision, eventId: crypto.randomUUID(), categoryId: lobby.categoryId, settings: { ...lobby.settings, durationSeconds: 35 } });
  await page.getByText('The lobby changed while you edited. Review the latest settings.', { exact: false }).waitFor();
  assert(await page.getByRole('button', { name: 'Save game settings' }).isDisabled());
  await guest.page.waitForFunction(() => (document.querySelector('input[type=number]') as HTMLInputElement)?.value === '35');
  await page.getByRole('button', { name: 'Use latest settings' }).click();
  assert.equal(await page.getByLabel('Round seconds', { exact: true }).inputValue(), '35');
  await page.getByLabel('Round seconds', { exact: true }).fill('30');
  await page.getByLabel('Rounds', { exact: true }).fill('2'); await page.getByRole('button', { name: 'Save game settings' }).click();
  await page.waitForResponse(r => r.url().endsWith('/api/guess') && r.request().postDataJSON()?.action === 'read');
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  await page.getByRole('heading', { name: 'What’s the song?' }).waitFor();
  assert.equal(await page.getByText('Fictional Signal 1', { exact: true }).count(), 0);
  assert.equal(await page.locator('iframe').count(), 0, 'The quiz never creates a hidden YouTube player');
  assert.equal(await page.evaluate(() => (window as unknown as { testAudioCreated: number }).testAudioCreated), 0);
  let state = model.apply(host.access, { action: 'read' }).game; time = state.round!.startsAt + 5000;
  await page.waitForTimeout(2800);
  const listen = page.getByRole('button', { name: 'Listen to preview', exact: true }); await listen.click();
  await page.waitForFunction(() => (window as unknown as { testAudioActive: number }).testAudioActive === 1);
  const decoded = await page.evaluate(() => { const a = (window as unknown as { lastAudio: HTMLAudioElement }).lastAudio; return { duration: a.duration, ready: a.readyState, position: a.currentTime }; });
  assert.equal(decoded.duration, 30); assert(decoded.ready >= 2); assert(decoded.position >= 5);
  await page.waitForTimeout(300); assert((await page.evaluate(() => (window as unknown as { lastAudio: HTMLAudioElement }).lastAudio.currentTime)) > decoded.position);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.getByText('Games pause while this tab is hidden.').waitFor();
  await released();
  await page.evaluate(() => { delete (document as unknown as { visibilityState?: string }).visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(2800); assert.equal(await page.evaluate(() => (window as unknown as { testAudioActive: number }).testAudioActive), 0, 'Returning never autoplays game audio');
  await page.evaluate(() => { (window as unknown as { blockNextPlay: boolean }).blockNextPlay = true; });
  const beforeBlocked = mediaCalls; await listen.click();
  await page.getByText('Your browser needs another tap to play audio.', {exact:true}).waitFor();
  assert.equal(mediaCalls, beforeBlocked + 1);
  const retryResources = await page.evaluate(() => { const state = window as unknown as { testAudioCreated: number; urlsCreated: number }; return { audio: state.testAudioCreated, urls: state.urlsCreated }; });
  await listen.click(); await page.waitForFunction(() => (window as unknown as {testAudioActive:number}).testAudioActive === 1);
  assert.equal(mediaCalls, beforeBlocked + 1, 'Gesture retry reuses one decoded object URL');
  assert.deepEqual(await page.evaluate(() => { const state = window as unknown as { testAudioCreated: number; urlsCreated: number }; return { audio: state.testAudioCreated, urls: state.urlsCreated }; }), retryResources, 'Gesture retry creates neither another Audio element nor an object URL');
  await page.getByRole('button', {name:'Stop preview',exact:true}).click();
  await released();
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>(); holdMedia = gate.promise; mediaEntered = entered.resolve;
  const beforeHold = mediaCalls, beforeCancelAudio = await page.evaluate(() => (window as unknown as { testAudioCreated: number }).testAudioCreated);
  await listen.click(); await waitForMedia(entered.promise); await page.getByRole('button', {name:'Cancel preview',exact:true}).click();
  gate.resolve(); holdMedia = null; mediaEntered = null; await page.waitForTimeout(200);
  assert.equal(mediaCalls, beforeHold + 1, 'Repeated click cancels rather than starting duplicate fetches');
  await released();
  assert.equal(await page.evaluate(() => (window as unknown as { testAudioCreated: number }).testAudioCreated), beforeCancelAudio, 'A late canceled response cannot create audio');

  await page.getByLabel('Song title', { exact: true }).fill('fictional signal 1'); await page.getByRole('button', { name: 'Send guess' }).click();
  await page.getByText('Correct! Points saved for this round.', { exact: false }).waitFor();
  assert.equal(model.apply(host.access, { action: 'read' }).game.scoreboard[0].total, 850);
  assert(await page.getByRole('button', { name: 'Send guess' }).isDisabled());
  // Advance only after scoring: the original answer still arrives at exactly five seconds.
  time = state.round!.startsAt + 8000; await page.waitForTimeout(2800);
  const delayed = Promise.withResolvers<void>(), delayedEntered = Promise.withResolvers<void>();
  holdMedia = delayed.promise; mediaEntered = delayedEntered.resolve;
  await listen.click(); await waitForMedia(delayedEntered.promise);
  time = state.round!.startsAt + 10000;
  await page.waitForResponse(r => r.url().endsWith('/api/guess') && r.request().postDataJSON()?.action === 'read');
  await page.waitForFunction(() => document.querySelector('.guess-countdown strong')?.textContent?.startsWith('20'));
  delayed.resolve(); holdMedia = null; mediaEntered = null; await playing();
  assert((await page.evaluate(() => (window as unknown as { lastAudio: HTMLAudioElement }).lastAudio.currentTime)) >= 10, 'A delayed successful fetch seeks to the current round clock');
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click(); await released();
  await listen.click(); await playing();
  await page.evaluate(() => { (window as unknown as { fixtureOffline: boolean }).fixtureOffline = true; window.dispatchEvent(new Event('offline')); });
  await page.getByText('You are offline. Reconnect to play.').waitFor(); await released();
  await page.evaluate(() => { (window as unknown as { fixtureOffline: boolean }).fixtureOffline = false; window.dispatchEvent(new Event('online')); });
  await listen.waitFor(); await released();
  await guest.page.getByRole('heading', { name: 'What’s the song?' }).waitFor();
  // An existing round goes straight to the game, not settings.
  assert.equal(await guest.page.getByRole('button', { name: 'Reveal answer' }).count(), 0);
  state = model.apply(host.access, { action: 'read' }).game; time = state.round!.startsAt + 15000;
  await guest.page.waitForTimeout(2800);
  await guest.page.getByLabel('Song title', { exact: true }).fill('Invented Alias 1'); await guest.page.getByRole('button', { name: 'Send guess' }).click();
  await guest.page.getByText('Correct! Points saved for this round.', { exact: false }).waitFor();
  assert.equal(model.apply(guest.access, { action: 'read' }).game.scoreboard.find(p => p.nickname === 'Blue')!.total, 550);
  assert.equal(await guest.page.getByText('Fictional Signal 1', { exact: true }).count(), 0);
  time = state.round!.startsAt + 20000; await page.getByText('Artist starts with S', { exact: true }).waitFor();
  time = state.round!.startsAt + 25000; await page.getByText('3 words in the title', { exact: true }).waitFor();
  await page.screenshot({ path: `${shots}/guess-round-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator('.guess-shell').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  await page.screenshot({ path: `${shots}/guess-round-mobile.png`, fullPage: true });
  const savedGrant = await guest.page.evaluate(() => sessionStorage.getItem('afterparty-guess:room:TESTROOM'));
  denied = 401; await guest.page.getByText('Synthetic access changed').waitFor();
  assert.equal(await guest.page.evaluate(() => sessionStorage.getItem('afterparty-guess:room:TESTROOM')), savedGrant, 'Ordinary sign-in failures cannot discard a valid game grant');
  denied = 0; await guest.page.reload(); await guest.join();
  assert.equal(model.apply(guest.access, { action: 'read' }).game.scoreboard.find(p => p.nickname === 'Blue')!.total, 550, 'Reconnect cannot award or add a duplicate participant');
  assert.equal(model.apply(host.access, { action: 'read' }).game.scoreboard.length, 2);
  await listen.click(); await playing();
  await page.getByRole('button', { name: 'Reveal answer' }).click(); await page.getByRole('heading', { name: 'Fictional Signal 1', exact: true }).waitFor();
  await released();
  await page.getByRole('button', { name: 'Next round' }).click(); await page.getByRole('heading', { name: 'What’s the song?' }).waitFor();
  await released();
  state = model.apply(host.access, { action: 'read' }).game; time = state.round!.startsAt + 1000;
  await listen.waitFor(); await listen.click(); await playing(); time = state.round!.deadline;
  await page.getByRole('heading', { name: 'Fictional Signal 2', exact: true }).waitFor();
  await released();
  await page.getByRole('button', { name: 'Next round' }).click(); await page.getByRole('heading', { name: 'That’s a wrap. Play another?' }).waitFor();
  await page.screenshot({ path: `${shots}/guess-results-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'New game' }).click(); await page.getByRole('heading', { name: 'Game settings' }).waitFor();
  assert(model.apply(host.access, { action: 'read' }).game.scoreboard.every(p => p.total === 0));
  foreign = true; await page.getByText('Waiting for this game’s latest state.').waitFor(); assert.equal(await page.getByText('FOREIGN PLAYER', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Reconnect game' }).click(); await page.waitForTimeout(2800);
  await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('heading', { name: 'What’s the song?' }).waitFor();
  state = model.apply(host.access, { action: 'read' }).game; time = state.round!.startsAt + 1000; await page.waitForTimeout(2800); await listen.click();
  await playing();
  denied = 403; await page.getByText('Synthetic access changed').waitFor();
  await released();
  denied = 0;
  await page.getByRole('button', { name: 'Reconnect game' }).click(); await listen.waitFor(); await listen.click(); await playing();
  await page.getByRole('button', { name: 'Leave game' }).click(); await released(); const before = actions.filter(a => a.startsWith('anonymous-host:')).length; await page.waitForTimeout(3000); assert.equal(actions.filter(a => a.startsWith('anonymous-host:')).length, before, 'Leaving cleans up this participant’s polling');
  assert.equal(await page.getByRole('button', { name: 'Join lobby', exact: true }).evaluate(el => el === document.activeElement), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('afterparty-audio')), '{"level":23,"muted":false,"lastAudible":23}');
  assert.deepEqual(playbackWrites, []); assert.deepEqual(host.errors, []); assert.deepEqual(guest.errors, []);
  await guest.context.close(); await host.context.close(); console.log(`Synthetic competitive game workflows passed; screenshots: ${shots}`);
} finally { await browser.close(); }
