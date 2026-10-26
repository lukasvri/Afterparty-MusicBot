// Decorative stage checks use synthetic empty rooms and never request real media.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
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
            name: path === '/' ? 'Music' : 'Synthetic empty stage',
            exact: true,
          })
          .waitFor();
        const scene = page.locator('.concert-scenery');
        await scene.waitFor();
        assert.equal(await scene.count(), 1);
        assert.equal(await scene.getAttribute('aria-hidden'), path === '/' ? 'true' : null);
        assert.equal(
          await scene.locator('svg a, svg button, svg input, svg [tabindex]').count(),
          0,
        );
        assert.equal(
          await scene.getByRole('button', { name: 'Choose a song', exact: true }).count(),
          path === '/' ? 0 : 1,
        );
        assert.equal(await scene.locator(':scope > svg').getAttribute('focusable'), 'false');
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
        if (path !== '/') {
          const card = await page.locator('.empty-stage').boundingBox();
          const action = await scene
            .getByRole('button', { name: 'Choose a song', exact: true })
            .boundingBox();
          assert(
            card && card.height <= Math.max(240, height - 300) + 1,
            'stage stays within a bounded viewport height',
          );
          assert(
            card && geometry.width >= card.width * 0.9,
            'DJ scene fills the player instead of a fixed-size island',
          );
          assert(action && action.height >= 44, 'integrated action retains a touch target');
          assert(
            action &&
              action.x >= geometry.left &&
              action.x + action.width <= geometry.right &&
              action.y >= (await scene.boundingBox())!.y &&
              action.y + action.height <= (await scene.boundingBox())!.y + geometry.height,
            'first-song action fits inside the stage',
          );
        }

        assert.equal(geometry.running, 0, 'system reduced motion stops stage animations');
        assert.match(
          await page.getByRole('button', { name: 'Page animations', exact: true }).innerText(),
          /Reduced motion/,
        );
        if (path === '/') {
          const welcome = await page.locator('.welcome').boundingBox();
          assert(
            welcome && welcome.width >= width * 0.75,
            'welcome uses the available screen width',
          );
          if (width >= 1920) {
            const create = await page
              .getByRole('button', { name: 'Create private room', exact: true })
              .boundingBox();
            const join = await page
              .getByRole('button', { name: 'Join room', exact: true })
              .boundingBox();
            assert(
              create &&
                join &&
                create.y + create.height <= height &&
                join.y + join.height <= height,
              'desktop room actions remain in the first viewport',
            );
          }
        }
        assert(
          await scene.locator('.deck-controls').evaluateAll((decks) =>
            decks.every((deck) => {
              const screen = deck.querySelector('.deck-screen')!.getBoundingClientRect();
              const jog = deck.querySelector('.jog-wheel')!.getBoundingClientRect();
              return screen.y + screen.height / 2 > jog.y + jog.height / 2;
            }),
          ),
          'CDJ jog wheels face the DJ; screens are on their audience-facing edge',
        );

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
        await page.evaluate(() => {
          document.documentElement.dataset.motion = 'on';
        });
        await scene.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => {
          const venue = document.querySelector('.concert-scenery');
          return (
            venue &&
            ['.light-beam', '.laser-fan', '.stage-orbit'].every((selector) =>
              [...venue.querySelectorAll(selector)].every((node) =>
                node.getAnimations().some((animation) => animation.playState === 'running'),
              ),
            )
          );
        });
        const transforms = await scene.evaluate((node) =>
          ['.light-beam', '.laser-fan', '.stage-orbit'].map(
            (selector) => getComputedStyle(node.querySelector(selector)!).transform,
          ),
        );
        await page.waitForFunction(
          (before) =>
            ['.light-beam', '.laser-fan', '.stage-orbit'].every(
              (selector, index) =>
                getComputedStyle(document.querySelector(`.concert-scenery ${selector}`)!)
                  .transform !== before[index],
            ),
          transforms,
        );
        const hardware = await scene.evaluate((node) => {
          const frame = node.getBoundingClientRect();
          return [...node.querySelectorAll('.dj-deck, .dj-mixer, .performer-head')].map((part) => {
            const box = part.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.height > 0 &&
              box.left >= frame.left &&
              box.right <= frame.right &&
              box.top >= frame.top &&
              box.bottom <= frame.bottom
            );
          });
        });
        assert.equal(hardware.length, 4);
        assert(hardware.every(Boolean), 'both CDJs, mixer and DJ head remain inside the scene');
        await page.screenshot({
          path: `/tmp/afterparty-stage-${width}-${path === '/' ? 'welcome' : 'room'}.png`,
          fullPage: true,
        });
        const motion = page.getByRole('button', { name: 'Page animations', exact: true });
        await motion.click();
        await page.waitForFunction(() => document.documentElement.dataset.motion === 'off');
        assert.equal(
          await scene.evaluate((node) => node.getAnimations({ subtree: true }).length),
          0,
        );
        await motion.click();
        await page.waitForFunction(() => document.documentElement.dataset.motion === 'on');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }
      await page.getByRole('button', { name: 'Choose a song', exact: true }).click();
      assert(
        await page
          .getByRole('textbox', { name: 'Search songs or artists' })
          .evaluate((node) => node === document.activeElement),
      );
      if (width === 390) {
        const manifest = JSON.parse(
          await readFile(
            new URL('../.svelte-kit/output/client/.vite/manifest.json', import.meta.url),
            'utf8',
          ),
        ) as Record<string, { src?: string; file: string }>;
        const chunk = Object.values(manifest).find(
          (entry) => entry.src === 'src/lib/ui/ConcertScenery.svelte',
        );
        assert(chunk);
        await page.route(`**/${chunk.file}`, (route) => route.abort());
        await page.reload();
        await page.getByRole('button', { name: 'Choose a song', exact: true }).click();
        assert(
          await page
            .getByRole('textbox', { name: 'Search songs or artists' })
            .evaluate((node) => node === document.activeElement),
          'first-song action survives failed optional artwork',
        );
      }
      assert.deepEqual(writes, [], 'decorative scenery causes no API mutations');
      assert.deepEqual(errors, []);
    },
  );
}
