// Real admin interactions with delayed synthetic APIs; no Discord or production data.
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as typeof import('playwright');
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:8787';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox']});
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const guilds = [{id: '111111111111111', name: 'Synthetic A', installed: true}, {id: '222222222222222', name: 'Synthetic B', installed: true}];
  let guildReads = 0, releaseGuilds: (() => void) | undefined, releaseChannels: (() => void) | undefined;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let data: unknown = {};
    if (url.pathname === '/api/admin/guilds') {
      guildReads++;
      if (guildReads > 1) await new Promise<void>(resolve => {releaseGuilds = resolve;});
      data = {authenticated: true, globalAdmin: false, guilds: guildReads > 1 ? [guilds[1]] : guilds, invite: 'https://example.test/install'};
    } else if (url.pathname === '/api/admin/control') {
      if (route.request().method() === 'POST') {
        const input: {operation: string; guildId: string} = route.request().postDataJSON();
        assert.equal(input.operation, 'channels');
        assert(guilds.some(guild => guild.id === input.guildId));
        if (input.guildId === guilds[0].id) await new Promise<void>(resolve => {releaseChannels = resolve;});
        data = {channels: [{id: input.guildId + '0', name: input.guildId === guilds[0].id ? 'A private voice' : 'B voice', voice: true}]};
      } else {
        const guildId = url.searchParams.get('guildId');
        data = {guildId, state: {ready: true, connected: false, playing: false, current: null, queue: [], position: 0, volume: 60},
          settings: {}, player: {}, snapshots: [], commands: [], sleepTimerEndsAt: null};
      }
    } else if (route.request().method() !== 'GET') throw Error('Unexpected mutation');
    await route.fulfill({json: data});
  });
  await page.goto(base + '/admin');
  await page.getByRole('button', {name: 'Tools', exact: true}).click();
  // Refreshing membership does not block other controls. A removed server can
  // therefore be replaced while its channel request is still pending.
  await page.getByRole('button', {name: 'Refresh servers', exact: true}).click();
  const load = page.getByRole('button', {name: 'Load channels', exact: true});
  await load.click();
  for (let attempt = 0; !(releaseGuilds && releaseChannels) && attempt < 250; attempt++) await page.waitForTimeout(20);
  assert(releaseGuilds && releaseChannels, 'Both requests must be pending');
  releaseGuilds();
  await page.waitForFunction(() => (document.querySelector('.guild-select select') as unknown as HTMLSelectElement | null)?.value === '222222222222222');
  releaseChannels();
  await page.waitForFunction(() => !(document.querySelector('.guild-select select') as unknown as HTMLSelectElement | null)?.disabled);
  const channels = page.getByRole('combobox', {name: 'Choose channel', exact: true});
  assert.deepEqual(await channels.locator('option').allTextContents(), ['Choose channel'], 'A channels must not appear under B');
  await load.click();
  await channels.locator('option').filter({hasText: 'B voice'}).waitFor({state: 'attached'});
  assert.deepEqual(await channels.locator('option').allTextContents(), ['Choose channel', '🔊 B voice'], 'Current server channels still load');
  assert.deepEqual(errors, []);
  console.log('PASS admin channel results remain scoped when a membership refresh changes the selected server');
} finally {await browser.close();}
