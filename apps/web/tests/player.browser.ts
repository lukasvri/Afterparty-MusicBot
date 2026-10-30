// UI integration uses isolated browser contexts, synthetic API state and no real media.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import type { Room, Video } from '../../../lib/types.ts';

const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
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

test('new devices favor stable playback and retain an explicit precise preference', async (t) => {
  const f = await fixture(t, 1920, { initial: true });
  try {
    const { page } = f;
    await page.getByText('Room settings', { exact: true }).click();
    const mode = page.getByRole('combobox', { name: 'Synchronization mode', exact: true });
    assert.equal(await mode.inputValue(), 'stable');
    await mode.selectOption('precise');
    await page.reload();
    await page.getByText('Room settings', { exact: true }).click();
    assert.equal(await mode.inputValue(), 'precise');
    assert.deepEqual(f.writes, [], 'device preferences never change the shared room');
    assert.deepEqual(f.external, [], 'opening settings does not load provider media');
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});
// Same-origin fixtures exercise successful, broken and absent thumbnail metadata.
results[0].image = '/afterparty-mark.svg';
results[1].image = '/synthetic-missing-cover.jpg';
type Write = { action: string; version: number; videoId?: string; position?: number; to?: number };

async function fixtureBrowser(registerCleanup: (cleanup: () => Promise<void>) => void) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox'],
  });
  // Own the process before newPage, route setup or navigation can fail.
  registerCleanup(() => browser.close());
  return browser;
}

async function closeFixture(page: Page, browser: Browser) {
  try {
    await page.unrouteAll({ behavior: 'default' });
  } finally {
    await browser.close();
  }
}

test('fixture teardown closes its real browser even when route cleanup fails', async (t) => {
  const browser = await fixtureBrowser((cleanup) => t.after(cleanup));
  const page = await browser.newPage();
  t.mock.method(page, 'unrouteAll', async () => {
    throw new Error('Synthetic route cleanup failure');
  });
  await assert.rejects(closeFixture(page, browser), /Synthetic route cleanup failure/);
  assert.equal(browser.isConnected(), false);
});

test('fixture teardown closes its real browser after navigation setup fails', async () => {
  let cleanup: (() => Promise<void>) | undefined;
  const browser = await fixtureBrowser((callback) => {
    cleanup = callback;
  });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    await assert.rejects(page.goto(`${origin}/v3`), /ERR_FAILED/);
    assert(cleanup, 'cleanup is registered before navigation');
    await cleanup();
    assert.equal(browser.isConnected(), false);
  } finally {
    await browser.close();
  }
});

async function fixture(
  t: TestContext,
  width: number,
  options: {
    host?: boolean;
    initial?: boolean;
    manualSampling?: boolean;
    scheduledSeek?: boolean;
    empty?: boolean;
    paused?: boolean;
  } = {},
) {
  const { host = true, initial = false, manualSampling = false, scheduledSeek = false } = options;
  const browser = await fixtureBrowser((cleanup) => t.after(cleanup));
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(8000);
  const errors: string[] = [],
    external: string[] = [],
    writes: Write[] = [];
  let creates = 0,
    authorizedReads = 0,
    roomReads = 0,
    failedReads = 0,
    version = 1,
    playing = !options.paused,
    position = 12;
  let playbackKey = 'initial-instance';
  let startsAt: number | undefined;
  let nowPlaying: Video | null = options.empty ? null : current;
  let queue = options.empty
    ? []
    : [
        video('queued00001', 'Stay a little longer', 'Common Ground'),
        video('queued00002', 'City after dark', 'Night Bus'),
      ];
  let heldMutation: Promise<void> | null = null;
  const snapshot = (isHost: boolean): Room => ({
    code,
    version,
    name: 'Friday, after hours',
    current: nowPlaying,
    queue,
    playing,
    position,
    serverTime: Date.now(),
    ...(scheduledSeek ? { playbackKey, startsAt } : {}),
    viewers: 4,
    isHost,
    isOwner: isHost,
    isPublic: false,
    expiresAt: Date.now() + 3600000,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ code, token, visitor, initial, host, manualSampling }) => {
      if (window !== window.top) return;
      localStorage.setItem('afterparty-visitor', visitor);
      if (initial && host) localStorage.setItem(`afterparty-host:${code}`, token);
      // Synthetic official-player boundary with a local iframe for real focus/activation.
      // No provider requests or media are used.
      const calls: { action: string; position?: number; videoId?: string; at?: number }[] = [];
      (window as unknown as { __audioCalls: typeof calls }).__audioCalls = calls;
      if (manualSampling) {
        const interval = window.setInterval.bind(window),
          ticks: (() => void)[] = [];
        window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
          if (timeout !== 250 || typeof handler !== 'function')
            return interval(handler, timeout, ...args);
          ticks.push(() => handler(...args));
          return interval(() => {}, timeout);
        }) as typeof window.setInterval;
        (window as typeof window & { samplePlayer: () => void }).samplePlayer = () =>
          ticks.forEach((tick) => tick());
        const fetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          let action: string | undefined;
          if (init?.method === 'POST' && typeof init.body === 'string') {
            const body = JSON.parse(init.body);
            action = body.action;
            calls.push({ action: `post-${body.action}`, at: performance.now() });
          }
          return fetch(input, init).then((response) => {
            if (action === 'next') calls.push({ action: 'ack-next', at: performance.now() });
            return response;
          });
        };
      }
      window.YT = {
        Player: class {
          position = 0;
          state = 2;
          videoId = '';
          iframe: HTMLIFrameElement;
          receive: (event: MessageEvent) => void;
          emit: (state: number) => void;
          constructor(container: HTMLElement, options: Record<string, unknown>) {
            calls.push({ action: 'construct' });
            (window as unknown as { __playerState: () => number }).__playerState = () => this.state;

            const events = options.events as {
              onReady: () => void;
              onAutoplayBlocked?: () => void;
              onStateChange?: (event: { data: number }) => void;
              onError?: (event: { data: number }) => void;
            };
            (
              window as typeof window & { emitPlayerError: (code: number) => void }
            ).emitPlayerError = (code) => events.onError?.({ data: code });
            (window as typeof window & { blockRoomAutoplay: () => void }).blockRoomAutoplay =
              () => {
                this.state = 2;
                events.onAutoplayBlocked?.();
              };
            this.emit = (state) => {
              this.state = state;
              events.onStateChange?.({ data: state });
            };
            this.iframe = document.createElement('iframe');
            this.iframe.title = 'YouTube video player';
            this.iframe.sandbox.add('allow-scripts');
            (
              window as unknown as { __nativeVideo: (action: string, position?: number) => void }
            ).__nativeVideo = (action, position) => {
              if (manualSampling) calls.push({ action: `native-${action}`, at: performance.now() });
              if (action === 'seek-event' || action === 'seek-paused-event') {
                this.position = position ?? 42;
                if (action === 'seek-paused-event') this.emit(2);
                this.emit(3);
                queueMicrotask(() => this.emit(1));
              } else if (action === 'seek') this.position = position ?? 42;
              else this.emit(action === 'play' ? 1 : 2);
            };
            this.receive = (event) => {
              if (
                event.source !== this.iframe.contentWindow ||
                event.data?.type !== 'synthetic-native'
              )
                return;
              (
                window as unknown as { __nativeVideo: (action: string, position?: number) => void }
              ).__nativeVideo(event.data.action, event.data.position);
            };
            window.addEventListener('message', this.receive);
            const fixtureNonce =
              document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
            this.iframe.srcdoc = `<style nonce="${fixtureNonce}">body{margin:0;background:#101216;color:white;display:flex;align-items:end;gap:12px;height:100vh}button{padding:10px;background:#242832;color:white;border:0}</style><button data-action="play">Play video</button><button data-action="pause">Pause video</button><button data-action="seek">Seek video</button><script nonce="${fixtureNonce}">document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>parent.postMessage({type:'synthetic-native',action:button.dataset.action,position:Number(button.dataset.position??42)},'*')));</script>`;
            container.replaceWith(this.iframe);
            // Retain the callback after destroy to model a delayed iframe event.
            (window as unknown as { __emitLastPlayerEnded: () => void }).__emitLastPlayerEnded =
              () => events.onStateChange?.({ data: 0 });
            setTimeout(() => events.onReady(), 0);
          }
          loadVideoById(value: { videoId: string; startSeconds: number }) {
            this.videoId = value.videoId;
            this.position = value.startSeconds;
            this.state = 1;
            calls.push({
              action: 'load',
              videoId: value.videoId,
              position: value.startSeconds,
              ...(manualSampling ? { at: performance.now() } : {}),
            });
            queueMicrotask(() => this.emit(1));
          }
          cueVideoById(value: { videoId: string; startSeconds: number }) {
            this.videoId = value.videoId;
            this.position = value.startSeconds;
            this.state = 2;
            calls.push({ action: 'cue', videoId: value.videoId, position: value.startSeconds });
            queueMicrotask(() => this.emit(5));
          }
          playVideo() {
            this.state = 1;
            calls.push({ action: 'play' });
            queueMicrotask(() => this.emit(1));
          }
          pauseVideo() {
            this.state = 2;
            calls.push({ action: 'pause' });
            queueMicrotask(() => this.emit(2));
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
          getIframe() {
            return this.iframe;
          }
          getVideoUrl() {
            return `https://www.youtube.com/watch?v=${this.videoId}`;
          }
          destroy() {
            window.removeEventListener('message', this.receive);
            calls.push({ action: 'destroy' });
          }
          level = 100;
          muted = false;
          setVolume(level: number) {
            this.level = level;
          }
          mute() {
            this.muted = true;
          }
          unMute() {
            this.muted = false;
          }
          setPlaybackRate() {}
          getVolume() {
            return this.level;
          }
          isMuted() {
            return this.muted;
          }
        },
      };
    },
    { code, token, visitor, initial, host, manualSampling },
  );
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) {
      external.push(url.origin);
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/rooms' && request.method() === 'GET')
      return route.fulfill({ json: { rooms: [] } });
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
        if (failedReads > 0) {
          failedReads--;
          return route.fulfill({ status: 503, json: { error: 'Temporary room outage.' } });
        }
        return route.fulfill({ json: snapshot(authorized) });
      }
      assert.equal(input.version, version, 'mutations carry the current server revision');
      if (input.action !== 'add') assert(authorized, 'transport requires the host token');
      writes.push(input);
      if (heldMutation) {
        const held = heldMutation;
        heldMutation = null;
        await held;
      }
      if (input.action === 'add') {
        const selected = results.find((item) => item.id === input.videoId);
        assert(selected);
        if (!nowPlaying) {
          nowPlaying = selected;
          position = 0;
          playing = true;
        } else queue = [...queue, selected];
      } else if (input.action === 'pause') playing = false;
      else if (input.action === 'play') playing = true;
      else if (input.action === 'seek') {
        position = input.position;
        if (scheduledSeek) {
          playbackKey = `seek-instance-${version}`;
          startsAt = playing ? Date.now() + 1500 : undefined;
        }
      } else if (input.action === 'next') {
        const selected = queue.shift();
        assert(selected);
        nowPlaying = selected;
        position = 0;
        playing = true;
      } else if (input.action === 'move') {
        const index = queue.findIndex((item) => item.id === input.videoId);
        assert(index >= 0);
        const [selected] = queue.splice(index, 1);
        queue.splice(input.to, 0, selected);
      } else if (input.action === 'remove')
        queue = queue.filter((item) => item.id !== input.videoId);
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
    failNextReads(count: number) {
      failedReads = count;
    },
    holdNextMutation() {
      let release = () => {};
      heldMutation = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    async close() {
      await closeFixture(page, browser);
    },
  };
}

test(
  'cold catalog requests can complete after the generic twelve-second API deadline',
  { timeout: 25000 },
  async (t) => {
    const f = await fixture(t, 390, { initial: true });
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

async function videoReady(page: Page) {
  await page.locator('.audio-stage iframe').waitFor();
  await page.waitForFunction(() => {
    const calls = (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls;
    const created = calls.findLastIndex((call) => call.action === 'construct');
    return (
      created >= 0 &&
      calls.slice(created).some((call) => call.action === 'load' || call.action === 'cue')
    );
  });
}

async function find(page: Page, query: string) {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Search songs or artists' });
  await input.fill(query);
  await input.press('Enter');
}

test('joining a playing room starts the guest video without another activation or shared command', async (t) => {
  const f = await fixture(t, 390, { host: false });
  try {
    await f.page.getByRole('textbox', { name: 'Room code', exact: true }).fill(code);
    await f.page.getByRole('button', { name: 'Join room', exact: true }).click();
    await f.page.waitForFunction(() =>
      (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
        (call) => call.action === 'load',
      ),
    );
    assert.equal(
      await f.page.getByRole('button', { name: 'Enable room audio', exact: true }).count(),
      0,
    );
    assert.deepEqual(f.writes, [], 'joining only starts this device, never shared playback');
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('adding the first video to an empty room starts its player without an extra activation', async (t) => {
  const f = await fixture(t, 1920, { initial: true, empty: true });
  try {
    await find(f.page, 'night');
    await f.page
      .getByRole('button', { name: `Add ${results[0].title} to queue`, exact: true })
      .click();
    await f.page.waitForFunction(
      (id) =>
        (
          window as unknown as { __audioCalls: { action: string; videoId?: string }[] }
        ).__audioCalls.some((call) => call.action === 'load' && call.videoId === id),
      results[0].id,
    );
    assert.deepEqual(
      f.writes.map((write) => write.action),
      ['add'],
    );
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('joining and adding to a paused room keeps the shared pause and current video', async (t) => {
  const f = await fixture(t, 390, { initial: true, paused: true });
  try {
    await videoReady(f.page);
    await find(f.page, 'night');
    await f.page
      .getByRole('button', { name: `Add ${results[0].title} to queue`, exact: true })
      .click();
    await f.page
      .locator('.player-status')
      .filter({ hasText: 'Shared playback is paused' })
      .waitFor();
    const calls = await f.page.evaluate(
      () =>
        (window as unknown as { __audioCalls: { action: string; videoId?: string }[] })
          .__audioCalls,
    );
    assert.equal(calls.filter((call) => call.action === 'construct').length, 1);
    assert(calls.some((call) => call.action === 'cue' && call.videoId === 'current0001'));
    assert.equal(
      calls.filter((call) => call.action === 'play' || call.action === 'load').length,
      0,
    );
    assert.deepEqual(
      f.writes.map((write) => write.action),
      ['add'],
    );
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('blocked automatic room playback offers a local audio retry without sending shared commands', async (t) => {
  const f = await fixture(t, 390, { host: false, initial: true });
  try {
    await videoReady(f.page);
    await f.page.evaluate(() =>
      (window as typeof window & { blockRoomAutoplay: () => void }).blockRoomAutoplay(),
    );
    await f.page
      .getByText('Your browser paused audio. Press Enable audio to listen.', { exact: true })
      .waitFor();
    await f.page.getByRole('button', { name: 'Enable audio', exact: true }).click();
    await f.page.waitForFunction(
      () => (window as unknown as { __playerState: () => number }).__playerState() === 1,
    );
    assert.equal(await f.page.locator('.audio-message').count(), 0);
    assert.deepEqual(f.writes, []);
    await f.page.screenshot({ path: '/tmp/afterparty-room-autostart-390.png', fullPage: true });
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('an explicit open-rooms bookmark stays in the directory after its saved room reconnects', async (t) => {
  const f = await fixture(t, 390, { initial: true });
  try {
    const reconnected = f.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/rooms/${code}` &&
        response.request().method() === 'GET',
    );
    await f.page.goto(`${origin}/?room=${code}&view=rooms`);
    await reconnected;
    assert.equal(
      await f.page.getByRole('heading', { name: 'Open rooms', exact: true }).isVisible(),
      true,
    );
    assert.equal(new URL(f.page.url()).searchParams.get('view'), 'rooms');
    assert.deepEqual(f.writes, []);
    assert.equal(f.creates, 0);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('a created room remains bookmarked after its first ownership read fails and polling recovers', async (t) => {
  const f = await fixture(t, 390);
  try {
    f.failNextReads(1);
    await f.page
      .getByRole('textbox', { name: 'Room name', exact: true })
      .fill('Friday, after hours');
    await f.page.getByRole('button', { name: 'Create private room' }).click();
    await f.page.getByRole('heading', { name: 'Friday, after hours', exact: true }).waitFor();
    assert.equal(f.creates, 1);
    assert.equal(new URL(f.page.url()).searchParams.get('room'), code);
    assert.equal(await f.page.getByRole('button', { name: 'Next track' }).isEnabled(), true);
    await f.page.reload();
    await f.page.getByRole('heading', { name: 'Friday, after hours', exact: true }).waitFor();
    assert.equal(f.creates, 1);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});
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
  test(`${width}px: private creation, keyboard search, queue and synchronized host transport`, async (t) => {
    const f = await fixture(t, width);
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
      assert.equal(await page.getByRole('button', { name: 'Next track' }).isEnabled(), true);
      await find(page, 'night');
      await page.getByRole('status').filter({ hasText: '3 results' }).waitFor();
      const thumbnails = page.locator('.search-results .track-thumbnail');
      assert.equal(await thumbnails.count(), 3);
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('.track-thumbnail img');
        return image?.complete && image.naturalWidth > 0;
      });
      await page.locator('.track-thumbnail[data-state="missing"]').nth(1).waitFor();
      assert.equal(await thumbnails.locator('img').count(), 1);
      assert.equal(await thumbnails.locator('img').getAttribute('referrerpolicy'), 'no-referrer');

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
      await page.getByRole('button', { name: /^Queue/ }).click();
      await page.locator('.queue-list').getByText(results[0].title, { exact: true }).waitFor();
      assert.deepEqual(f.writes[0], {
        action: 'add',
        version: 1,
        videoId: results[0].id,
        displayName: 'Guest',
      });
      await noOverflow(page);
      assert.deepEqual(f.external, [], 'the provider boundary stays synthetic');
      assert.equal(
        await page.evaluate(
          () =>
            (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
              (call) => call.action === 'construct',
            ).length,
        ),
        1,
      );
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        scrollTo(0, 0);
      });
      await page.screenshot({
        path: `/tmp/afterparty-v3-${width === 1440 ? 'desktop' : 'mobile'}.png`,
        fullPage: true,
      });
      await videoReady(page);
      await page.waitForFunction(() =>
        (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
          (call) => call.action === 'load',
        ),
      );
      assert.equal(
        await page.getByRole('button', { name: 'Pause playback', exact: true }).count(),
        0,
        'Native video replaces the duplicate transport',
      );
      const native = page.frameLocator('.audio-stage iframe');
      await native.getByRole('button', { name: 'Pause video', exact: true }).click();
      await page.waitForFunction(() =>
        document
          .querySelector('.player-status')
          ?.textContent?.includes('Shared playback is paused'),
      );
      await native.getByRole('button', { name: 'Play video', exact: true }).click();
      await page.waitForFunction(() =>
        document
          .querySelector('.player-status')
          ?.textContent?.includes('Following the shared clock'),
      );
      await page.waitForTimeout(1100);
      const seeking = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.request().postDataJSON()?.action === 'seek',
      );
      await native.getByRole('button', { name: 'Seek video', exact: true }).click();
      await seeking;
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
        await page.getByRole('button', { name: 'Next track' }).isEnabled(),
        true,
        'joining again restores saved host permissions',
      );
      await videoReady(page);
      assert.equal(
        await page.evaluate(
          () =>
            (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
              (call) => call.action === 'construct',
            ).length,
        ),
        2,
        'joining again starts the video in a new local player',
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

  test(`${width}px: guests can add, host controls stay disabled and search recovers from empty/error`, async (t) => {
    const f = await fixture(t, width, { host: false, initial: true });
    try {
      const { page } = f;
      await page.getByRole('heading', { name: 'Friday, after hours', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Next track' }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Pause playback' }).count(), 0);
      assert.equal(await page.getByRole('slider', { name: 'Playback position' }).count(), 0);
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
      await page.getByRole('button', { name: /^Queue/ }).click();
      await page.locator('.queue-list').getByText(results[1].title, { exact: true }).waitFor();
      assert.equal(await page.locator('.audio-message').count(), 0);
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

test('music tabs preserve searches and unfinished library inputs beside the player', async (t) => {
  const f = await fixture(t, 1920, { initial: true });
  try {
    const { page } = f;
    await page.getByText('Room settings', { exact: true }).click();
    await page.getByLabel('Your display name', { exact: true }).fill('Night host');
    await find(page, 'night');
    await page.getByRole('status').filter({ hasText: '3 results' }).waitFor();
    assert.equal(
      await page.getByLabel('Your display name', { exact: true }).inputValue(),
      'Night host',
    );
    await page.getByRole('button', { name: 'Library & playlists', exact: true }).click();
    const link = page.getByLabel('Playlist link', { exact: true });
    await link.fill('https://www.youtube.com/playlist?list=PL1234567890123456789');
    await find(page, 'another artist');
    await page.getByRole('status').filter({ hasText: '3 results for “another artist”' }).waitFor();
    assert.equal(
      await link.inputValue(),
      'https://www.youtube.com/playlist?list=PL1234567890123456789',
    );
    const searchBox = await page.locator('.discovery').boundingBox();
    const playerBox = await page.locator('.now-playing').boundingBox();
    assert(
      searchBox && playerBox && searchBox.x > playerBox.x + playerBox.width,
      'wide screens keep the music workspace beside the player',
    );
    assert.equal(
      await page.getByLabel('Your display name', { exact: true }).inputValue(),
      'Night host',
    );
    await page.getByRole('button', { name: 'Library & playlists', exact: true }).click();
    assert.equal(
      await link.inputValue(),
      'https://www.youtube.com/playlist?list=PL1234567890123456789',
      'changing tools preserves the import draft',
    );
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    assert.equal(
      await page.getByRole('region', { name: 'Your music library', exact: true }).count(),
      0,
      'inactive tools are hidden from accessibility navigation',
    );
    await page.getByRole('button', { name: 'Library & playlists', exact: true }).click();
    assert.equal(
      await link.inputValue(),
      'https://www.youtube.com/playlist?list=PL1234567890123456789',
    );
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.errors, []);
    await noOverflow(page);
  } finally {
    await f.close();
  }
});

test('familiar navigation and player workspace fit 4K, QHD, 1080p and mobile with quick access', async (t) => {
  const f = await fixture(t, 1920, { initial: true });
  try {
    const { page } = f;
    for (const [width, height] of [
      [3840, 2160],
      [2560, 1440],
      [1920, 1080],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => document.fonts.ready);
      const rows = await page
        .locator('.site-header nav .nav-link')
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
      assert(Math.max(...rows) - Math.min(...rows) <= 1, 'main navigation stays in one row');
      assert.equal(await page.getByRole('slider', { name: 'Playback position' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Pause playback' }).count(), 0);
      await noOverflow(page);
      const player = await page.locator('.now-playing').boundingBox();
      const workspace = await page.locator('.music-workspace').boundingBox();
      assert(player && workspace);
      if (width >= 1920)
        assert(
          workspace.x >= player.x + player.width && player.width > workspace.width,
          'one compact workspace sits beside the larger player',
        );
      else
        assert(
          workspace.y >= player.y + player.height,
          'mobile stacks the workspace beneath the player',
        );
      await page.screenshot({
        path: `/tmp/afterparty-familiar-room-${width}.png`,
        fullPage: width >= 900,
      });
    }
    await page.getByRole('button', { name: 'Open search', exact: true }).click();
    const search = page.getByRole('textbox', { name: 'Search songs or artists' });
    assert.equal(await search.evaluate((node) => node === document.activeElement), true);
    await search.fill('late night draft');
    await page.getByRole('button', { name: 'Open library', exact: true }).click();
    const playlist = page.getByLabel('Playlist link', { exact: true });
    await playlist.fill('https://www.youtube.com/playlist?list=PL1234567890123456789');
    await page.getByRole('button', { name: 'Go to player', exact: true }).click();
    assert.equal(
      await page.locator('#room-player').evaluate((node) => node === document.activeElement),
      true,
    );
    await page.getByRole('button', { name: 'Open queue', exact: true }).click();
    assert.equal(
      await page.getByRole('heading', { name: 'Up next', exact: true }).isVisible(),
      true,
    );
    await page.getByRole('button', { name: 'Open library', exact: true }).click();
    assert.equal(
      await playlist.inputValue(),
      'https://www.youtube.com/playlist?list=PL1234567890123456789',
    );
    await page.getByRole('button', { name: 'Open search', exact: true }).click();
    assert.equal(await search.inputValue(), 'late night draft');
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('one invitation panel copies only the public link and offers selection after clipboard failure', async (t) => {
  const f = await fixture(t, 390, { initial: true });
  try {
    const { page } = f;
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('Synthetic clipboard failure');
          },
        },
      }),
    );
    const invite = page.getByRole('button', { name: /^Invite friends/ });
    await invite.click();
    const link = page.getByRole('textbox', { name: 'Public room invitation link' });
    assert.equal(await link.inputValue(), `${origin}/?room=${code}`);
    await page.getByRole('button', { name: 'Copy room link', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Copy the selected link above.' }).waitFor();
    assert.equal(
      await link.evaluate(
        (node) =>
          node === document.activeElement &&
          (node as HTMLInputElement).selectionEnd === (node as HTMLInputElement).value.length,
      ),
      true,
    );
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (window as typeof window & { copiedRoomLink: string }).copiedRoomLink = value;
          },
        },
      }),
    );
    await page.getByRole('button', { name: 'Copy room link', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Room link copied.' }).waitFor();
    assert.equal(
      await page.evaluate(
        () => (window as typeof window & { copiedRoomLink: string }).copiedRoomLink,
      ),
      `${origin}/?room=${code}`,
    );
    await invite.click();
    assert.equal(await link.isVisible(), false);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('room browsing returns to the existing host room without issuing commands or restarting audio', async (t) => {
  const f = await fixture(t, 390, { initial: true });
  try {
    const { page } = f;
    await videoReady(page);
    await page.waitForFunction(() =>
      (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
        (call) => call.action === 'load',
      ),
    );
    await page.getByRole('button', { name: 'Open rooms', exact: true }).click();
    await page.getByRole('heading', { name: 'Open rooms', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('view'), 'rooms');
    assert.equal(
      await page.locator('nav[aria-label="Main navigation"] [aria-current="page"]').count(),
      1,
    );
    await page.getByRole('link', { name: 'Music', exact: true }).click();
    await page.getByRole('heading', { name: 'Friday, after hours', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('room'), code);
    assert.equal(new URL(page.url()).searchParams.has('view'), false);
    assert.equal(
      await page.getByRole('button', { name: 'Next track', exact: true }).isEnabled(),
      true,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Enable room audio', exact: true }).count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () =>
          (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
            (call) => call.action === 'construct',
          ).length,
      ),
      1,
      'returning to the room retains its local player without shared commands',
    );
    await page.getByRole('link', { name: 'Music', exact: true }).click();
    assert.equal(
      await page.getByRole('heading', { name: 'Friday, after hours', exact: true }).count(),
      1,
    );
    assert.deepEqual(f.writes, []);
    assert.equal(f.creates, 0);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('a guest device pause survives browsing the room directory and returning to music', async (t) => {
  const f = await fixture(t, 390, { host: false, initial: true });
  try {
    await videoReady(f.page);
    await f.page
      .frameLocator('.audio-stage iframe')
      .getByRole('button', { name: 'Pause video', exact: true })
      .click();
    await f.page.locator('.player-status').filter({ hasText: 'Paused on this device' }).waitFor();
    await f.page.getByRole('button', { name: 'Open rooms', exact: true }).click();
    await f.page.getByRole('heading', { name: 'Open rooms', exact: true }).waitFor();
    await f.page.getByRole('link', { name: 'Music', exact: true }).click();
    await f.page.locator('.player-status').filter({ hasText: 'Paused on this device' }).waitFor();
    assert.equal(
      await f.page.evaluate(() =>
        (window as unknown as { __playerState: () => number }).__playerState(),
      ),
      2,
    );
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

for (const width of [1440, 390])
  test(`queue options support keyboard reorder and removal at ${width}px`, async (t) => {
    const f = await fixture(t, width, { initial: true });
    try {
      const { page } = f;
      const second = page.locator('summary[aria-label="Track options for City after dark"]');
      await second.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('group', { name: 'Actions for City after dark', exact: true });
      await menu.getByRole('button', { name: 'Move up', exact: true }).focus();
      await page.keyboard.press('Escape');
      assert.equal(await second.evaluate((node) => node === document.activeElement), true);
      await page.keyboard.press('Enter');
      await menu.getByRole('button', { name: 'Move up', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('.queue-list li strong')?.textContent === 'City after dark',
      );
      assert.equal(
        await second.evaluate((node) => node === document.activeElement),
        true,
        'focus follows the reordered recording',
      );
      await page.keyboard.press('Enter');
      await menu.getByRole('button', { name: 'Remove', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.count')?.textContent === '1');
      const next = page.locator('summary[aria-label="Track options for Stay a little longer"]');
      assert.equal(
        await next.evaluate((node) => node === document.activeElement),
        true,
        'removing a row keeps keyboard focus in the queue',
      );
      assert.deepEqual(
        f.writes.map((write) => [write.action, write.version]),
        [
          ['move', 1],
          ['remove', 2],
        ],
      );
      assert.equal(f.writes[0].to, 0);
      assert.deepEqual(f.errors, []);
      await noOverflow(page);
    } finally {
      await f.close();
    }
  });

test('native pause stays inaudible and reaches the room after a pending queue addition', async (t) => {
  const f = await fixture(t, 1440, { initial: true });
  let release = () => {};
  try {
    const { page } = f;
    await videoReady(page);
    await find(page, 'night');
    await page.getByRole('status').filter({ hasText: '3 results' }).waitFor();
    release = f.holdNextMutation();
    await page
      .getByRole('button', { name: `Add ${results[0].title} to queue`, exact: true })
      .click();
    const native = page.frameLocator('.audio-stage iframe');
    await native.getByRole('button', { name: 'Pause video', exact: true }).click();
    await page.locator('.player-status').filter({ hasText: 'Paused on this device' }).waitFor();
    release();
    await page.getByRole('button', { name: /^Queue/ }).click();
    await page.locator('.queue-list').getByText(results[0].title, { exact: true }).waitFor();
    await page.waitForFunction(
      () => !(document.querySelector('.search-results button') as HTMLButtonElement)?.disabled,
    );
    await page.locator('.player-status').filter({ hasText: 'Shared playback is paused' }).waitFor();
    assert.deepEqual(
      f.writes.map((write) => write.action),
      ['add', 'pause'],
    );
    await native.getByRole('button', { name: 'Play video', exact: true }).click();
    await page
      .locator('.player-status')
      .filter({ hasText: 'Following the shared clock' })
      .waitFor();
    assert.deepEqual(
      f.writes.map((write) => write.action),
      ['add', 'pause', 'play'],
      'explicit native gestures are serialized behind the queue write',
    );
    assert.deepEqual(f.errors, []);
  } finally {
    release();
    await f.close();
  }
});

test('a completed queue action preserves focus when the host has moved to search', async (t) => {
  const f = await fixture(t, 390, { initial: true });
  try {
    const { page } = f;
    const release = f.holdNextMutation();
    await page.locator('summary[aria-label="Track options for City after dark"]').click();
    await page
      .getByRole('group', { name: 'Actions for City after dark', exact: true })
      .getByRole('button', { name: 'Move up', exact: true })
      .click();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Search songs or artists' });
    await input.fill('keep typing');
    release();
    await page.waitForFunction(
      () => document.querySelector('.queue-list li strong')?.textContent === 'City after dark',
    );
    assert.equal(await input.evaluate((node) => node === document.activeElement), true);
    assert.equal(await input.inputValue(), 'keep typing');
    assert.deepEqual(
      f.writes.map((write) => write.action),
      ['move'],
    );
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

for (const [scheduled, wasPlaying] of [
  [false, true],
  [true, true],
  [true, false],
])
  for (const seekEvent of ['seek-event', 'seek-paused-event']) {
    test(`native scrub preserves ${wasPlaying ? 'playing' : 'paused'} video without reloading (new timeline: ${scheduled}, event: ${seekEvent})`, async (t) => {
      const f = await fixture(t, 390, { initial: true, scheduledSeek: scheduled });
      let release = () => {};
      try {
        const { page } = f;
        await videoReady(page);
        const native = page.frameLocator('.audio-stage iframe');
        await native.getByRole('button', { name: 'Pause video', exact: true }).waitFor();
        if (!wasPlaying) {
          await native.getByRole('button', { name: 'Pause video', exact: true }).click();
          await page
            .locator('.player-status')
            .filter({ hasText: 'Shared playback is paused' })
            .waitFor();
        }
        // Acknowledge the initial source and establish a real position sample.
        await page.waitForTimeout(1100);
        const before = f.writes.length;
        release = f.holdNextMutation();
        await native
          .getByRole('button', { name: 'Seek video', exact: true })
          .evaluate((button, event) => {
            Object.assign((button as HTMLElement).dataset, { action: event, position: String(42) });
          }, seekEvent);
        await native.getByRole('button', { name: 'Seek video', exact: true }).click();
        await page.waitForFunction(() =>
          document
            .querySelector('.player-status')
            ?.textContent?.includes('Updating shared playback'),
        );
        assert.equal(
          await page.evaluate(() =>
            (window as unknown as { __playerState: () => number }).__playerState(),
          ),
          wasPlaying ? 1 : 2,
          'a playing scrub continues while its receipt is pending; paused rooms stay inaudible',
        );
        release();
        await page.waitForFunction(
          (expected) =>
            (window as unknown as { __playerState: () => number }).__playerState() === expected,
          wasPlaying ? 1 : 2,
          { timeout: 6000 },
        );
        await page
          .locator('.player-status')
          .filter({
            hasText: wasPlaying ? 'Following the shared clock' : 'Shared playback is paused',
          })
          .waitFor();
        await page.waitForTimeout(300);
        assert.equal(
          await page.evaluate(() =>
            (window as unknown as { __playerState: () => number }).__playerState(),
          ),
          wasPlaying ? 1 : 2,
        );
        assert.deepEqual(
          f.writes.slice(before).map((write) => write.action),
          ['seek'],
        );
        const sourceWrites = await page.evaluate(() =>
          (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls
            .filter((call) => ['construct', 'load', 'cue'].includes(call.action))
            .map((call) => call.action),
        );
        assert.deepEqual(
          sourceWrites,
          ['construct', 'load'],
          'a new timeline for the same video never loads its poster again',
        );
        assert.deepEqual(f.errors, []);
      } finally {
        release();
        await f.close();
      }
    });
  }

test('native pause, seek and queue-next dispatch without position polling or an acknowledgement delay', async (t) => {
  const f = await fixture(t, 390, { initial: true, manualSampling: true });
  try {
    const { page } = f;
    await videoReady(page);
    const native = page.frameLocator('.audio-stage iframe');
    await native.getByRole('button', { name: 'Pause video', exact: true }).waitFor();
    const releasePause = f.holdNextMutation();
    await native.getByRole('button', { name: 'Pause video', exact: true }).click();
    await page.waitForFunction(() =>
      (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
        (call) => call.action === 'post-pause',
      ),
    );
    assert.equal(
      f.writes.at(-1)?.action,
      'pause',
      'pause is already submitted while its response is held',
    );
    const beforePauseRelease = await page.evaluate(
      () =>
        (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
          (call) => call.action === 'play',
        ).length,
    );
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(
        () =>
          (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
            (call) => call.action === 'play',
          ).length,
      ),
      beforePauseRelease,
      'pending acknowledgement cannot undo a local pause',
    );
    releasePause();
    await page.locator('.player-status').filter({ hasText: 'Shared playback is paused' }).waitFor();
    await native.getByRole('button', { name: 'Play video', exact: true }).click();
    await page
      .locator('.player-status')
      .filter({ hasText: 'Following the shared clock' })
      .waitFor();
    await page.evaluate(() =>
      (window as typeof window & { samplePlayer: () => void }).samplePlayer(),
    );
    const releaseSeek = f.holdNextMutation();
    await native.getByRole('button', { name: 'Seek video', exact: true }).evaluate((button) => {
      Object.assign((button as HTMLElement).dataset, {
        action: 'seek-event',
        position: String(42),
      });
    });
    await native.getByRole('button', { name: 'Seek video', exact: true }).click();
    await page.waitForFunction(() =>
      (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
        (call) => call.action === 'post-seek',
      ),
    );
    assert.equal(
      f.writes.at(-1)?.position,
      42,
      'the native state event submits the seek before any later position poll',
    );
    releaseSeek();
    await page
      .getByRole('button', { name: 'Next track', exact: true })
      .waitFor({ state: 'visible' });
    await page.waitForFunction(
      () =>
        !(document.querySelector('button[aria-label="Next track"]') as HTMLButtonElement)?.disabled,
    );
    const next = page.getByRole('button', { name: 'Next track', exact: true });
    await next.evaluate((button) =>
      button.addEventListener(
        'click',
        () => {
          (
            window as unknown as { __audioCalls: { action: string; at: number }[] }
          ).__audioCalls.push({ action: 'queue-next-click', at: performance.now() });
        },
        { capture: true, once: true },
      ),
    );
    await next.click();
    await page.waitForFunction(() =>
      (
        window as unknown as { __audioCalls: { action: string; videoId?: string }[] }
      ).__audioCalls.some((call) => call.action === 'load' && call.videoId === 'queued00001'),
    );
    const calls = await page.evaluate(
      () =>
        (window as unknown as { __audioCalls: { action: string; at?: number; videoId?: string }[] })
          .__audioCalls,
    );
    const delay = (action: string) =>
      calls.find((call) => call.action === `post-${action}`)!.at! -
      calls.find((call) => call.action === `native-${action === 'seek' ? 'seek-event' : action}`)!
        .at!;
    const nextDispatch =
      calls.find((call) => call.action === 'post-next')!.at! -
      calls.find((call) => call.action === 'queue-next-click')!.at!;
    const sourceSwitch =
      calls.find((call) => call.action === 'load' && call.videoId === 'queued00001')!.at! -
      calls.find((call) => call.action === 'ack-next')!.at!;
    t.diagnostic(
      `Synthetic iframe event to fetch dispatch: pause=${delay('pause').toFixed(2)}ms, seek=${delay('seek').toFixed(2)}ms; queue-next click to dispatch=${nextDispatch.toFixed(2)}ms, acknowledgement to player source switch=${sourceSwitch.toFixed(2)}ms. All 250ms sampling timers were withheld; no provider/network latency is included.`,
    );
    assert.deepEqual(
      f.writes.map((write) => write.action),
      ['pause', 'play', 'seek', 'next'],
    );
    assert.equal(
      calls.filter((call) => call.action === 'construct').length,
      1,
      'queue-next reuses the current player',
    );
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('a failed YouTube source does not lock the next valid recording or retry the failed video', async (t) => {
  const f = await fixture(t, 390, { initial: true });
  try {
    const { page } = f;
    await videoReady(page);
    await page
      .frameLocator('.audio-stage iframe')
      .getByRole('button', { name: 'Pause video' })
      .waitFor();
    // Frame construction precedes the asynchronous ready/load callback. Inject
    // failure only after the intended recording is actually loaded.
    await page.waitForFunction(() =>
      (
        window as unknown as { __audioCalls: { action: string; videoId?: string }[] }
      ).__audioCalls.some((call) => call.action === 'load' && call.videoId === 'current0001'),
    );
    await page.evaluate(() =>
      (window as typeof window & { emitPlayerError: (code: number) => void }).emitPlayerError(150),
    );
    await page
      .locator('.audio-message')
      .filter({ hasText: 'This source cannot play here' })
      .waitFor();
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(
        () =>
          (
            window as unknown as { __audioCalls: { action: string; videoId?: string }[] }
          ).__audioCalls.filter((call) => call.action === 'load' && call.videoId === 'current0001')
            .length,
      ),
      1,
    );
    await page.getByRole('button', { name: 'Next track', exact: true }).click();
    await page.waitForFunction(() =>
      (
        window as unknown as { __audioCalls: { action: string; videoId?: string }[] }
      ).__audioCalls.some((call) => call.action === 'load' && call.videoId === 'queued00001'),
    );
    assert.equal(await page.locator('.audio-message').count(), 0);
    assert.equal(
      await page.evaluate(
        () =>
          (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
            (call) => call.action === 'construct',
          ).length,
      ),
      1,
    );
    assert.deepEqual(
      f.writes.map((write) => write.action),
      ['next'],
    );
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('native guest pause stays local through room polls and resumes at the shared position', async (t) => {
  const f = await fixture(t, 1920, { host: false, initial: true });
  try {
    const { page } = f;
    await videoReady(page);
    const native = page.frameLocator('.audio-stage iframe');
    await native.getByRole('button', { name: 'Pause video', exact: true }).click();
    await page.locator('.player-status').filter({ hasText: 'Paused on this device' }).waitFor();
    const reads = f.roomReads;
    await page.waitForFunction(() =>
      document.querySelector('.player-status')?.textContent?.includes('Paused on this device'),
    );
    await page.waitForTimeout(1800);
    assert(f.roomReads > reads, 'the paused device receives a newer room snapshot');
    assert.match(await page.locator('.player-status').innerText(), /Paused on this device/);
    assert.deepEqual(f.writes, [], 'a guest cannot send shared transport commands');
    await native.getByRole('button', { name: 'Play video', exact: true }).click();
    await page
      .locator('.player-status')
      .filter({ hasText: 'Following the shared clock' })
      .waitFor();
    await native.getByRole('button', { name: 'Seek video', exact: true }).click();
    await page.waitForTimeout(500);
    assert.deepEqual(f.writes, [], 'guest scrubbing cannot change the shared position');
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('unactivated iframe state changes cannot send host commands', async (t) => {
  const f = await fixture(t, 1920, { initial: true });
  try {
    const { page } = f;
    await videoReady(page);
    await page.waitForFunction(() =>
      (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
        (call) => call.action === 'load',
      ),
    );
    // Focus stays outside the iframe, even though enabling audio activated the page.
    await page.evaluate(() =>
      (window as unknown as { __nativeVideo: (action: string) => void }).__nativeVideo('pause'),
    );
    await page.locator('.player-status').filter({ hasText: 'Paused on this device' }).waitFor();
    assert.deepEqual(f.writes, []);
    assert.match(await page.locator('.player-status').innerText(), /Paused on this device/);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('a short provider pause resumes itself without becoming a pinned local pause', async (t) => {
  const f = await fixture(t, 1920, { initial: true });
  try {
    const { page } = f;
    await videoReady(page);
    await page.waitForFunction(
      () => (window as unknown as { __playerState: () => number }).__playerState() === 1,
    );
    const before = await page.evaluate(
      () => (window as unknown as { __audioCalls: unknown[] }).__audioCalls.length,
    );
    await page.evaluate(() => {
      const native = (window as unknown as { __nativeVideo: (action: string) => void })
        .__nativeVideo;
      native('pause');
      setTimeout(() => native('play'), 300);
    });
    await page.waitForTimeout(1300);
    assert.equal(
      await page.evaluate(() =>
        (window as unknown as { __playerState: () => number }).__playerState(),
      ),
      1,
    );
    assert.match(await page.locator('.player-status').innerText(), /Following the shared clock/);
    const writes = await page.evaluate(
      (start) =>
        (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls
          .slice(start)
          .filter((call) => ['play', 'pause', 'seek', 'load', 'cue'].includes(call.action)),
      before,
    );
    assert.deepEqual(
      writes,
      [],
      'the app neither forces a resume nor interrupts provider recovery',
    );
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('a newer media-key pause retires Play queued behind a delayed seek receipt', async (t) => {
  const f = await fixture(t, 1920, { initial: true });
  let release = () => {};
  try {
    const { page } = f;
    await videoReady(page);
    const native = page.frameLocator('.audio-stage iframe');
    await native.getByRole('button', { name: 'Seek video', exact: true }).evaluate((button) => {
      (button as HTMLElement).dataset.action = 'seek-event';
    });
    release = f.holdNextMutation();
    await native.getByRole('button', { name: 'Seek video', exact: true }).click();
    await page.locator('.player-status').filter({ hasText: 'Updating shared playback' }).waitFor();
    await native.getByRole('button', { name: 'Pause video', exact: true }).click();
    await native.getByRole('button', { name: 'Play video', exact: true }).click();
    await page.getByText('Room settings', { exact: true }).click();
    await page.evaluate(() =>
      (window as unknown as { __nativeVideo: (action: string) => void }).__nativeVideo('pause'),
    );
    await page.waitForTimeout(1100);
    const before = await page.evaluate(
      () =>
        (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
          (call) => call.action === 'play',
        ).length,
    );
    release();
    await page.locator('.player-status').filter({ hasText: 'Paused on this device' }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(() =>
        (window as unknown as { __playerState: () => number }).__playerState(),
      ),
      2,
    );
    assert.equal(
      await page.evaluate(
        () =>
          (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
            (call) => call.action === 'play',
          ).length,
      ),
      before,
    );
    assert.deepEqual(
      f.writes.map((write) => write.action),
      ['seek'],
    );
    assert.deepEqual(f.errors, []);
  } finally {
    release();
    await f.close();
  }
});

for (const [width, height] of [
  [3840, 2160],
  [2560, 1440],
  [1920, 1080],
  [1280, 720],
  [390, 844],
])
  test(
    `native TV invitations and fullscreen preserve the player at ${width}x${height}`,
    { timeout: 20000 },
    async (t) => {
      const f = await fixture(t, width, { initial: true });
      try {
        await f.page.setViewportSize({ width, height });
        await videoReady(f.page);
        await f.page.waitForFunction(() =>
          (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
            (call) => call.action === 'load',
          ),
        );
        await f.page.getByRole('button', { name: /^Invite friends/ }).click();
        await f.page.getByAltText('QR code to join this listening room').waitFor();
        assert.equal(
          await f.page.getByRole('textbox', { name: 'Public room invitation link' }).inputValue(),
          `${origin}/?room=${code}`,
        );
        await f.page.getByRole('button', { name: 'TV mode', exact: true }).click();
        await f.page.getByRole('button', { name: 'Exit TV mode', exact: true }).waitFor();
        await f.page.evaluate(() => document.fonts.ready);
        assert.equal(new URL(f.page.url()).searchParams.get('tv'), '1');
        assert(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (width >= 1920) {
          const video = await f.page.locator('.audio-stage').boundingBox();
          const qr = await f.page.getByAltText('QR code to join this listening room').boundingBox();
          assert(video && video.width >= width * 0.6, 'TV video grows with the viewport');
          assert(qr && qr.width >= width * 0.1, 'QR invitation scales for TV viewing');
        }
        if (width > 700)
          assert(
            await f.page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
            'TV fits without page scrolling: ' +
              JSON.stringify(
                await f.page.evaluate(() => ({
                  height: innerHeight,
                  scroll: document.documentElement.scrollHeight,
                  rects: Array.from(
                    document.querySelectorAll(
                      'main, .room-heading, .listening-grid, .now-playing, .audio-stage, .room-share, .transport',
                    ),
                  ).map((e) => ({
                    class: e.className,
                    y: e.getBoundingClientRect().y,
                    height: e.getBoundingClientRect().height,
                  })),
                })),
              ),
          );
        await f.page.screenshot({ path: `/tmp/afterparty-native-tv-${width}.png`, fullPage: true });
        await f.page.evaluate(() => {
          const stage = document.querySelector('.audio-stage')!;
          for (const api of ['requestFullscreen', 'webkitRequestFullscreen'])
            Object.defineProperty(stage, api, { configurable: true, value: undefined });
        });
        await f.page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await f.page.keyboard.press('f');
        await f.page.locator('.fullscreen-fallback').waitFor();
        await f.page.keyboard.press('Escape');
        await f.page.locator('.fullscreen-fallback').waitFor({ state: 'hidden' });
        const settings = f.page.getByText('Room settings', { exact: true });
        await settings.focus();
        await f.page.keyboard.press('m');
        await settings.click();
        assert.equal(
          await f.page.evaluate(() => JSON.parse(localStorage.getItem('afterparty-audio')!).muted),
          true,
        );
        assert.equal(
          await f.page.getByRole('slider', { name: 'Volume on this device' }).count(),
          0,
        );
        await f.page.getByRole('button', { name: 'Exit TV mode', exact: true }).click();
        await f.page.getByText('Playback diagnostics', { exact: true }).click();
        const diagnostics = await f.page.locator('.playback-diagnostics pre').innerText();
        assert(!diagnostics.includes(code) && !diagnostics.includes(current.id));
        assert.equal(
          await f.page.evaluate(
            () =>
              (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
                (call) => call.action === 'construct',
              ).length,
          ),
          1,
        );
        assert.deepEqual(
          f.writes,
          [],
          'viewing and local audio controls never mutate shared playback',
        );
        assert.deepEqual(f.errors, []);
      } finally {
        await f.close();
      }
    },
  );

test('music tabs restore their own scroll position with a single workspace scrollbar', async (t) => {
  const f = await fixture(t, 1440, { initial: true });
  try {
    const { page } = f;
    const navigation = page.getByRole('navigation', { name: 'Music workspace', exact: true });
    await navigation.getByRole('button', { name: 'Library & playlists', exact: true }).click();
    await page.getByRole('heading', { name: 'Your collection', exact: true }).waitFor();
    const scroller = page.locator('.room-side');
    await scroller.evaluate((node) => {
      node.scrollTop = 300;
    });
    assert.equal(await scroller.evaluate((node) => node.scrollTop), 300);
    assert(
      await page
        .locator('.music-library ol, .music-library ul')
        .evaluateAll((lists) =>
          lists.every((node) => getComputedStyle(node).overflowY === 'visible'),
        ),
    );
    await navigation.getByRole('button', { name: /^Queue/ }).click();
    assert.equal(await scroller.evaluate((node) => node.scrollTop), 0);
    await navigation.getByRole('button', { name: 'Library & playlists', exact: true }).click();
    assert.equal(await scroller.evaluate((node) => node.scrollTop), 300);
    await page.screenshot({ path: '/tmp/afterparty-ui-library-1440.png', fullPage: true });
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('theater mode fills the browser tab, keeps the iframe and search draft, and stays local', async (t) => {
  const f = await fixture(t, 1920, { initial: true });
  try {
    const { page } = f;
    await videoReady(page);
    await page.waitForFunction(() =>
      (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.some(
        (call) => call.action === 'load',
      ),
    );
    await find(page, 'night');
    await page.getByRole('status').filter({ hasText: '3 results' }).waitFor();
    for (const [width, height] of [
      [3840, 2160],
      [2560, 1440],
      [1920, 1080],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.getByRole('button', { name: 'Theater mode', exact: true }).click();
      const player = await page.locator('.audio-stage').boundingBox();
      assert(player && Math.abs(player.x) <= 1 && Math.abs(player.y) <= 1);
      assert(
        player && Math.abs(player.width - width) <= 1 && Math.abs(player.height - height) <= 1,
        'the video surface fills the entire browser tab',
      );
      const exit = page.getByRole('button', { name: 'Exit theater mode', exact: true });
      const exitBox = await exit.boundingBox();
      assert(
        exitBox &&
          exitBox.x >= 0 &&
          exitBox.y >= 0 &&
          exitBox.x + exitBox.width <= width &&
          exitBox.y + exitBox.height <= height,
      );
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.documentElement).overflow),
        'hidden',
      );
      await page
        .getByRole('button', { name: 'Leave room', exact: true })
        .evaluate((node) => node.focus());
      assert(
        await exit.evaluate((node) => node === document.activeElement),
        'background controls cannot take keyboard focus',
      );
      assert.equal(
        await page.getByRole('textbox', { name: 'Search songs or artists' }).inputValue(),
        'night',
      );
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width === 1920)
        await page.screenshot({ path: '/tmp/afterparty-ui-theater-1920.png', fullPage: true });
      await page.getByRole('button', { name: 'Exit theater mode', exact: true }).click();
    }
    assert.equal(
      await page.evaluate(
        () =>
          (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
            (call) => call.action === 'construct',
          ).length,
      ),
      1,
    );
    assert.deepEqual(f.writes, [], 'layout changes cannot issue playback commands');
    await page.getByRole('button', { name: 'Theater mode', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('afterparty-theater')), 'on');
    await page.reload();
    await page.locator('.app-shell.theater-mode').waitFor();
    await videoReady(page);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('saved motion preference and system reduced motion remain independent of audio and room control', async (t) => {
  const f = await fixture(t, 390, { initial: true });
  try {
    await f.page.evaluate(() => localStorage.setItem('afterparty-motion', 'off'));
    await f.page.reload();
    await f.page.waitForFunction(() => document.documentElement.dataset.motion === 'off');
    assert.equal(
      await f.page
        .getByRole('button', { name: 'Page animations', exact: true })
        .getAttribute('aria-pressed'),
      'false',
    );
    await f.page.evaluate(() => {
      const style = document.createElement('style');
      style.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
      style.textContent =
        '@keyframes nativeMotionFixture{from{opacity:.1}to{opacity:.9}}#native-motion-fixture{animation:nativeMotionFixture 1s linear infinite}';
      document.head.appendChild(style);
      const probe = document.createElement('span');
      probe.id = 'native-motion-fixture';
      document.body.appendChild(probe);
    });
    const animation = () =>
      f.page.evaluate(
        () => getComputedStyle(document.getElementById('native-motion-fixture')!).animationName,
      );
    assert.equal(await animation(), 'none');
    await f.page.getByRole('button', { name: 'Page animations', exact: true }).click();
    await f.page.waitForFunction(() => document.documentElement.dataset.motion === 'on');
    assert.equal(
      await animation(),
      'none',
      'system reduced-motion still wins over the saved on setting',
    );
    await f.page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(await animation(), 'nativeMotionFixture');
    await f.page.getByRole('button', { name: 'Page animations', exact: true }).click();
    await f.page.waitForFunction(() => document.documentElement.dataset.motion === 'off');
    assert.equal(await animation(), 'none');
    assert.equal(await f.page.evaluate(() => localStorage.getItem('afterparty-motion')), 'off');
    assert.deepEqual(f.writes, []);
    await videoReady(f.page);
    assert.equal(
      await f.page.evaluate(
        () =>
          (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls.filter(
            (call) => call.action === 'construct',
          ).length,
      ),
      1,
    );
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test('two rapid native scrubs retain the last target through a delayed receipt without replacing the iframe', async (t) => {
  const f = await fixture(t, 390, { initial: true, manualSampling: true });
  let release = () => {};
  try {
    const { page } = f;
    await videoReady(page);
    const native = page.frameLocator('.audio-stage iframe');
    await native.getByRole('button', { name: 'Seek video', exact: true }).waitFor();
    await page.waitForTimeout(1100);
    await page.evaluate(() =>
      (window as typeof window & { samplePlayer: () => void }).samplePlayer(),
    );
    release = f.holdNextMutation();
    const seek = native.getByRole('button', { name: 'Seek video', exact: true });
    for (const position of [42, 80]) {
      await seek.evaluate(
        (node, target) =>
          Object.assign((node as HTMLElement).dataset, {
            action: 'seek-event',
            position: String(target),
          }),
        position,
      );
      await seek.click();
    }
    assert.equal(f.writes.length, 1, 'only one write is in flight');
    release();
    await page.waitForFunction(() =>
      document.querySelector('.player-status')?.textContent?.includes('Following the shared clock'),
    );
    assert.deepEqual(
      f.writes.map((write) => [write.action, write.position]),
      [
        ['seek', 42],
        ['seek', 80],
      ],
    );
    assert.deepEqual(
      await page.evaluate(() =>
        (window as unknown as { __audioCalls: { action: string }[] }).__audioCalls
          .filter((call) => ['construct', 'load', 'cue', 'destroy'].includes(call.action))
          .map((call) => call.action),
      ),
      ['construct', 'load'],
    );
    assert.equal(
      await page.evaluate(() =>
        (window as unknown as { __playerState: () => number }).__playerState(),
      ),
      1,
    );
    assert.deepEqual(f.errors, []);
  } finally {
    release();
    await f.close();
  }
});
