// Native library journeys use synthetic API state, isolated browser storage and no media.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { Room, Video } from '../../../lib/types.ts';
import { CONCERT_CATALOG } from '../../../lib/concert-catalog.ts';
const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const code = 'LIBRARY1',
  token = 'b'.repeat(64),
  visitor = 'a'.repeat(32);
const video = (id: string, title: string): Video => ({
  id,
  title,
  artist: 'Synthetic artist',
  duration: 180,
  image: '',
  live: false,
  embeddable: true,
});
const favorite = video('favorite001', 'Saved favorite');
const initial = video('queued00001', 'Current queue track');
const imported = video('result00001', 'Playlist preview track');
const jobId = '12345678-1234-1234-1234-123456789abc',
  jobToken = 'j'.repeat(40);
async function fixture(width: number, denyLibrary = false) {
  let libraryFile = '';
  if (denyLibrary) {
    const manifest = JSON.parse(
      await readFile(
        new URL('../.svelte-kit/output/client/.vite/manifest.json', import.meta.url),
        'utf8',
      ),
    ) as Record<string, { src?: string; file: string }>;
    libraryFile =
      Object.values(manifest).find((entry) => entry.src === 'src/lib/library/MusicLibrary.svelte')
        ?.file ?? '';
    assert(libraryFile, 'Build the lazy library before running this regression');
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  const writes: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  let version = 1,
    processing = true;
  const queue = [initial];
  const snapshot = (): Room => ({
    code,
    name: 'Library evening',
    isOwner: true,
    isHost: true,
    isPublic: false,
    current: null,
    queue,
    history: [],
    playing: false,
    position: 0,
    version,
    serverTime: Date.now(),
    viewers: 1,
    expiresAt: Date.now() + 3600000,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ code, token, visitor, favorite }) => {
      localStorage.setItem('afterparty-visitor', visitor);
      localStorage.setItem(`afterparty-host:${code}`, token);
      localStorage.setItem(
        'afterparty-library-v1',
        JSON.stringify({ version: 1, evenings: [], favorites: [favorite] }),
      );
    },
    { code, token, visitor, favorite },
  );
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) {
      if (
        denyLibrary &&
        (url.pathname === `/${libraryFile}` || url.pathname.endsWith('/MusicLibrary.svelte'))
      )
        return route.abort();
      return route.continue();
    }
    const input = request.method() === 'POST' ? request.postDataJSON() : null;
    if (url.pathname === `/api/rooms/${code}`) {
      assert.equal(request.headers()['x-afterparty-visitor'], visitor);
      assert.equal(request.headers().authorization, `Bearer ${token}`);
      if (input) {
        assert.equal(input.action, 'add');
        assert.equal(input.version, version);
        writes.push(input);
        const recording = CONCERT_CATALOG.find((item) => item.videoId === input.videoId);
        const track =
          [favorite, imported].find((item) => item.id === input.videoId) ??
          (recording ? video(recording.videoId, recording.title) : undefined);
        assert(track);
        queue.push(track);
        version++;
        return route.fulfill({ json: { room: snapshot() } });
      }
      return route.fulfill({ json: snapshot() });
    }
    if (url.pathname === '/api/playlists') {
      jobs.push(input);
      if (input.action !== 'start') {
        assert.equal(input.id, jobId);
        assert.equal(input.token, jobToken);
      }
      if (input.action === 'start')
        assert.equal(input.url, 'https://www.youtube.com/playlist?list=PL1234567890123456789');
      const status = input.action === 'cancel' ? 'cancelled' : processing ? 'processing' : 'done';
      return route.fulfill({
        json: {
          id: jobId,
          ...(input.action === 'start' ? { token: jobToken } : {}),
          status,
          source: 'youtube',
          videos: status === 'done' ? [imported] : [],
          skipped: 0,
          limited: false,
          total: 1,
        },
      });
    }
    return route.fulfill({ json: { rooms: [] } });
  });
  await page.goto(`${origin}/v3?room=${code}`);
  await page.getByRole('heading', { name: 'Library evening', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Library & playlists', exact: true }).click();
  if (!denyLibrary)
    await page.getByRole('button', { name: 'Add Saved favorite to queue', exact: true }).waitFor();
  return {
    page,
    writes,
    jobs,
    errors,
    complete: () => {
      processing = false;
    },
    close: () => browser.close(),
  };
}
for (const width of [1440, 390])
  test(
    `saved favorites, evenings and playlist import at ${width}px`,
    { timeout: 30000 },
    async () => {
      const f = await fixture(width);
      try {
        await f.page.getByRole('heading', { name: 'Your collection', exact: true }).waitFor();
        await f.page
          .getByRole('button', { name: 'Add Saved favorite to queue', exact: true })
          .click();
        await f.page.waitForFunction(() => document.querySelector('.count')?.textContent === '2');
        assert.equal(f.writes.length, 1);
        await f.page.getByLabel('Name this evening', { exact: true }).fill('Keep this night');
        await f.page.getByRole('button', { name: 'Save current queue', exact: true }).click();
        const saved = await f.page.evaluate(() =>
          JSON.parse(localStorage.getItem('afterparty-library-v1')!),
        );
        assert.equal(saved.evenings[0].name, 'Keep this night');
        assert.deepEqual(
          saved.evenings[0].tracks.map((item: Video) => item.id),
          [initial.id, favorite.id],
        );
        assert.equal(saved.favorites[0].id, favorite.id);
        await f.page
          .getByLabel('Playlist link', { exact: true })
          .fill('https://www.youtube.com/playlist?list=PL1234567890123456789');
        await f.page.getByRole('button', { name: 'Load playlist', exact: true }).click();
        await f.page.getByText('Loading playlist…', { exact: true }).waitFor();
        assert.equal(f.writes.length, 1, 'metadata jobs must not automatically enqueue');
        f.complete();
        await f.page
          .getByRole('checkbox', { name: 'Playlist preview track Synthetic artist', exact: true })
          .check();
        await f.page.getByRole('button', { name: 'Add 1 selected to queue', exact: true }).click();
        await f.page.waitForFunction(() => document.querySelector('.count')?.textContent === '3');
        assert.equal(f.writes.length, 2);
        assert.equal(f.writes[1].videoId, imported.id);
        assert(f.jobs.some((job) => job.action === 'read'));
        assert.equal(
          await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
        );
        assert.deepEqual(f.errors, []);
      } finally {
        await f.close();
      }
    },
  );
test(
  'leaving a room cancels its active playlist job and stops queue additions',
  { timeout: 20000 },
  async () => {
    const f = await fixture(390);
    try {
      await f.page
        .getByLabel('Playlist link', { exact: true })
        .fill('https://www.youtube.com/playlist?list=PL1234567890123456789');
      await f.page.getByRole('button', { name: 'Load playlist', exact: true }).click();
      await f.page.getByText('Loading playlist…', { exact: true }).waitFor();
      await f.page.getByRole('button', { name: 'Leave room', exact: true }).click();
      await f.page.getByRole('heading', { name: 'Start something good', exact: true }).waitFor();
      await f.page.waitForTimeout(100);
      assert(f.jobs.some((job) => job.action === 'cancel'));
      assert.equal(f.writes.length, 0);
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);
test(
  'legacy duplicate entries remain readable and corrupt saved data is preserved',
  { timeout: 20000 },
  async () => {
    const f = await fixture(390);
    try {
      await f.page.evaluate(
        ({ favorite }) => {
          localStorage.setItem(
            'afterparty-library-v1',
            JSON.stringify({ version: 1, evenings: [], favorites: [favorite, favorite] }),
          );
          window.dispatchEvent(new StorageEvent('storage', { key: 'afterparty-library-v1' }));
        },
        { favorite },
      );
      assert.equal(
        await f.page
          .getByRole('button', { name: 'Add Saved favorite to queue', exact: true })
          .count(),
        2,
      );
      await f.page.evaluate(() => {
        localStorage.setItem('afterparty-library-v1', '{broken backup');
        window.dispatchEvent(new StorageEvent('storage', { key: 'afterparty-library-v1' }));
      });
      await f.page.locator('.local-library [role="alert"]').waitFor();
      assert.equal(
        await f.page.getByRole('button', { name: 'Save current queue', exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await f.page.evaluate(() => localStorage.getItem('afterparty-library-v1')),
        '{broken backup',
      );
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);
test(
  'festival event and year filters add official recordings through room authorization',
  { timeout: 20000 },
  async () => {
    const f = await fixture(390);
    try {
      const catalog = f.page.getByRole('region', { name: 'Festival concerts', exact: true });
      await catalog.getByLabel('Festival', { exact: true }).selectOption('edc-las-vegas');
      await catalog.getByLabel('Year', { exact: true }).selectOption('2025');
      const expected = CONCERT_CATALOG.filter(
        (entry) => entry.eventId === 'edc-las-vegas' && entry.year === 2025,
      );
      assert.equal(
        await catalog.getByRole('link', { name: 'Official video ↗', exact: true }).count(),
        expected.length,
      );
      for (let index = 0; index < expected.length; index++) {
        assert.equal(
          await catalog
            .getByRole('link', { name: 'Official video ↗', exact: true })
            .nth(index)
            .getAttribute('href'),
          `https://www.youtube.com/watch?v=${expected[index].videoId}`,
        );
      }
      await catalog
        .getByRole('button', { name: `Add festival set: ${expected[0].title}`, exact: true })
        .click();
      await f.page.waitForFunction(() => document.querySelector('.count')?.textContent === '2');
      assert.equal(f.writes[0].videoId, expected[0].videoId);
      await catalog
        .getByRole('button', { name: 'Add selected year to queue', exact: true })
        .click();
      await f.page.waitForFunction(() => document.querySelector('.count')?.textContent === '4');
      assert.deepEqual(
        f.writes.slice(1).map((write) => write.videoId),
        expected.map((entry) => entry.videoId),
      );
      assert.deepEqual(
        f.writes.map((write) => write.version),
        [1, 2, 3],
      );
      assert.equal(
        await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
      );
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);

test('a failed optional library download leaves the room usable and never changes its queue', async () => {
  const f = await fixture(390, true);
  try {
    await f.page.getByRole('alert').filter({ hasText: 'The library could not load.' }).waitFor();
    assert.equal(await f.page.getByRole('button', { name: 'Reload page', exact: true }).count(), 1);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.jobs, []);
    await f.page.getByRole('button', { name: 'Discover', exact: true }).click();
    await f.page.getByRole('button', { name: 'Find music', exact: true }).waitFor();
    assert.equal(
      await f.page.getByRole('heading', { name: 'Library evening', exact: true }).count(),
      1,
    );
    assert.equal(await f.page.getByRole('alert').count(), 0);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});
