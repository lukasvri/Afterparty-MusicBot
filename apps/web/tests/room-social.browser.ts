// Synthetic room state; no live Discord or provider requests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const code = 'TESTROOM';

for (const width of [1440, 390])
  test(`native room keeps the player and Games link without extras at ${width}px`, async (t) => {
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox'],
    });
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
    });
    page.setDefaultTimeout(12000);
    const errors: string[] = [];
    const socialRequests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const path = url.pathname;
      if (!path.startsWith('/api/')) return route.continue();
      if (path.startsWith('/api/social')) socialRequests.push(path);
      if (path === `/api/rooms/${code}`)
        return route.fulfill({
          json: {
            code,
            playbackKey: 'synthetic-playback',
            name: 'Synthetic music room',
            current: {
              id: 'synthetic01',
              title: 'Synthetic soundtrack',
              artist: 'Test artist',
              duration: 240,
              live: false,
              image: '',
              embeddable: true,
            },
            queue: [],
            playing: false,
            position: 32,
            version: 1,
            serverTime: Date.now(),
            viewers: 3,
            isHost: true,
            isOwner: true,
            expiresAt: Date.now() + 3600000,
          },
        });
      if (path === '/api/history' || path === '/api/videos')
        return route.fulfill({ json: { videos: [] } });
      return route.fulfill({ status: 503, json: { error: 'Synthetic unavailable endpoint' } });
    });

    await page.goto(`${origin}/?room=${code}`);
    await page.getByText('Synthetic soundtrack', { exact: true }).first().waitFor();
    const games = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', {
      name: 'Games',
      exact: true,
    });
    assert.equal(await games.getAttribute('href'), `/games?room=${code}`);
    assert.equal(await page.getByRole('link', { name: 'Play Guess the Song' }).count(), 0);
    assert.equal(await page.getByRole('region', { name: 'Games and extras' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Open extras' }).count(), 0);
    assert.deepEqual(socialRequests, []);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
  });
