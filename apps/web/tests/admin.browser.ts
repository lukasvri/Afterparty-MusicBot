// Synthetic administration journeys. No Discord, provider or live Core requests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const first = '111111111111111111',
  second = '222222222222222222';
const defaults = {
  defaultVolume: 60,
  audioBitrateKbps: 192,
  crossfade: 0,
  radio: false,
  secondsToWaitAfterQueueEmpties: 60,
  leaveIfNoListeners: true,
  turnDownVolumeWhenPeopleSpeak: false,
  turnDownVolumeWhenPeopleSpeakTarget: 20,
  playlistLimit: 100,
  defaultQueuePageSize: 10,
};
for (const width of [3840, 2560, 1920, 1440, 390])
  test(`native admin scopes settings and command confirmation at ${width}px`, async () => {
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
    });
    const errors: string[] = [],
      external: string[] = [],
      writes: Array<Record<string, unknown>> = [];
    const saved: Record<string, Record<string, number | boolean>> = {
      [first]: { ...defaults },
      [second]: { ...defaults },
    };
    let revision = 7,
      job: { id: string; status: string; payload: { action: string } } | undefined;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        external.push(url.href);
        return route.abort();
      }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      let body: unknown;
      if (url.pathname === '/api/admin/guilds')
        body = {
          authenticated: true,
          globalAdmin: false,
          guilds: [
            { id: first, name: 'First synthetic server', roomCode: 'FIRSTONE', installed: true },
            { id: second, name: 'Second synthetic server', roomCode: 'SECONDON', installed: true },
          ],
          invite: '',
        };
      else if (url.pathname === '/api/admin/control' && route.request().method() === 'GET') {
        const id = url.searchParams.get('guildId')!;
        body = {
          guildId: id,
          roomCode: 'TESTROOM',
          state: {
            guildId: id,
            ready: true,
            online: true,
            connected: true,
            playing: false,
            position: 15,
            volume: 60,
            current: {
              id: 'test-current',
              title: id === first ? 'First server soundtrack' : 'Second server soundtrack',
              artist: 'Synthetic artist',
              duration: 180,
              live: false,
              image: '',
              embeddable: true,
            },
            queue: [],
            queueRevision: `revision-${revision}`,
            playbackKey: `synthetic-${id}`,
            lastSeen: Date.now(),
          },
          settings: saved[id],
          player: {
            loopCurrentSong: false,
            loopCurrentQueue: false,
            bitrate: 192000,
            radioProvider: 'artist',
          },
          snapshots: [],
          commands: job ? [{ ...job, status: 'done' }] : [],
          sleepTimerEndsAt: null,
        };
      } else if (url.pathname === '/api/admin/control') {
        const input = route.request().postDataJSON() as Record<string, unknown>;
        writes.push(input);
        assert([first, second].includes(String(input.guildId)));
        if (input.operation === 'settings') {
          saved[String(input.guildId)] = {
            ...saved[String(input.guildId)],
            ...(input.settings as Record<string, number | boolean>),
          };
          body = { settings: saved[String(input.guildId)] };
        } else if (input.operation === 'command') {
          const command = input.command as { action: string; queueRevision: string };
          assert.equal(command.queueRevision, `revision-${revision}`);
          revision++;
          job = { id: String(input.commandId), status: 'processing', payload: command };
          body = job;
        } else body = {};
      } else return route.fulfill({ status: 404, json: { error: 'Unknown synthetic request' } });
      return route.fulfill({ status: 200, json: body });
    });
    try {
      await page.goto(`${origin}/admin`);
      await page.getByRole('heading', { name: 'First server soundtrack' }).waitFor();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('group', { name: 'Audio playback' }).waitFor();
      await page.getByLabel('Default volume', { exact: true }).fill('75');
      await page.getByRole('button', { name: 'Save server settings' }).click();
      await page
        .getByRole('status')
        .filter({ hasText: 'Settings saved for this server.' })
        .waitFor();
      const settingsWrite = writes.find((write) => write.operation === 'settings')!;
      assert.equal(settingsWrite.guildId, first);
      assert.equal((settingsWrite.settings as Record<string, unknown>).defaultVolume, 75);
      assert.deepEqual(
        Object.keys(settingsWrite.settings as object).sort(),
        Object.keys(defaults).sort(),
      );
      await page.getByLabel('Discord server', { exact: true }).selectOption(second);
      await page.waitForFunction(
        () =>
          (document.querySelector('#setting-defaultVolume') as HTMLInputElement)?.value === '60',
      );
      await page.getByRole('button', { name: 'Player and queue' }).click();
      await page.getByRole('heading', { name: 'Second server soundtrack' }).waitFor();
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Action confirmed.' }).waitFor();
      assert.equal(writes.filter((write) => write.operation === 'command').length, 1);
      assert.equal(writes.at(-1)?.guildId, second);
      assert.equal((writes.at(-1)?.command as Record<string, unknown>).action, 'resume');
      const dj = page.getByRole('region', { name: 'DJ desk', exact: true });
      await dj.getByRole('slider', { name: 'Crossfade', exact: true }).fill('9');
      if (width === 390) {
        await page.waitForTimeout(5200);
        assert.equal(
          await dj.getByRole('slider', { name: 'Crossfade', exact: true }).inputValue(),
          '9',
          'server polling preserves a DJ draft',
        );
      }
      const settingsCount = writes.filter((write) => write.operation === 'settings').length;
      assert.equal(settingsCount, 1, 'editing the DJ transition does not write until Apply');
      await dj.getByRole('button', { name: 'Apply DJ settings', exact: true }).click();
      await page
        .getByRole('status')
        .filter({ hasText: 'Settings saved for this server.' })
        .waitFor();
      const djWrite = writes.filter((write) => write.operation === 'settings').at(-1)!;
      assert.deepEqual(djWrite.settings, { crossfade: 9 });
      assert.equal(djWrite.guildId, second);
      assert.equal(saved[second].defaultVolume, 60, 'DJ changes preserve unrelated settings');
      assert.equal(saved[first].crossfade, 0, 'the other server is unchanged');
      await dj.getByRole('button', { name: 'Mark cue here', exact: true }).click();
      assert.equal(
        await dj.getByRole('button', { name: 'Return to cue · 0:15', exact: true }).isEnabled(),
        true,
      );
      await dj.getByRole('button', { name: /^50%/ }).click();
      await page.getByRole('status').filter({ hasText: 'Action confirmed.' }).waitFor();
      assert.equal((writes.at(-1)?.command as Record<string, unknown>).action, 'seek');
      assert.equal((writes.at(-1)?.command as Record<string, unknown>).seconds, 90);
      await page.getByLabel('Discord server', { exact: true }).selectOption(first);
      await page.getByRole('heading', { name: 'First server soundtrack', exact: true }).waitFor();
      assert.equal(
        await dj.getByRole('button', { name: 'Return to cue', exact: true }).isDisabled(),
        true,
        'changing server clears the marked cue',
      );
      assert.equal(await page.getByRole('button', { name: 'Browser rooms' }).count(), 0);
      assert.equal(await page.getByRole('link', { name: 'Update bot and website' }).count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      await page.screenshot({ path: `/tmp/v3-admin-${width}.png`, fullPage: true });
    } finally {
      await browser.close();
    }
  });
test('native admin sign-in view exposes OAuth without reading private server state', async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const calls: string[] = [];
  await page.route('**/api/**', (route) => {
    calls.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      json: { authenticated: false, globalAdmin: false, guilds: [], invite: '' },
    });
  });
  try {
    await page.goto(`${origin}/admin`);
    const signIn = page.getByRole('link', { name: 'Sign in with Discord' });
    await signIn.waitFor();
    assert.equal(await signIn.getAttribute('href'), '/api/auth/discord');
    assert.deepEqual(calls, ['/api/admin/guilds']);
    assert.equal(await page.getByRole('button', { name: 'Save server settings' }).count(), 0);
  } finally {
    await browser.close();
  }
});
