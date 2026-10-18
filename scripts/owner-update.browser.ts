// Synthetic owner sessions only. No updater, Discord account or Core is contacted.
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as typeof import('playwright');
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:8787';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox']});
try {
  for (const scenario of ['poll-expiry', 'offline-rotation', 'discord-owner-expiry', 'discord-room-race', 'valid-owner-denied'] as const) {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let validOwner = true, denyControl = false, sessionReads = 0, guildReads = 0;
    const guilds = scenario === 'offline-rotation' ? [] : [{id: '111111111111111', name: 'Synthetic guild', installed: true, roomCode: 'TESTROOM'}];
    const discord = scenario.startsWith('discord-');
    let releaseRooms: (() => void) | undefined;
    let markRoomsPending: () => void;
    const roomsPending = new Promise<void>(resolve => {markRoomsPending = resolve;});
    await page.clock.install();
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      assert.equal(route.request().method(), 'GET', 'Session checks must never mutate settings');
      let data: unknown = {};
      if (url.pathname === '/api/admin/guilds') {
        guildReads++;
        data = {authenticated: true, method: discord ? 'discord' : 'owner', globalAdmin: true, guilds, invite: '', ownerUpdateUrl: 'https://updater.example.test/'};
      } else if (url.pathname === '/api/admin/session') {
        sessionReads++;
        data = {authenticated: validOwner, method: validOwner ? 'password' : 'owner'};
      } else if (url.pathname === '/api/admin/control') {
        if (denyControl) return route.fulfill({status: 403, json: {error: 'Synthetic permission denied'}});
        data = {guildId: guilds[0].id, roomCode: 'TESTROOM', state: {ready: true, connected: false, playing: false, current: null, queue: [], position: 0, volume: 60}, settings: {}, player: {}, snapshots: [], commands: [], sleepTimerEndsAt: null};
      } else if (url.pathname === '/api/admin/rooms') {
        if (scenario === 'discord-room-race') await new Promise<void>(resolve => {releaseRooms = resolve; markRoomsPending();});
        data = {rooms: [{code: 'TESTROOM', name: 'Synthetic private owner room', mode: 'private', viewers: 1}]};
      }
      return route.fulfill({json: data});
    });
    await page.goto(base + '/admin', {waitUntil: 'networkidle'});
    const updater = page.getByRole('link', {name: 'Update bot and website', exact: true});
    await updater.waitFor();
    assert.equal(await updater.getAttribute('href'), 'https://updater.example.test/');
    if (scenario !== 'offline-rotation') await page.locator('.admin-tabs').waitFor();
    if (scenario === 'discord-room-race') {
      await page.locator('.admin-tabs button').last().click();
      await roomsPending;
      assert(releaseRooms, 'An owner-only request is pending before expiry');
    }
    validOwner = scenario === 'valid-owner-denied';
    denyControl = scenario !== 'offline-rotation';
    await page.clock.fastForward(5100);
    if (validOwner) {
      await page.getByRole('alert').filter({hasText: 'Synthetic permission denied'}).waitFor();
      assert.equal(await updater.count(), 1, 'Core permission errors must not revoke a valid local owner session');
      assert.equal(await page.locator('.admin-login').count(), 0);
    } else {
      await updater.waitFor({state: 'detached', timeout: 5000});
      assert(sessionReads > 0, 'Owner session is revalidated independently of Core and selected guild');
      assert.equal(guildReads, 1, 'No guild metadata reload or Core dependency is needed');
      if (discord) {
        assert.equal(await page.locator('.admin-login').count(), 0, 'Discord server access remains separate from expired owner access');
        assert.equal(await page.getByRole('button', {name: 'Sign out', exact: true}).count(), 1);
        if (scenario === 'discord-room-race') {
          const completed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/rooms');
          releaseRooms!();
          await completed;
          await page.waitForTimeout(100);
          assert.equal(await page.locator('.admin-room').count(), 0, 'A late owner-only room response cannot restore revoked access');
          assert.equal(await page.getByText('Synthetic private owner room', {exact: true}).count(), 0);
        }
      } else {
        await page.locator('.admin-login').waitFor();
        assert.equal(await page.locator('.admin-tabs').count(), 0);
        assert.equal(await page.getByRole('button', {name: 'Sign out', exact: true}).count(), 0);
      }
      await page.clock.fastForward(10000);
      assert.equal(await updater.count(), 0, 'The private URL must not reappear after invalidation');
    }
    assert.deepEqual(errors, []);
    console.log('PASS owner updater ' + scenario);
    await page.close();
  }
} finally {await browser.close();}
