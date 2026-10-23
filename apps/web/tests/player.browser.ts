// UI integration uses isolated browser contexts, synthetic API state and no real media.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import type { Room, Video } from '../../../lib/types.ts';

const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const browsers = new Set<Browser>();
// Also clean up when setup fails or a test deadline interrupts pending work.
afterEach(async () => {
  await Promise.all([...browsers].map((browser) => browser.close()));
});
const code = 'TESTROOM',
  token = 'b'.repeat(64),
  visitor = 'a'.repeat(32);
const video = (id: string, title: string, artist: string): Video => ({
  id,
  title,
  artist,
  duration: 240,
  image: '',
  live: false,
  embeddable: true,
});
const current = video('current0001', 'Midnight City', 'Synthetic Signals');
const results = [
  video('result00001', 'After the last train', 'Neon Coast'),
  video('result00002', 'Soft lights, open windows', 'The Late Hours'),
  video(
    'result00003',
    'A very long synthetic song title that must remain usable on a narrow screen',
    'An equally long synthetic artist credit',
  ),
];
type Write = { action: string; version: number; videoId?: string; position?: number };

async function fixture(width: number, host = true, initial = false) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox'],
  });
  browsers.add(browser);
  browser.once('disconnected', () => browsers.delete(browser));
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    reducedMotion: 'reduce',
  });
  const errors: string[] = [],
    external: string[] = [],
    writes: Write[] = [];
  let creates = 0,
    authorizedReads = 0,
    roomReads = 0,
    version = 1,
    playing = true,
    position = 12;
  let queue = [
    video('queued00001', 'Stay a little longer', 'Common Ground'),
    video('queued00002', 'City after dark', 'Night Bus'),
  ];
  const snapshot = (isHost: boolean): Room => ({
    code,
    version,
    name: 'Friday, after hours',
    current,
    queue,
    playing,
    position,
    serverTime: Date.now(),
    viewers: 4,
    isHost,
    isOwner: isHost,
    isPublic: false,
    expiresAt: Date.now() + 3600000,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ code, token, visitor, initial, host }) => {
      localStorage.setItem('afterparty-visitor', visitor);
      if (initial && host) localStorage.setItem(`afterparty-host:${code}`, token);
      // Deterministic official-player boundary. No iframe, provider request or media.
      const calls: { action: string; position?: number; videoId?: string }[] = [];
      (window as unknown as { __audioCalls: typeof calls }).__audioCalls = calls;
      window.YT = {
        Player: class {
          position = 0;
          state = 2;
          constructor(_container: HTMLElement, options: Record<string, unknown>) {
            calls.push({ action: 'construct' });
            const events = options.events as {
              onReady: () => void;
              onStateChange?: (event: { data: number }) => void;
            };
            // Retain the callback after destroy to model a delayed iframe event.
            (window as unknown as { __emitLastPlayerEnded: () => void }).__emitLastPlayerEnded =
              () => events.onStateChange?.({ data: 0 });
            setTimeout(() => events.onReady(), 0);
          }
          loadVideoById(value: { videoId: string; startSeconds: number }) {
            this.position = value.startSeconds;
            this.state = 1;
            calls.push({ action: 'load', videoId: value.videoId, position: value.startSeconds });
          }
          cueVideoById(value: { videoId: string; startSeconds: number }) {
            this.position = value.startSeconds;
            this.state = 2;
            calls.push({ action: 'cue', videoId: value.videoId, position: value.startSeconds });
          }
          playVideo() {
            this.state = 1;
            calls.push({ action: 'play' });
          }
          pauseVideo() {
            this.state = 2;
            calls.push({ action: 'pause' });
          }
          seekTo(position: number) {
            this.position = position;
            calls.push({ action: 'seek', position });
          }
          getCurrentTime() {
            return this.position;
          }
          getPlayerState() {
            return this.state;
          }
          destroy() {
            calls.push({ action: 'destroy' });
          }
          setVolume() {}
          mute() {}
          unMute() {}
          setPlaybackRate() {}
          getVolume() {
            return 100;
          }
          isMuted() {
            return false;
          }
        },
      };
    },
    { code, token, visitor, initial, host },
  );
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) {
      external.push(url.origin);
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const headers = request.headers();
    assert.equal(headers['x-afterparty-visitor'], visitor);
    const input = request.method() === 'POST' ? request.postDataJSON() : null;
    if (url.pathname === '/api/rooms' && input) {
      creates++;
      assert.deepEqual(input, { name: 'Friday, after hours', isPublic: false });
      return route.fulfill({ json: { room: snapshot(false), token } });
    }
    if (url.pathname === `/api/rooms/${code}`) {
      const authorized = host && headers.authorization === `Bearer ${token}`;
      if (!input) {
        roomReads++;
        if (authorized) authorizedReads++;
        return route.fulfill({ json: snapshot(authorized) });
      }
      assert.equal(input.version, version, 'mutations carry the current server revision');
      if (input.action !== 'add') assert(authorized, 'transport requires the host token');
      writes.push(input);
      if (input.action === 'add') {
        const selected = results.find((item) => item.id === input.videoId);
        assert(selected);
        queue = [...queue, selected];
      } else if (input.action === 'pause') playing = false;
      else if (input.action === 'play') playing = true;
      else if (input.action === 'seek') position = input.position;
      else assert.fail(`Unexpected synthetic command: ${input.action}`);
      version++;
      return route.fulfill({ json: { room: snapshot(authorized) } });
    }
    if (url.pathname === '/api/search') {
      const query = url.searchParams.get('q');
      if (query === 'cold artist') await new Promise((resolve) => setTimeout(resolve, 13250));
      if (query === 'unavailable')
        return route.fulfill({
          status: 503,
          json: { error: 'Synthetic music search is unavailable. Try again.' },
        });
      return route.fulfill({ json: { videos: query === 'empty' ? [] : results } });
    }
    assert.fail(`Unexpected API request: ${url.pathname}`);
  });
  await page.goto(`${origin}/v3${initial ? `?room=${code}` : ''}`);
  return {
    page,
    errors,
    external,
    writes,
    get creates() {
      return creates;
    },
    get authorizedReads() {
      return authorizedReads;
    },
    get roomReads() {
      return roomReads;
    },
    async close() {
      await page.unrouteAll({ behavior: 'wait' });
      await browser.close();
    },
  };
}

test(
  'cold catalog requests can complete after the generic twelve-second API deadline',
  { timeout: 25000 },
  async () => {
    const f = await fixture(390, true, true);
    try {
      await f.page.getByRole('heading', { name: 'Friday, after hours', exact: true }).waitFor();
      await find(f.page, 'cold artist');
      await f.page
        .getByRole('status')
        .filter({ hasText: '3 results for “cold artist”' })
        .waitFor({ timeout: 16000 });
      assert.equal(await f.page.getByRole('alert').count(), 0);
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);

async function find(page: Page, query: string) {
  const input = page.getByRole('textbox', { name: 'Search songs or artists' });
  await input.fill(query);
  await input.press('Enter');
}
async function noOverflow(page: Page) {
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'page does not overflow horizontally',
  );
  assert.equal(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    true,
  );
  assert.equal(
    await page
      .locator('.button.primary')
      .first()
      .evaluate((button) => getComputedStyle(button).transitionDuration),
    '0s',
  );
}

for (const width of [1440, 390]) {
  test(`${width}px: private creation, keyboard search, queue and synchronized host transport`, async () => {
    const f = await fixture(width);
    try {
      const { page } = f;
      await page.keyboard.press('Tab');
      assert.equal(
        await page
          .getByRole('link', { name: 'Skip to music' })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.keyboard.press('Enter');
      await page
        .getByRole('textbox', { name: 'Room name', exact: true })
        .fill('Friday, after hours');
      await page.getByRole('button', { name: 'Create private room' }).click();
      await page.getByRole('heading', { name: 'Friday, after hours', exact: true }).waitFor();
      assert.equal(f.creates, 1);
      assert(f.authorizedReads >= 1, 'creation is read back with the saved host token');
      assert.equal(
        await page.evaluate((code) => localStorage.getItem(`afterparty-host:${code}`), code),
        token,
      );
      assert.equal(new URL(page.url()).searchParams.get('room'), code);
      assert.equal(await page.getByRole('button', { name: 'Pause playback' }).isEnabled(), true);
      await find(page, 'night');
      await page.getByRole('status').filter({ hasText: '3 results' }).waitFor();
      const input = page.getByRole('textbox', { name: 'Search songs or artists' });
      await input.focus();
      await page.keyboard.press('Tab');
      assert.equal(
        await page
          .getByRole('button', { name: 'Find music' })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.keyboard.press('Tab');
      const add = page.getByRole('button', {
        name: `Add ${results[0].title} to queue`,
        exact: true,
      });
      assert.equal(await add.evaluate((element) => element === document.activeElement), true);
      await page.keyboard.press('Enter');
      await page.locator('.queue-list').getByText(results[0].title, { exact: true }).waitFor();
      assert.deepEqual(f.writes[0], { action: 'add', version: 1, videoId: results[0].id });
      await noOverflow(page);
      assert.deepEqual(f.external, [], 'no remote content is requested before audio consent');
      assert.equal(
        await page.evaluate(
          () => (window as unknown as { __audioCalls: unknown[] }).__audioCalls.length,
        ),
        0,
      );
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        scrollTo(0, 0);
      });
      await page.screenshot({
        path: `/tmp/afterparty-v3-${width === 1440 ? 'desktop' : 'mobile'}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Enable room audio', exact: true }).click();
      await page.waitForFunction(() =>
        (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
          (call) => call.action === 'load',
        ),
      );
      await page.getByRole('button', { name: 'Pause playback' }).click();
      await page.getByRole('button', { name: 'Resume playback' }).waitFor();
      await page.waitForFunction(() =>
        (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
          (call) => call.action === 'pause',
        ),
      );
      await page.getByRole('button', { name: 'Resume playback' }).click();
      await page.getByRole('button', { name: 'Pause playback' }).waitFor();
      await page.waitForFunction(() =>
        (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
          (call) => call.action === 'play',
        ),
      );
      await page.getByRole('slider', { name: 'Playback position' }).evaluate((element) => {
        (element as HTMLInputElement).value = '42';
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForFunction(() =>
        (
          window as unknown as { __audioCalls: { action: string; position?: number }[] }
        ).__audioCalls.some((call) => call.action === 'seek' && call.position! >= 42),
      );
      assert.deepEqual(
        f.writes.map((write) => write.action),
        ['add', 'pause', 'play', 'seek'],
      );
      assert.deepEqual(
        f.writes.map((write) => write.version),
        [1, 2, 3, 4],
      );
      assert.equal(f.writes.at(-1)?.position, 42);
      await page.evaluate(() =>
        (window as unknown as { __emitLastPlayerEnded: () => void }).__emitLastPlayerEnded(),
      );
      await page.waitForTimeout(150);
      assert.equal(
        f.writes.length,
        4,
        'a late local ENDED event cannot advance the server timeline',
      );
      await page.getByRole('button', { name: 'Leave room', exact: true }).click();
      await page.getByRole('button', { name: 'Create private room' }).waitFor();
      await page.waitForFunction(() =>
        (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
          (call) => call.action === 'destroy',
        ),
      );
      assert.equal(await page.locator('.audio-stage').count(), 0, 'leaving unmounts the player');
      assert.equal(
        await page.locator('.search-results').count(),
        0,
        'leaving clears the previous room results',
      );
      assert.equal(new URL(page.url()).searchParams.has('room'), false);
      assert.equal(
        await page.evaluate((code) => localStorage.getItem(`afterparty-host:${code}`), code),
        token,
        'leaving preserves saved ownership',
      );
      const readsAfterLeave = f.roomReads;
      await page.waitForTimeout(1300);
      assert.equal(f.roomReads, readsAfterLeave, 'leaving stops the retired room polling');
      assert.deepEqual(
        f.writes.map((write) => write.action),
        ['add', 'pause', 'play', 'seek'],
        'teardown cannot send playback commands',
      );
      await page.getByRole('textbox', { name: 'Room code', exact: true }).fill(code);
      await page.getByRole('button', { name: 'Join room', exact: true }).click();
      await page.getByRole('heading', { name: 'Friday, after hours', exact: true }).waitFor();
      assert.equal(
        await page.getByRole('button', { name: 'Pause playback' }).isEnabled(),
        true,
        'joining again restores saved host permissions',
      );
      await page.getByRole('button', { name: 'Enable room audio', exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
              (call) => call.action === 'construct',
            ).length,
        ),
        1,
        'joining again requires fresh local audio consent',
      );
      await page.evaluate(() =>
        (window as unknown as { __emitLastPlayerEnded: () => void }).__emitLastPlayerEnded(),
      );
      await page.waitForTimeout(150);
      assert.equal(f.writes.length, 4, 'a destroyed player cannot advance a newly joined session');
      assert.deepEqual(
        f.external,
        [],
        'the stub exercises audio synchronization without providers',
      );
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  });

  test(`${width}px: guests can add, host controls stay disabled and search recovers from empty/error`, async () => {
    const f = await fixture(width, false, true);
    try {
      const { page } = f;
      await page.getByRole('heading', { name: 'Friday, after hours', exact: true }).waitFor();
      for (const control of [
        page.getByRole('button', { name: 'Pause playback' }),
        page.getByRole('button', { name: 'Next track' }),
        page.getByRole('slider', { name: 'Playback position' }),
      ])
        assert.equal(await control.isDisabled(), true);
      await page
        .getByText('The host controls playback. Everyone can add to the queue.', { exact: true })
        .waitFor();
      await find(page, 'empty');
      await page.getByRole('status').filter({ hasText: 'No songs found for “empty”' }).waitFor();
      assert.equal(await page.locator('.search-results').count(), 0);
      await find(page, 'unavailable');
      await page
        .getByRole('alert')
        .filter({ hasText: 'Synthetic music search is unavailable' })
        .waitFor();
      await find(page, 'night');
      await page
        .getByRole('button', { name: `Add ${results[1].title} to queue`, exact: true })
        .click();
      await page.locator('.queue-list').getByText(results[1].title, { exact: true }).waitFor();
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.deepEqual(
        f.writes.map((write) => write.action),
        ['add'],
      );
      assert.equal(f.authorizedReads, 0);
      await noOverflow(page);
      assert.deepEqual(f.external, []);
      assert.deepEqual(f.errors, []);
      await page.getByRole('link', { name: 'Afterparty home', exact: true }).click();
      await page.getByRole('heading', { name: 'Start something good' }).waitFor();
      assert.equal(new URL(page.url()).searchParams.has('room'), false);
    } finally {
      await f.close();
    }
  });
}
