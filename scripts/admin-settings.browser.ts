// Real admin form with synthetic, isolated guild APIs. Never logs in to Discord.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as typeof import('playwright');
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:8787';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const phase = process.env.ADMIN_SETTINGS_PHASE ?? 'after';
assert(['before', 'after'].includes(phase));
await mkdir('outputs/admin-settings', {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox']});
const observed: {width: number; retired: number; groups: number}[] = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({viewport: {width, height: 1000}, reducedMotion: 'reduce'});
    try {
      await context.addInitScript(() => localStorage.setItem('gutta-language', 'en'));
      const guilds = [{id: '111111111111111', name: 'Synthetic A', installed: true, roomCode: 'ROOMAAAA'}, {id: '222222222222222', name: 'Synthetic B', installed: true, roomCode: 'ROOMBBBB'}];
      const initial = {playlistLimit: 50, defaultQueuePageSize: 10, defaultVolume: 60, audioBitrateKbps: 192, crossfade: 6,
        secondsToWaitAfterQueueEmpties: 300, leaveIfNoListeners: true, queueAddResponseEphemeral: true,
        autoAnnounceNextSong: false, turnDownVolumeWhenPeopleSpeak: false, turnDownVolumeWhenPeopleSpeakTarget: 30, radio: true};
      const saved = new Map(guilds.map(guild => [guild.id, {...initial, defaultVolume: guild.id === guilds[0].id ? 60 : 80}]));
      let denySave = false;
      const writes: {guildId: string; operation: string; settings: typeof initial}[] = [];
      const page = await context.newPage(), errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        let data: unknown = {};
        if (url.pathname === '/api/admin/guilds') data = {authenticated: true, globalAdmin: false, guilds, invite: 'https://example.test/install'};
        else if (url.pathname === '/api/admin/control') {
          if (route.request().method() === 'POST') {
            const input: typeof writes[number] = route.request().postDataJSON();
            assert.equal(input.operation, 'settings'); assert(guilds.some(guild => guild.id === input.guildId));
            writes.push(input);
            if (denySave) return route.fulfill({status: 403, json: {error: 'Synthetic permission denied. Your changes were not saved.'}});
            saved.set(input.guildId, {...saved.get(input.guildId)!, ...input.settings});
            data = {settings: {...saved.get(input.guildId), updatedAt: new Date().toISOString()}};
          } else {
            const id = url.searchParams.get('guildId')!;
            data = {guildId: id, roomCode: guilds.find(guild => guild.id === id)!.roomCode,
              state: {ready: true, connected: false, playing: false, current: null, queue: [], position: 0, volume: 60}, settings: saved.get(id),
              player: {loopCurrentSong: false, loopCurrentQueue: false, bitrate: 192000, radioProvider: 'artist', lastfmConfigured: false}, snapshots: [], commands: [], sleepTimerEndsAt: null};
          }
        } else if (route.request().method() !== 'GET') throw Error('Unexpected mutation');
        return route.fulfill({json: data});
      });
      await page.goto(base + '/admin?guildId=' + guilds[1].id, {waitUntil: 'networkidle'});
      await page.getByRole('button', {name: 'Settings', exact: true}).click();
      const form = page.locator('.settings-grid');
      await form.locator('input').first().waitFor();
      await page.screenshot({path: `outputs/admin-settings/${phase}-${width}.png`, fullPage: true, animations: 'disabled'});
      observed.push({width, retired: await form.locator('label').filter({hasText: /Private queue confirmation|Announce next track/}).count(), groups: await form.locator('fieldset').count()});
      if (phase === 'before') continue;
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      assert.equal(await page.locator('.guild-select select').inputValue(), guilds[1].id, 'Admin link preselects only an authorized guild');
      assert.equal(await form.locator('input').count(), 10);
      for (const [name, min, max] of [['Default volume', 0, 100], ['Playlist limit', 1, 1000], ['Tracks per queue page', 1, 30], ['Audio bitrate', 64, 384], ['Crossfade', 0, 12], ['Wait after the queue empties', 0, 86400], ['Volume while people speak', 0, 100]] as const) {
        const input = form.getByLabel(name, {exact: true});
        assert.equal(await input.getAttribute('min'), String(min)); assert.equal(await input.getAttribute('max'), String(max));
        assert(await input.getAttribute('aria-describedby'), `${name}: units and range remain associated`);
      }
      const volume = form.getByLabel('Default volume', {exact: true});
      assert.equal(await volume.inputValue(), '80');
      await volume.fill('44');
      await form.getByRole('button', {name: 'Save settings', exact: true}).click();
      await form.getByRole('status').filter({hasText: 'Settings saved'}).waitFor();
      assert.equal(saved.get(guilds[1].id)!.defaultVolume, 44); assert.equal(saved.get(guilds[0].id)!.defaultVolume, 60);
      assert.equal(Object.keys(writes[0].settings).length, 10, 'Only implemented controls are submitted');
      assert(!('queueAddResponseEphemeral' in writes[0].settings)); assert(!('autoAnnounceNextSong' in writes[0].settings));
      denySave = true;
      await volume.fill('45');
      await form.getByRole('button', {name: 'Save settings', exact: true}).click();
      await form.getByRole('alert').filter({hasText: 'Synthetic permission denied'}).waitFor();
      assert.equal(saved.get(guilds[1].id)!.defaultVolume, 44); assert.equal(await volume.inputValue(), '45');
      assert.equal(await form.getByRole('status').count(), 0, 'A rejected save cannot retain the saved confirmation');
      await page.waitForTimeout(5200);
      assert(await form.getByRole('alert').isVisible(), 'Background polls do not erase an unsaved-settings error');
      await page.locator('.guild-select select').selectOption(guilds[0].id);
      await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#setting-defaultVolume')?.value === '60');
      assert.equal(await form.getByRole('alert').count(), 0, 'Another guild must not inherit this draft or error');
      assert.deepEqual(errors, []);
    } finally {await context.close();}
  }
  console.log(JSON.stringify(observed));
  for (const row of observed) {assert.equal(row.retired, 0, `${row.width}px: retired no-op controls must be absent`); assert.equal(row.groups, 3, `${row.width}px: audio, voice and queue groups`);}
  console.log(`PASS admin settings: ${observed.length} layouts, complete controls, acknowledged saves, errors and guild isolation`);
} finally {await browser.close();}
