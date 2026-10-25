// Decorative stage checks use synthetic empty rooms and never request real media.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));

for (const [width, height] of [
  [3840, 2160],
  [2560, 1440],
  [1920, 1080],
  [390, 1000],
]) {
  test(
    `decorative DJ stage fits ${width}px and respects motion preferences`,
    { timeout: 30000 },
    async (t) => {
      const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_PATH,
        args: ['--no-sandbox'],
      });
      t.after(() => browser.close());
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      const errors: string[] = [];
      const writes: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (!['GET', 'HEAD'].includes(request.method())) writes.push(url.pathname);
        if (url.pathname === '/api/rooms/SCENERY1') {
          return route.fulfill({
            json: {
              code: 'SCENERY1',
              name: 'Synthetic empty stage',
              isOwner: true,
              isHost: true,
              isPublic: false,
              current: null,
              queue: [],
              history: [],
              playing: false,
              position: 0,
              version: 1,
              serverTime: Date.now(),
              viewers: 1,
              expiresAt: Date.now() + 3600000,
            },
          });
        }
        return route.fulfill({ json: { rooms: [] } });
      });
      for (const path of ['/', '/?room=SCENERY1']) {
        await page.goto(`${origin}${path}`);
        await page
          .getByRole('heading', {
            name: path === '/' ? 'afterparty.' : 'Synthetic empty stage',
            exact: true,
          })
          .waitFor();
        const scene = page.locator('.concert-scenery');
        await scene.waitFor();
        assert.equal(await scene.count(), 1);
        assert.equal(await scene.getAttribute('aria-hidden'), 'true');
        assert.equal(await scene.locator('a, button, input, [tabindex]').count(), 0);
        assert.equal(await scene.locator('svg').getAttribute('focusable'), 'false');
        const geometry = await scene.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return {
            width: box.width,
            height: box.height,
            left: box.left,
            right: box.right,
            pointerEvents: getComputedStyle(node).pointerEvents,
            foreignNodes: [...node.querySelectorAll('svg *')].filter(
              (child) => child.namespaceURI !== 'http://www.w3.org/2000/svg',
            ).length,
            running: node
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === 'running').length,
          };
        });
        assert(geometry.width > 0 && geometry.height > 0, 'the stage is visible');
        assert(geometry.left >= -1 && geometry.right <= width + 1, 'stage stays inside viewport');
        assert.equal(geometry.pointerEvents, 'none');
        assert.equal(geometry.foreignNodes, 0, 'snippets retain the SVG namespace');
        assert.equal(geometry.running, 0, 'system reduced motion stops stage animations');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => {
          document.documentElement.dataset.motion = 'off';
        });
        assert.equal(
          await scene.evaluate(
            (node) =>
              node
                .getAnimations({ subtree: true })
                .filter((animation) => animation.playState === 'running').length,
          ),
          0,
          'manual motion preference stops stage animations',
        );
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }
      assert.deepEqual(writes, [], 'decorative scenery causes no API mutations');
      assert.deepEqual(errors, []);
    },
  );
}
