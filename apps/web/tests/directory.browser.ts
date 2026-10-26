// Public directory journeys use fictional rooms, isolated storage and no providers.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { chromium } from 'playwright';
import type { OpenRoom } from '../../../lib/types.ts';

const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const rooms: OpenRoom[] = [
  { code: 'ROOM0001', name: 'Rooftop after dark', viewers: 12, expiresAt: Date.now() + 3600000 },
  { code: 'ROOM0002', name: 'Sunday rooftop records', viewers: 1, expiresAt: Date.now() + 3600000 },
  {
    code: 'ROOM0003',
    name: 'A very long synthetic room name for everyone bringing their favourite records tonight',
    viewers: 3,
    expiresAt: Date.now() + 3600000,
  },
  { code: 'ROOM0004', name: 'The kitchen disco', viewers: 8, expiresAt: Date.now() + 3600000 },
  { code: 'ROOM0005', name: 'One more track', viewers: 0, expiresAt: Date.now() + 3600000 },
  { code: 'ROOM0006', name: 'Late night listening', viewers: 4, expiresAt: Date.now() + 3600000 },
];
async function fixture(t: TestContext, width: number) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: {
      width,
      height: width === 3840 ? 2160 : width === 2560 ? 1440 : width === 1920 ? 1080 : 1000,
    },
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(8000);
  const errors: string[] = [],
    writes: string[] = [];
  let reads = 0,
    fail = false,
    list = rooms;
  let release: (() => void) | undefined;
  let hold = false;
  await page.addInitScript(() => {
    const originalInterval = window.setInterval;
    const originalFetch = window.fetch;
    const state = window as typeof window & { directoryPoll?: () => void; directoryAborts: number };
    state.directoryAborts = 0;
    window.setInterval = ((callback: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 30000 && typeof callback === 'function')
        state.directoryPoll = () => callback(...args);
      return originalInterval(callback, timeout, ...args);
    }) as typeof window.setInterval;
    window.fetch = (input, options) => {
      if (typeof input === 'string' && input === '/api/rooms')
        options?.signal?.addEventListener('abort', () => state.directoryAborts++);
      return originalFetch(input, options);
    };
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(url.pathname);
    if (url.pathname === '/api/rooms') {
      reads++;
      const result = list;
      if (hold)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      try {
        return await route.fulfill({
          status: fail ? 503 : 200,
          json: fail ? { error: 'Synthetic unavailable directory' } : { rooms: result },
        });
      } catch {
        return;
      }
    }
    const room = rooms.find((room) => url.pathname === `/api/rooms/${room.code}`);
    if (room)
      return route.fulfill({
        json: {
          ...room,
          current: null,
          queue: [],
          history: [],
          playing: false,
          position: 0,
          version: 1,
          serverTime: Date.now(),
          isHost: false,
          isOwner: false,
          isPublic: true,
        },
      });
    return route.fulfill({ json: { rooms: [] } });
  });
  t.after(() => release?.());
  return {
    page,
    errors,
    writes,
    get reads() {
      return reads;
    },
    fail: (value: boolean) => {
      fail = value;
    },
    list: (value: OpenRoom[]) => {
      list = value;
    },
    hold: (value: boolean) => {
      hold = value;
    },
    release: () => release?.(),
  };
}

for (const width of [3840, 2560, 1920, 390]) {
  test(
    `directory filters, retains rooms on refresh failure and joins at ${width}px`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, width),
        { page } = f;
      await page.goto(`${origin}/?view=rooms`);
      const cards = page.locator('.directory article');
      await cards.last().waitFor();
      assert.equal(await cards.count(), 6);
      assert.match(await page.locator('.directory-count').innerText(), /6 open rooms/);
      const search = page.getByRole('searchbox', { name: 'Find an open room', exact: true });
      await search.fill('  ROOFTOP  ');
      assert.equal(await cards.count(), 2);
      assert.match(await page.locator('.directory-count').innerText(), /2 of 6/);
      await search.fill('room0002');
      assert.equal(await cards.count(), 1);
      assert.match(await cards.first().innerText(), /1 person listening/);
      await search.fill('no matching room');
      await page
        .getByRole('heading', { name: 'No rooms match your search.', exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Show all rooms', exact: true }).click();
      assert.equal(await search.inputValue(), '');
      assert.equal(
        await search.evaluate((node) => document.activeElement === node),
        true,
        'reset returns focus to search',
      );
      assert.equal(await cards.count(), 6);
      assert.equal(f.reads, 1, 'local filtering never requests the provider');
      f.fail(true);
      await search.fill('rooftop');
      await page.getByRole('button', { name: 'Refresh rooms', exact: true }).click();
      await page
        .getByRole('alert')
        .filter({ hasText: 'Showing the last available list.' })
        .waitFor();
      assert.equal(await cards.count(), 2, 'refresh failure retains matching good rooms');
      assert.equal(await search.inputValue(), 'rooftop');
      f.fail(false);
      f.list(rooms.slice(1));
      await page.getByRole('button', { name: 'Refresh rooms', exact: true }).click();
      await page.waitForFunction(() =>
        document.querySelector('.directory-count')?.textContent?.includes('1 of 5'),
      );
      assert.equal(await page.getByRole('alert').count(), 0);
      await page.getByRole('button', { name: 'Clear search', exact: true }).click();
      assert.equal(await cards.count(), 5);
      assert.equal(
        await search.evaluate((node) => document.activeElement === node),
        true,
        'clearing the filter retains keyboard focus',
      );
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page
        .getByRole('button', { name: 'Join Sunday rooftop records (ROOM0002)', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Sunday rooftop records', level: 1, exact: true })
        .waitFor();
      assert.equal(new URL(page.url()).searchParams.get('room'), 'ROOM0002');
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.errors, []);
    },
  );
}

test('initial failure can recover to an honest empty directory and create a room', async (t) => {
  const f = await fixture(t, 390);
  f.fail(true);
  await f.page.goto(`${origin}/?view=rooms`);
  await f.page.getByRole('alert').filter({ hasText: 'Open rooms could not load.' }).waitFor();
  assert.equal(
    await f.page.getByRole('heading', { name: 'The next great room could be yours.' }).count(),
    0,
    'a failed read is not an empty directory',
  );
  f.fail(false);
  f.list([]);
  await f.page.getByRole('button', { name: 'Refresh rooms', exact: true }).click();
  await f.page
    .getByRole('heading', { name: 'The next great room could be yours.', exact: true })
    .waitFor();
  assert.match(await f.page.locator('.directory-count').innerText(), /0 open rooms/);
  await f.page.getByRole('button', { name: 'Create a room', exact: true }).click();
  await f.page.getByRole('textbox', { name: 'Room name', exact: true }).waitFor();
  assert.equal(await f.page.locator('.directory').count(), 0);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.errors, []);
});

test('pending directory refresh is single-flight, aborts on exit and cannot publish into a new visit', async (t) => {
  const f = await fixture(t, 390),
    { page } = f;
  await page.goto(`${origin}/?view=rooms`);
  await page.locator('.directory article').last().waitFor();
  f.hold(true);
  await page.getByRole('button', { name: 'Refresh rooms', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('#directory-results')?.getAttribute('aria-busy') === 'true',
  );
  await page.evaluate(() =>
    (window as typeof window & { directoryPoll?: () => void }).directoryPoll?.(),
  );
  assert.equal(f.reads, 2, 'polling cannot overlap a pending refresh');
  assert.equal(
    await page.getByRole('button', { name: 'Refreshing rooms…', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.locator('.directory article').count(),
    6,
    'pending refresh keeps good cards',
  );
  await page.getByRole('button', { name: 'Create a room', exact: true }).click();
  await page.getByRole('textbox', { name: 'Room name', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => (window as typeof window & { directoryAborts: number }).directoryAborts,
    ),
    1,
  );
  f.hold(false);
  f.list([rooms[4]]);
  f.release();
  await page.getByRole('button', { name: 'Open rooms', exact: true }).click();
  await page.locator('.directory article').waitFor();
  assert.equal(await page.locator('.directory article').count(), 1);
  await page.getByRole('heading', { name: 'One more track', exact: true }).waitFor();
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.writes, []);
});
