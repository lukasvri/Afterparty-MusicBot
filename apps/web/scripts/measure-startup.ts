import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import type { Room } from '../../../lib/types.ts';

// Decode script responses from a built local Worker. Never benchmark live data.
const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
assert.equal(new URL(origin).protocol, 'http:');
const verify = process.argv.includes('--verify-lazy');
const manifest = JSON.parse(
  await readFile(
    new URL('../.svelte-kit/output/client/.vite/manifest.json', import.meta.url),
    'utf8',
  ),
) as Record<string, { file: string; src?: string; name?: string }>;
const library = Object.values(manifest).find(
  (entry) => entry.src === 'src/lib/library/MusicLibrary.svelte',
);
const scenery = Object.values(manifest).find(
  (entry) => entry.src === 'src/lib/ui/ConcertScenery.svelte',
);
if (verify) assert(library, 'Build must keep the optional library in its own chunk');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
const results: object[] = [];
try {
  for (const width of [1440, 390]) {
    for (const scenario of ['welcome', 'joined-room', 'playing-room', 'games']) {
      const joined = scenario === 'joined-room' || scenario === 'playing-room';
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: 'reduce',
      });
      const responses: Promise<{ url: string; bytes: number; gzipBytes: number }>[] = [];
      const failures: string[] = [];
      page.on('pageerror', (error) => failures.push(error.message));
      page.on('response', (response) => {
        if (response.request().resourceType() === 'script' && response.ok())
          responses.push(
            response.body().then((body) => ({
              url: new URL(response.url()).pathname,
              bytes: body.length,
              gzipBytes: gzipSync(body).length,
            })),
          );
      });
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        assert.equal(url.origin, origin, 'Startup must not contact providers before consent');
        if (!url.pathname.startsWith('/api/')) return route.continue();
        assert.equal(route.request().method(), 'GET', 'Measurement never changes a queue');
        if (url.pathname !== '/api/rooms/PERFROOM')
          return route.fulfill({ status: 404, json: { error: 'Unused synthetic endpoint' } });
        const snapshot: Room = {
          code: 'PERFROOM',
          name: 'Synthetic measurement room',
          current:
            scenario === 'playing-room'
              ? {
                  id: 'measure0001',
                  title: 'Synthetic playing track',
                  artist: 'Fixture',
                  duration: 180,
                  image: '',
                  live: false,
                  embeddable: true,
                }
              : null,
          queue: [],
          playing: scenario === 'playing-room',
          position: 0,
          version: 1,
          serverTime: Date.now(),
          viewers: 1,
          isHost: true,
          isOwner: true,
          isPublic: false,
          expiresAt: Date.now() + 3600000,
        };
        return route.fulfill({ json: snapshot });
      });
      await page.goto(
        scenario === 'games' ? `${origin}/games` : `${origin}/${joined ? '?room=PERFROOM' : ''}`,
      );
      if (scenario === 'games') {
        await page.getByRole('button', { name: 'Host a game', exact: true }).waitFor();
        await page.waitForFunction(
          () =>
            !(
              Array.from(document.querySelectorAll('button')).find((button) =>
                button.textContent?.includes('Host a game'),
              ) as HTMLButtonElement
            )?.disabled,
        );
      } else if (joined)
        await page
          .getByRole('heading', { name: 'Synthetic measurement room', exact: true })
          .waitFor();
      else
        await page
          .getByRole('button', { name: 'Create private room', exact: true })
          .isEnabled()
          .then(async (enabled) => {
            if (!enabled)
              await page.waitForFunction(
                () =>
                  !(document.querySelector('.room-forms button') as HTMLButtonElement)?.disabled,
              );
          });
      await page.waitForLoadState('networkidle');
      const initial = await Promise.all(responses);
      if (verify)
        assert(
          !initial.some((item) => item.url === `/${library!.file}`),
          'Library must not be downloaded on startup',
        );
      if (verify && scenario === 'playing-room') {
        assert(scenery, 'Decorative scenery must stay in its own optional chunk');
        assert(
          !initial.some((item) => item.url === `/${scenery.file}`),
          'Active rooms must not load decorative stage code',
        );
      }
      const unique = [...new Map(initial.map((item) => [item.url, item])).values()];
      results.push({
        viewport: width,
        scenario,
        scriptRequests: unique.length,
        decodedJavaScriptBytes: unique.reduce((sum, item) => sum + item.bytes, 0),
        sumIndividualGzipBytes: unique.reduce((sum, item) => sum + item.gzipBytes, 0),
      });
      if (verify && joined) {
        await page.getByRole('button', { name: 'Library & playlists', exact: true }).click();
        await page.getByRole('heading', { name: 'Festival concerts', exact: true }).waitFor();
        await page.waitForLoadState('networkidle');
        assert(
          (await Promise.all(responses)).some((item) => item.url === `/${library!.file}`),
          'Opening the library must load the feature successfully',
        );
      }
      assert.deepEqual(failures, []);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
process.stdout.write(
  JSON.stringify(
    {
      label: process.env.MEASUREMENT_LABEL ?? 'local-built-worker',
      metric:
        'Decoded successful script responses; gzip is recomputed per response, not measured wire transfer or field performance.',
      results,
    },
    null,
    2,
  ) + '\n',
);
