// Native library journeys use synthetic API state, isolated browser storage and no media.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { Room, Video } from '../../../lib/types.ts';
import { CONCERT_CATALOG, CONCERT_PLAYLISTS } from '../../../lib/concert-catalog.ts';
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
async function fixture(
  width: number,
  denyLibrary = false,
  queued = 1,
  preview = [imported],
  playlistUrl = 'https://www.youtube.com/playlist?list=PL1234567890123456789',
) {
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
    processing = true,
    failNextRead = false,
    failAddition: number | null = null;
  const queue = [
    initial,
    ...Array.from({ length: queued - 1 }, (_, index) =>
      video(`filler${String(index).padStart(5, '0')}`, `Queued filler ${index}`),
    ),
  ];
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
        if (writes.length === failAddition) {
          failAddition = null;
          return route.fulfill({ status: 503, json: { error: 'Temporary add failure.' } });
        }
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
      if (input.action === 'read' && failNextRead) {
        failNextRead = false;
        return route.fulfill({ status: 503, json: { error: 'Temporary connection failure.' } });
      }
      if (input.action !== 'start') {
        assert.equal(input.id, jobId);
        assert.equal(input.token, jobToken);
      }
      if (input.action === 'start') assert.equal(input.url, playlistUrl);
      const status = input.action === 'cancel' ? 'cancelled' : processing ? 'processing' : 'done';
      return route.fulfill({
        json: {
          id: jobId,
          ...(input.action === 'start' ? { token: jobToken } : {}),
          status,
          source: 'youtube',
          videos: status === 'done' ? preview : [],
          skipped: 0,
          limited: false,
          total: preview.length,
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
    failAdd: (attempt: number) => {
      failAddition = attempt;
    },
    failRead: () => {
      failNextRead = true;
    },
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
test('changing music tools keeps the existing playlist preview instead of cancelling or restarting it', async () => {
  const f = await fixture(390);
  try {
    await f.page
      .getByLabel('Playlist link', { exact: true })
      .fill('https://www.youtube.com/playlist?list=PL1234567890123456789');
    await f.page.getByRole('button', { name: 'Load playlist', exact: true }).click();
    await f.page.getByText('Loading playlist…', { exact: true }).waitFor();
    await f.page.getByRole('button', { name: 'Search', exact: true }).click();
    await f.page.getByText('Room settings', { exact: true }).click();
    await f.page.getByLabel('Your display name', { exact: true }).fill('Music host');
    f.complete();
    await f.page.getByRole('button', { name: 'Library & playlists', exact: true }).click();
    const preview = f.page.getByRole('checkbox', {
      name: 'Playlist preview track Synthetic artist',
      exact: true,
    });
    await preview.check();
    await f.page.getByRole('button', { name: 'Search', exact: true }).click();
    await f.page.getByRole('button', { name: 'Library & playlists', exact: true }).click();
    assert.equal(
      await preview.isChecked(),
      true,
      'selection survives closing and reopening the tools',
    );
    assert.equal(f.jobs.filter((job) => job.action === 'start').length, 1);
    assert.equal(f.jobs.filter((job) => job.action === 'cancel').length, 0);
    assert.equal(f.writes.length, 0);
    await f.page.getByRole('button', { name: 'Add 1 selected to queue', exact: true }).click();
    await f.page.waitForFunction(() => document.querySelector('.count')?.textContent === '2');
    assert.equal(f.writes[0].videoId, imported.id);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

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
      await catalog.getByLabel('Year', { exact: true }).selectOption('2023');
      const expected = CONCERT_CATALOG.filter(
        (entry) => entry.eventId === 'edc-las-vegas' && entry.year === 2023,
      );
      assert.equal(
        await catalog.getByRole('link', { name: 'Official video ↗', exact: true }).count(),
        20,
      );
      for (let index = 0; index < 20; index++) {
        assert.equal(
          await catalog
            .getByRole('link', { name: 'Official video ↗', exact: true })
            .nth(index)
            .getAttribute('href'),
          `https://www.youtube.com/watch?v=${expected[index].videoId}`,
        );
      }
      await catalog.getByRole('button', { name: 'Next sets', exact: true }).click();
      assert.equal(
        await catalog.getByRole('link', { name: 'Official video ↗', exact: true }).count(),
        6,
      );
      assert.equal(
        await catalog
          .getByRole('link', { name: 'Official video ↗', exact: true })
          .last()
          .getAttribute('href'),
        `https://www.youtube.com/watch?v=${expected.at(-1)!.videoId}`,
      );
      await catalog.getByRole('button', { name: 'Previous sets', exact: true }).click();
      await catalog
        .getByRole('button', { name: `Add festival set: ${expected[0].title}`, exact: true })
        .click();
      await f.page.waitForFunction(() => document.querySelector('.count')?.textContent === '2');
      assert.equal(f.writes[0].videoId, expected[0].videoId);
      await catalog
        .getByRole('button', { name: 'Add selected year to queue', exact: true })
        .click();
      await f.page.waitForFunction(() => document.querySelector('.count')?.textContent === '27');
      assert.deepEqual(
        f.writes.slice(1).map((write) => write.videoId),
        expected.slice(1).map((entry) => entry.videoId),
      );
      assert.deepEqual(
        f.writes.map((write) => write.version),
        Array.from({ length: expected.length }, (_, index) => index + 1),
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
    await f.page.getByRole('button', { name: 'Search', exact: true }).click();
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

test(
  'catalog and favorites stop before a full queue would create a partial import',
  { timeout: 20000 },
  async () => {
    const f = await fixture(390, false, 49);
    try {
      await f.page.getByText('1 queue spaces available.', { exact: true }).waitFor();
      const catalog = f.page.getByRole('region', { name: 'Festival concerts', exact: true });
      assert.equal(
        await catalog
          .getByRole('button', { name: 'Add selected year to queue', exact: true })
          .isDisabled(),
        true,
      );
      await catalog
        .getByText(/The selected year has .* new sets, but the queue has room for 1/)
        .waitFor();
      assert.equal(f.writes.length, 0);
      await f.page
        .getByRole('button', { name: 'Add Saved favorite to queue', exact: true })
        .click();
      await f.page
        .getByText('The queue is full. Make room before adding tracks.', { exact: true })
        .first()
        .waitFor();
      assert.equal(
        await f.page
          .getByRole('button', { name: 'Add Saved favorite to queue', exact: true })
          .isDisabled(),
        true,
      );
      const buttons = catalog.getByRole('button', { name: /^Add festival set:/ });
      for (let index = 0; index < (await buttons.count()); index++)
        assert.equal(await buttons.nth(index).isDisabled(), true);
      assert.equal(f.writes.length, 1);
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);

test(
  'playlist previews recover after a temporary polling failure without a second import job',
  { timeout: 20000 },
  async () => {
    const f = await fixture(390);
    try {
      f.failRead();
      await f.page
        .getByLabel('Playlist link', { exact: true })
        .fill('https://www.youtube.com/playlist?list=PL1234567890123456789');
      await f.page.getByRole('button', { name: 'Load playlist', exact: true }).click();
      await f.page
        .getByText('Connection interrupted. Retrying playlist loading…', { exact: true })
        .waitFor();
      assert.equal(f.jobs.filter((job) => job.action === 'start').length, 1);
      assert.equal(f.jobs.filter((job) => job.action === 'cancel').length, 0);
      assert.equal(f.writes.length, 0);
      f.complete();
      await f.page
        .getByRole('checkbox', { name: 'Playlist preview track Synthetic artist', exact: true })
        .waitFor();
      assert.equal(
        await f.page
          .getByText('Connection interrupted. Retrying playlist loading…', { exact: true })
          .count(),
        0,
      );
      assert.equal(f.jobs.filter((job) => job.action === 'start').length, 1);
      assert.equal(f.writes.length, 0);
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);

test(
  'a partial playlist addition keeps only unqueued tracks selected for an explicit retry',
  { timeout: 20000 },
  async () => {
    const f = await fixture(390, false, 48, [initial, favorite, imported]);
    try {
      f.complete();
      f.failAdd(2);
      await f.page
        .getByLabel('Playlist link', { exact: true })
        .fill('https://www.youtube.com/playlist?list=PL1234567890123456789');
      await f.page.getByRole('button', { name: 'Load playlist', exact: true }).click();
      const preview = f.page.getByRole('region', { name: 'Import a playlist', exact: true });
      const queued = preview.getByRole('checkbox', { name: /Current queue track/ });
      await queued.waitFor();
      assert.equal(await queued.isDisabled(), true);
      await preview.getByRole('button', { name: 'Select first 2', exact: true }).click();
      await preview.getByRole('button', { name: 'Add 2 selected to queue', exact: true }).click();
      await preview.getByRole('alert').filter({ hasText: 'Temporary add failure.' }).waitFor();
      await f.page.waitForFunction(() => document.querySelector('.count')?.textContent === '49');
      const retry = preview.getByRole('button', { name: 'Add 1 selected to queue', exact: true });
      assert.equal(await retry.isEnabled(), true);
      assert.deepEqual(
        f.writes.map((write) => write.videoId),
        [favorite.id, imported.id],
      );
      await retry.click();
      await f.page.waitForFunction(() => document.querySelector('.count')?.textContent === '50');
      assert.deepEqual(
        f.writes.map((write) => write.videoId),
        [favorite.id, imported.id, imported.id],
      );
      assert.equal(f.jobs.filter((job) => job.action === 'start').length, 1);
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);

test(
  'festival source previews reuse playlist import without changing the active queue',
  { timeout: 20000 },
  async () => {
    const source = CONCERT_PLAYLISTS.find((item) => item.year === 2026)!;
    const f = await fixture(390, false, 1, [imported], source.url);
    try {
      const catalog = f.page.getByRole('region', { name: 'Festival concerts', exact: true });
      await catalog.getByLabel('Festival', { exact: true }).selectOption(source.eventId);
      await catalog.getByLabel('Year', { exact: true }).selectOption(String(source.year));
      await catalog
        .getByText(
          'A curated selection of official uploads. The complete source archive has not been verified.',
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await catalog
          .getByRole('link', { name: 'Open source playlist ↗', exact: true })
          .getAttribute('href'),
        source.url,
      );
      assert.equal(f.jobs.length, 0);
      await catalog.getByRole('button', { name: 'Preview source playlist', exact: true }).click();
      assert.equal(
        await f.page.getByLabel('Playlist link', { exact: true }).inputValue(),
        source.url,
      );
      await f.page.getByText('Loading playlist…', { exact: true }).waitFor();
      assert.equal(f.writes.length, 0);
      f.complete();
      await f.page
        .getByRole('checkbox', { name: 'Playlist preview track Synthetic artist', exact: true })
        .waitFor();
      assert.equal(f.jobs.filter((job) => job.action === 'start').length, 1);
      assert.equal(f.writes.length, 0);
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);

test(
  'large festival catalogs support artist and stage filtering with bounded pages',
  { timeout: 20000 },
  async () => {
    const f = await fixture(390);
    try {
      const catalog = f.page.getByRole('region', { name: 'Festival concerts', exact: true });
      await catalog.getByLabel('Festival', { exact: true }).selectOption('edc-las-vegas');
      await catalog.getByLabel('Year', { exact: true }).selectOption('2026');
      await catalog.getByText('116 festival sets from 2026', { exact: true }).waitFor();
      assert.equal(
        await catalog.getByRole('link', { name: 'Official video ↗', exact: true }).count(),
        20,
      );
      const expected = CONCERT_CATALOG.filter(
        (item) => item.eventId === 'edc-las-vegas' && item.year === 2026,
      ).map((item) => `https://www.youtube.com/watch?v=${item.videoId}`);
      const found: string[] = [];
      for (let index = 0; index < 6; index++) {
        found.push(
          ...(await catalog
            .getByRole('link', { name: 'Official video ↗', exact: true })
            .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href))),
        );
        if (index < 5)
          await catalog.getByRole('button', { name: 'Next sets', exact: true }).click();
      }
      assert.deepEqual(
        found,
        expected,
        'Every indexed set remains reachable through bounded pages',
      );
      assert.equal(
        await catalog.getByRole('button', { name: 'Next sets', exact: true }).isDisabled(),
        true,
      );
      await catalog.getByLabel('Find an artist or stage', { exact: true }).fill('Casa Bacardí');
      assert.equal(
        await catalog.getByRole('link', { name: 'Official video ↗', exact: true }).count(),
        3,
      );
      await catalog.getByLabel('Find an artist or stage', { exact: true }).fill('casa bacardi');
      assert.equal(
        await catalog.getByRole('link', { name: 'Official video ↗', exact: true }).count(),
        3,
        'Artist and stage searches accept unaccented spelling',
      );
      await catalog.getByLabel('Find an artist or stage', { exact: true }).fill('Westend');
      assert.equal(
        await catalog.getByRole('link', { name: 'Official video ↗', exact: true }).count(),
        1,
      );
      assert.equal(
        await catalog
          .getByRole('link', { name: 'Official video ↗', exact: true })
          .getAttribute('href'),
        'https://www.youtube.com/watch?v=jQLWYc2UrFY',
      );
      assert.equal(f.writes.length, 0);
      assert.equal(f.jobs.length, 0);
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
