// Synthetic game UI and model integration. No real catalog, identity or media service.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { GuessGame, type GuessAccess } from '../services/core/src/guess-game.ts';
import { OperatorGuessCatalog, UnavailableGuessCatalog } from '../services/core/src/guess-catalog.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as typeof import('playwright');
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:8787';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const shots = process.env.SCREENSHOT_DIR ?? '/tmp/afterparty-guess-shots'; await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
let time = 1_000_000, unavailable = true, foreign = false, denied = 0;
const catalog = new OperatorGuessCatalog(Array.from({ length: 5 }, (_, i) => ({ rightsCleared: true as const, categoryIds: ['2010s'], song: { id: `fictional-${i}`, title: `Fictional Signal ${i + 1}`, artist: 'Sample Artist', aliases: [`Invented Alias ${i + 1}`], mediaKey: `synthetic_media_${String(i).padStart(4, '0')}` }, media: { key: `synthetic_media_${String(i).padStart(4, '0')}`, mimeType: 'audio/wav' as const, durationSeconds: 90 } })), () => 0);
let model = new GuessGame({ now: () => time });
const actions: string[] = [], playbackWrites: string[] = [];
const wave = Buffer.alloc(46); wave.write('RIFF'); wave.writeUInt32LE(38, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(2, 40);
const preview = { kind: 'synthetic-fixture', dataUrl: 'data:audio/wav;base64,' + wave.toString('base64') };
async function client(host: boolean, nickname: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('gutta-language', 'en'); localStorage.setItem('afterparty-audio', '{"level":23,"muted":false,"lastAudible":23}');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !(window as unknown as { fixtureOffline?: boolean }).fixtureOffline });
    const state = window as unknown as { testAudioCreated: number; testAudioActive: number }; state.testAudioCreated = 0; state.testAudioActive = 0;
    class SyntheticAudio {
      active = false; volume = 1; currentTime = 0; onended: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor() { state.testAudioCreated++; }
      play() { if (!this.active) { state.testAudioActive++; this.active = true; } return Promise.resolve(); }
      pause() { if (this.active) { state.testAudioActive--; this.active = false; } }
      removeAttribute() {} load() {}
    }
    window.Audio = SyntheticAudio as unknown as typeof Audio;
    const original = Date.now; Date.now = () => original() + 7200000;
  });
  const actor = host ? 'anonymous-host' : 'anonymous-guest';
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname !== '/api/guess') { if (route.request().method() !== 'GET') playbackWrites.push(url.pathname); return route.fulfill({ json: {} }); }
    const input = route.request().postDataJSON(); actions.push(`${actor}:${input.action}`);
    if (input.action === 'catalog') return route.fulfill({ json: { categories: unavailable ? new UnavailableGuessCatalog().categories() : catalog.categories(), playable: false } });
    if (denied) return route.fulfill({ status: denied, json: { error: 'Synthetic access changed' } });
    assert.equal(input.scope, 'room'); assert.equal(input.scopeId, 'TESTROOM');
    if (input.action !== 'join') assert.equal(input.token, `synthetic-${actor}`);
    const access: GuessAccess = { scope: 'room', scopeId: 'TESTROOM', host, actor };
    const fields = Object.fromEntries(Object.entries(input).filter(([key]) => !['scope', 'scopeId', 'token'].includes(key)));
    try {
      const value = model.apply(access, fields);
      if (value.game.phase === 'round') {
        const payload = JSON.stringify(value.game);
        for (const secret of ['Fictional Signal', 'Sample Artist', 'Invented Alias', 'synthetic_media_', 'fictional-']) assert.equal(payload.includes(secret), false, `Public round leaked ${secret}`);
      }
      if (foreign && host && input.action === 'read') { foreign = false; value.game.scopeId = 'FOREIGN1'; value.game.scoreboard[0].nickname = 'FOREIGN PLAYER'; }
      return route.fulfill({ json: { ...value, canManage: host, ...(input.action === 'join' ? { token: `synthetic-${actor}` } : {}), ...(value.game.phase === 'round' ? { preview } : {}) } });
    } catch (cause) { const error = cause as Error & { status?: number }; return route.fulfill({ status: error.status ?? 500, json: { error: error.message } }); }
  });
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/games?room=TESTROOM`);
  const join = async () => { await page.getByLabel('Nickname', { exact: true }).fill(nickname); await page.getByRole('button', { name: 'Join lobby', exact: true }).click(); await page.getByRole('complementary', { name: 'Scoreboard' }).waitFor(); };
  return { page, context, errors, join, access: { scope: 'room', scopeId: 'TESTROOM', host, actor } as GuessAccess };
}
try {
  const host = await client(true, 'Red'); const page = host.page;
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
  assert.equal(await page.evaluate(() => (window as unknown as { testAudioActive: number }).testAudioActive), 1);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.getByText('Games pause while this tab is hidden.').waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as { testAudioActive: number }).testAudioActive), 0);
  await page.evaluate(() => { delete (document as unknown as { visibilityState?: string }).visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(2800); assert.equal(await page.evaluate(() => (window as unknown as { testAudioActive: number }).testAudioActive), 0, 'Returning never autoplays game audio');
  await page.getByLabel('Song title', { exact: true }).fill('fictional signal 1'); await page.getByRole('button', { name: 'Send guess' }).click();
  await page.getByText('Correct! Points saved for this round.', { exact: false }).waitFor();
  assert.equal(model.apply(host.access, { action: 'read' }).game.scoreboard[0].total, 850);
  assert(await page.getByRole('button', { name: 'Send guess' }).isDisabled());
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
  await page.getByRole('button', { name: 'Reveal answer' }).click(); await page.getByRole('heading', { name: 'Fictional Signal 1', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Next round' }).click(); await page.getByRole('heading', { name: 'What’s the song?' }).waitFor();
  state = model.apply(host.access, { action: 'read' }).game; time = state.round!.deadline;
  await page.getByRole('heading', { name: 'Fictional Signal 2', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Next round' }).click(); await page.getByRole('heading', { name: 'That’s a wrap. Play another?' }).waitFor();
  await page.screenshot({ path: `${shots}/guess-results-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'New game' }).click(); await page.getByRole('heading', { name: 'Game settings' }).waitFor();
  assert(model.apply(host.access, { action: 'read' }).game.scoreboard.every(p => p.total === 0));
  foreign = true; await page.getByText('Waiting for this game’s latest state.').waitFor(); assert.equal(await page.getByText('FOREIGN PLAYER', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Reconnect game' }).click(); await page.waitForTimeout(2800);
  await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('heading', { name: 'What’s the song?' }).waitFor();
  state = model.apply(host.access, { action: 'read' }).game; time = state.round!.startsAt + 1000; await page.waitForTimeout(2800); await listen.click();
  denied = 403; await page.getByText('Synthetic access changed').waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as { testAudioActive: number }).testAudioActive), 0, 'Auth loss releases local audio');
  denied = 0;
  await page.getByRole('button', { name: 'Leave game' }).click(); const before = actions.filter(a => a.startsWith('anonymous-host:')).length; await page.waitForTimeout(3000); assert.equal(actions.filter(a => a.startsWith('anonymous-host:')).length, before, 'Leaving cleans up this participant’s polling');
  assert.equal(await page.getByRole('button', { name: 'Join lobby', exact: true }).evaluate(el => el === document.activeElement), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('afterparty-audio')), '{"level":23,"muted":false,"lastAudible":23}');
  assert.deepEqual(playbackWrites, []); assert.deepEqual(host.errors, []); assert.deepEqual(guest.errors, []);
  await guest.context.close(); await host.context.close(); console.log(`Synthetic competitive game workflows passed; screenshots: ${shots}`);
} finally { await browser.close(); }
