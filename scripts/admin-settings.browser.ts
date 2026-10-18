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
const wording = {
  en: {tab: 'Settings', heading: 'Server settings', save: 'Save settings', saved: 'Settings saved for Synthetic B.',
    mismatch: 'The server did not confirm these settings. Reload and check before trying again.',
    introduction: 'Changes apply only to Synthetic B.',
    groups: ['Audio playback', 'Voice and listeners', 'Queue and playlists'],
    labels: ['Default volume', 'Audio bitrate', 'Crossfade', 'Radio when the queue is empty', 'Wait after the queue empties',
      'Leave when no listeners remain', 'Lower volume while people speak', 'Volume while people speak', 'Playlist limit', 'Tracks per queue page']},
  nb: {tab: 'Innstillinger', heading: 'Serverinnstillinger', save: 'Lagre innstillinger', saved: 'Innstillingene er lagret for Synthetic B.',
    mismatch: 'Serveren bekreftet ikke disse innstillingene. Last inn på nytt og kontroller før du prøver igjen.',
    introduction: 'Endringene gjelder bare Synthetic B.',
    groups: ['Lydavspilling', 'Talekanal og lyttere', 'Kø og spillelister'],
    labels: ['Standardvolum', 'Lydbithastighet', 'Kryssfade', 'Radio når køen er tom', 'Vent etter at køen er tom',
      'Forlat når ingen lyttere er igjen', 'Demp volumet mens noen snakker', 'Volum mens noen snakker', 'Spillelistegrense', 'Sanger per køside']},
};
const observed: {width: number; language: 'en' | 'nb'; retired: number; groups: number}[] = [];
try {
  for (const width of [1440, 390]) for (const language of ['en', 'nb'] as const) {
    const context = await browser.newContext({viewport: {width, height: 1000}, reducedMotion: 'reduce'});
    try {
      // English exercises a fresh session's default; Norwegian exercises an explicit saved choice.
      await context.addInitScript(language => {
        if (language === 'nb' && !localStorage.getItem('gutta-language')) localStorage.setItem('gutta-language', 'nb');
      }, language);
      const text = wording[language], otherLanguage = language === 'en' ? 'nb' : 'en';
      const guilds = [{id: '111111111111111', name: 'Synthetic A', installed: true, roomCode: 'ROOMAAAA'}, {id: '222222222222222', name: 'Synthetic B', installed: true, roomCode: 'ROOMBBBB'}];
      const initial = {playlistLimit: 50, defaultQueuePageSize: 10, defaultVolume: 60, audioBitrateKbps: 192, crossfade: 6,
        secondsToWaitAfterQueueEmpties: 300, leaveIfNoListeners: true, queueAddResponseEphemeral: true,
        autoAnnounceNextSong: false, turnDownVolumeWhenPeopleSpeak: false, turnDownVolumeWhenPeopleSpeakTarget: 30, radio: true};
      const saved = new Map(guilds.map(guild => [guild.id, {...initial, defaultVolume: guild.id === guilds[0].id ? 60 : 80}]));
      let denySave = false, mismatchAcknowledgment = false;
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
            if (mismatchAcknowledgment) return route.fulfill({json: {settings: saved.get(input.guildId)}});
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
      await page.getByRole('button', {name: text.tab, exact: true}).click();
      const form = page.locator('.settings-grid');
      await form.locator('input').first().waitFor();
      await page.screenshot({path: `outputs/admin-settings/${phase}-${language}-${width}.png`, fullPage: true, animations: 'disabled'});
      observed.push({width, language, retired: await form.locator('label').filter({hasText: /Private queue confirmation|Announce next track|Privat købekreftelse|Meld neste sang/}).count(), groups: await form.locator('fieldset').count()});
      if (phase === 'before') continue;
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      assert.equal(await page.locator('.guild-select select').inputValue(), guilds[1].id, 'Admin link preselects only an authorized guild');
      assert.equal(await form.locator('input').count(), 10);
      const checkLanguage = async (current: 'en' | 'nb') => {
        const expected = wording[current];
        await form.getByRole('heading', {name: expected.heading, exact: true}).waitFor();
        assert.deepEqual(await form.locator('legend').allTextContents(), expected.groups);
        assert.deepEqual(await form.locator('.setting-row strong').allTextContents(), expected.labels);
        assert((await form.locator(':scope > p').first().textContent())?.includes(expected.introduction));
        for (const label of expected.labels) assert.equal(await form.getByLabel(label, {exact: true}).count(), 1);
      };
      const switchLanguage = async (current: 'en' | 'nb') => {
        await page.getByRole('button', {name: current === 'en' ? 'English' : 'Bokmål', exact: true}).click();
        await checkLanguage(current);
      };
      await checkLanguage(language);
      const helpBefore = await form.locator('.setting-row small').allTextContents();
      const descriptionsBefore = await form.locator('fieldset > p').allTextContents();
      for (const [key, min, max] of [['defaultVolume', 0, 100], ['playlistLimit', 1, 1000], ['defaultQueuePageSize', 1, 30], ['audioBitrateKbps', 64, 384], ['crossfade', 0, 12], ['secondsToWaitAfterQueueEmpties', 0, 86400], ['turnDownVolumeWhenPeopleSpeakTarget', 0, 100]] as const) {
        const input = form.locator('#setting-' + key);
        assert.equal(await input.getAttribute('min'), String(min)); assert.equal(await input.getAttribute('max'), String(max));
        assert(await input.getAttribute('aria-describedby'), `${key}: units and range remain associated`);
      }
      const volume = form.locator('#setting-defaultVolume');
      assert.equal(await volume.inputValue(), '80');
      await volume.fill('44');
      await form.getByRole('button', {name: text.save, exact: true}).click();
      await form.getByRole('status').filter({hasText: text.saved}).waitFor();
      await switchLanguage(otherLanguage);
      assert.equal(await volume.inputValue(), '44', 'Switching language preserves the acknowledged values');
      assert.equal(await form.getByRole('status').textContent(), wording[otherLanguage].saved);
      const helpAfter = await form.locator('.setting-row small').allTextContents();
      assert.equal(helpAfter.length, 10);
      helpAfter.forEach((help, index) => assert(help.trim() && help !== helpBefore[index], 'Every field help text follows the chosen language'));
      (await form.locator('fieldset > p').allTextContents()).forEach((description, index) =>
        assert(description !== descriptionsBefore[index], 'Every group description follows the chosen language'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await page.screenshot({path: `outputs/admin-settings/${phase}-${language}-switched-${width}.png`, fullPage: true, animations: 'disabled'});
      await switchLanguage(language);
      assert.equal(saved.get(guilds[1].id)!.defaultVolume, 44); assert.equal(saved.get(guilds[0].id)!.defaultVolume, 60);
      assert.equal(Object.keys(writes[0].settings).length, 10, 'Only implemented controls are submitted');
      assert(!('queueAddResponseEphemeral' in writes[0].settings)); assert(!('autoAnnounceNextSong' in writes[0].settings));
      mismatchAcknowledgment = true;
      await volume.fill('46');
      await form.getByRole('button', {name: text.save, exact: true}).click();
      await form.getByRole('alert').filter({hasText: text.mismatch}).waitFor();
      await switchLanguage(otherLanguage);
      assert.equal(await form.getByRole('alert').textContent(), wording[otherLanguage].mismatch,
        'An existing settings error follows language changes');
      assert.equal(writes.length, 2, 'Changing the interface language cannot submit settings');
      await switchLanguage(language);
      assert.equal(await volume.inputValue(), '46', 'An unconfirmed save preserves its unsaved draft');
      assert.equal(saved.get(guilds[1].id)!.defaultVolume, 44);
      assert.equal(await form.getByRole('status').count(), 0, 'A mismatched acknowledgment cannot show success');
      mismatchAcknowledgment = false;
      denySave = true;
      await volume.fill('45');
      await form.getByRole('button', {name: text.save, exact: true}).click();
      await form.getByRole('alert').filter({hasText: 'Synthetic permission denied'}).waitFor();
      assert.equal(saved.get(guilds[1].id)!.defaultVolume, 44); assert.equal(await volume.inputValue(), '45');
      assert.equal(await form.getByRole('status').count(), 0, 'A rejected save cannot retain the saved confirmation');
      await page.waitForTimeout(5200);
      assert(await form.getByRole('alert').isVisible(), 'Background polls do not erase an unsaved-settings error');
      await page.locator('.guild-select select').selectOption(guilds[0].id);
      await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#setting-defaultVolume')?.value === '60');
      assert.equal(await form.getByRole('alert').count(), 0, 'Another guild must not inherit this draft or error');
      await page.goto(base + '/admin?guildId=999999999999999', {waitUntil: 'networkidle'});
      await page.getByRole('button', {name: text.tab, exact: true}).click();
      await form.locator('input').first().waitFor();
      assert.equal(await page.locator('.guild-select select').inputValue(), guilds[0].id,
        'An unauthorized deep link falls back to an authorized server');
      assert.deepEqual(errors, []);
    } finally {await context.close();}
  }
  console.log(JSON.stringify(observed));
  for (const row of observed) {assert.equal(row.retired, 0, `${row.width}px ${row.language}: retired no-op controls must be absent`); assert.equal(row.groups, 3, `${row.width}px ${row.language}: audio, voice and queue groups`);}
  console.log(`PASS admin settings: ${observed.length} layouts in English/Norwegian, live language changes, complete controls, acknowledged saves, errors and guild isolation`);
} finally {await browser.close();}
