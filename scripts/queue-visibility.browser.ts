// Exercise the built browser UI with synthetic room data and no external media.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Room, Video } from '../lib/types.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as typeof import('playwright');
const base = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:8787').origin;
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
const track = (index: number): Video => ({ id: 'queue' + String(index).padStart(6, '0'), entryId: 'entry-' + index,
  title: `Synthetic queued song ${index}`, artist: 'Synthetic artist', image, duration: 180, live: false, embeddable: true, concert: true });

for (const mode of ['room', 'discord']) for (const width of [390, 1655]) for (const isHost of [true, false]) for (const socialFilter of [false, true]) {
  test(`${mode} queue at ${width}px for ${isHost ? 'host' : 'guest'} with social filter ${socialFilter} renders all three upcoming songs`, async () => {
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox']});
    try {
      const page = await browser.newPage({viewport: {width, height: 1100}});
      await page.addInitScript(() => localStorage.setItem('gutta-language', 'en'));
      const room = (): Room => ({ code: 'VISIBLE1', name: 'Synthetic queue', current: track(0), queue: [track(1), track(2), track(3)],
        playing: false, position: 17, version: 1, serverTime: Date.now(), viewers: 1, isHost: mode === 'room' && isHost, radio: true, requests: [track(4)], expiresAt: Date.now() + 60000,
        ...(mode === 'discord' ? {mode: 'discord', guildId: '111111111111111', discordOnline: true, playbackKey: 'synthetic-core:current'} : {}) });
      await page.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== base) return route.abort();
        if (!u.pathname.startsWith('/api/')) return route.continue();
        if (u.pathname.includes('realtime')) return route.abort();
        const data = u.pathname === '/api/rooms/VISIBLE1' ? room()
          : u.pathname === '/api/discord/queue' ? {state: {revision: '1', queue: room().queue, requests: room().requests, approvalRequired: false, voteCounts: {}, skipVotes: 0}, canManage: isHost}
          : u.pathname === '/api/rooms' ? {rooms: []} : u.pathname === '/api/discord' ? {state: mode === 'discord'
            ? {...room(), ready: true, connected: true, online: true, queueRevision: '1', volume: 60, lastSeen: Date.now()} : null} : {videos: []};
        return route.fulfill({json: data});
      });
      await page.goto(base + '/?room=VISIBLE1');
      await page.locator('#queue-tab .tab-count').filter({hasText: /^3$/}).waitFor();
      // Fanboy Social's generic cosmetic rule, also used by browser content blockers.
      // https://github.com/easylist/easylist/blob/master/fanboy-addon/fanboy_social_general_hide.txt
      if (socialFilter) await page.addStyleTag({content: '.social-track { display: none !important; }'});
      assert.equal(await page.locator('#queue-content .queue-current strong').textContent(), track(0).title);
      assert.equal(await page.locator('#queue-content .social-queue > .afterparty-queue-track').count(), 3, 'badge and rendered upcoming rows must agree');
      for (let i = 1; i <= 3; i++) {
        const row = page.locator('#queue-content .afterparty-queue-track').filter({hasText: track(i).title});
        assert(await row.isVisible(), `upcoming song ${i} must be visible`);
        await row.scrollIntoViewIfNeeded();
        assert(await row.locator('strong').evaluate(el => {
          const box = el.getBoundingClientRect(), clip = el.closest('.queue-content')!.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.left >= clip.left && box.right <= clip.right + 1 && box.top >= clip.top && box.bottom <= clip.bottom + 1;
        }), `upcoming song ${i} title must be inside the scroll viewport`);
      }
      assert.equal(await page.locator('#queue-content .queue-current').count(), 1);
      assert.equal(await page.locator('#queue-content .afterparty-queue-track button[aria-label^="Remove"]').count(), isHost ? 3 : 0);
      const requested = page.locator('#queue-content .afterparty-queue-track').filter({hasText: track(4).title});
      assert(await requested.isVisible(), 'pending requests must survive the same cosmetic filter');
      await requested.scrollIntoViewIfNeeded();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.QUEUE_VISIBILITY_SHOTS) await page.locator('.library-panel').screenshot({path: `${process.env.QUEUE_VISIBILITY_SHOTS}-${mode}-${width}-${isHost ? 'host' : 'guest'}-${socialFilter}.png`});
      await page.locator('.video-settings > summary').click();
      const nickname = page.locator('.display-name input'), tv = page.locator('.tv-mode-button');
      await nickname.waitFor(); await tv.waitFor();
      for (const control of [nickname, tv]) {
        const colors = await control.evaluate(el => {const style = getComputedStyle(el);return [style.backgroundColor, style.borderTopColor];});
        for (const color of colors) {
          const [red, green, blue] = color.match(/[\d.]+/g)!.map(Number);
          assert(Math.max(red, green, blue) - Math.min(red, green, blue) <= 8, `${color} should be a neutral surface or border`);
        }
      }
      if (process.env.QUEUE_VISIBILITY_SHOTS) await page.locator('.video-settings').screenshot({path: `${process.env.QUEUE_VISIBILITY_SHOTS}-settings-${mode}-${width}-${isHost ? 'host' : 'guest'}-${socialFilter}.png`});
    } finally { await browser.close(); }
  });
}
