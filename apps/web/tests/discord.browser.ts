// Isolated synthetic public-concert UI. No live Core, Discord account or provider requests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const guildId = '123456789012345678';
const track = (id: string, title: string, concert = true) => ({
  id,
  entryId: id,
  title,
  artist: 'Synthetic artist',
  duration: 180,
  image: '',
  live: false,
  embeddable: true,
  concert,
});

for (const width of [1440, 390]) {
  test(`public concert keeps transport and votes scoped at ${width}px`, async () => {
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox'],
    });
    try {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: 'reduce',
      });
      const errors: string[] = [],
        external: string[] = [],
        writes: Record<string, unknown>[] = [];
      let playing = false;
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
          external.push(url.href);
          await route.abort();
          return;
        }
        if (!url.pathname.startsWith('/api/')) {
          await route.continue();
          return;
        }
        if (url.pathname === '/api/admin/guilds') {
          await route.fulfill({ json: { authenticated: false, guilds: [] } });
          return;
        }
        if (route.request().method() === 'POST') {
          const write = route.request().postDataJSON();
          writes.push(write);
          assert.equal(write.guildId, guildId);
          if (url.pathname === '/api/discord') {
            assert.equal(write.playbackKey, 'synthetic-playback');
            assert.equal(write.queueRevision, 'synthetic-transport');
            playing = write.action === 'resume';
            await route.fulfill({ json: { id: 'public:' + write.commandId, status: 'done' } });
            return;
          }
          assert.equal(write.revision, 'synthetic-queue');
        }
        if (url.pathname === '/api/discord/queue') {
          await route.fulfill({
            json: {
              canManage: false,
              state: {
                revision: 'synthetic-queue',
                queue: [
                  track(
                    'queued00001',
                    'An especially long shared concert title that must remain usable on a phone',
                  ),
                  track('private0001', 'Private track must never appear', false),
                ],
                voteCounts: {},
                requests: [],
                skipVotes: 0,
              },
            },
          });
          return;
        }
        if (url.pathname === '/api/discord') {
          await route.fulfill({
            json: {
              state: {
                guildId,
                guildName: 'Synthetic stage',
                ready: true,
                connected: true,
                playing,
                position: 20,
                volume: 60,
                current: track('current0001', 'Together after midnight'),
                queue: [],
                queueRevision: 'synthetic-transport',
                lastSeen: Date.now(),
                online: true,
                playbackKey: 'synthetic-playback',
              },
            },
          });
          return;
        }
        await route.fulfill({ status: 404, json: { error: 'Unexpected synthetic endpoint' } });
      });
      await page.goto(`${origin}/v3/discord?guildId=${guildId}`);
      await page.getByRole('heading', { name: 'Together after midnight' }).waitFor();
      assert.equal(await page.getByText('Private track must never appear').count(), 0);
      assert.equal(await page.getByRole('button', { name: /^Remove / }).count(), 0);
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
      await page.getByRole('button', { name: /^Vote for An especially/ }).click();
      await page
        .getByRole('button', { name: /^Vote for An especially/ })
        .waitFor({ state: 'visible' });
      await page.waitForFunction(
        () =>
          !(document.querySelector('button[aria-label^="Vote for"]') as HTMLButtonElement)
            ?.disabled,
      );
      assert.equal(writes.filter((write) => write.action === 'resume').length, 1);
      assert.equal(writes.filter((write) => write.action === 'vote').length, 1);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
    }
  });
}

test('browser concert audio requires consent and follows fresh Core SSE without issuing recovery commands', async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 1000 },
      reducedMotion: 'reduce',
    });
    const errors: string[] = [],
      writes: unknown[] = [],
      external: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      type Calls = Array<{ action: string; position?: number }>;
      const scope = window as unknown as {
        __calls: Calls;
        __emit?: (state: unknown) => void;
        __disconnect?: () => void;
        __streamPath?: string;
        __closedStreams: number;
      };
      scope.__calls = [];
      scope.__closedStreams = 0;
      Object.defineProperty(window, 'EventSource', {
        value: class {
          static CLOSED = 2;
          readyState = 1;
          onopen: (() => void) | null = null;
          onmessage: ((event: { data: string }) => void) | null = null;
          onerror: (() => void) | null = null;
          constructor(path: string) {
            scope.__streamPath = path;
            scope.__emit = (state) =>
              this.onmessage?.({ data: JSON.stringify({ type: 'state', state }) });
            scope.__disconnect = () => this.onerror?.();
            setTimeout(() => this.onopen?.(), 0);
          }
          close() {
            this.readyState = 2;
            scope.__closedStreams++;
          }
        },
      });
      Object.defineProperty(window, 'YT', {
        value: {
          Player: class {
            position = 0;
            state = 2;
            constructor(_container: HTMLElement, options: { events: { onReady: () => void } }) {
              scope.__calls.push({ action: 'construct' });
              setTimeout(() => options.events.onReady(), 0);
            }
            loadVideoById(value: { startSeconds: number }) {
              this.position = value.startSeconds;
              this.state = 1;
              scope.__calls.push({ action: 'load', position: this.position });
            }
            cueVideoById(value: { startSeconds: number }) {
              this.position = value.startSeconds;
              this.state = 2;
              scope.__calls.push({ action: 'cue', position: this.position });
            }
            playVideo() {
              this.state = 1;
              scope.__calls.push({ action: 'play' });
            }
            pauseVideo() {
              this.state = 2;
              scope.__calls.push({ action: 'pause' });
            }
            seekTo(position: number) {
              this.position = position;
              scope.__calls.push({ action: 'seek', position });
            }
            getCurrentTime() {
              return this.position;
            }
            getPlayerState() {
              return this.state;
            }
            setVolume() {}
            mute() {}
            unMute() {}
            destroy() {
              scope.__calls.push({ action: 'destroy' });
            }
          },
        },
      });
    });
    const snapshot = {
      guildId,
      guildName: 'Synthetic stage',
      roomCode: 'DISCORD1',
      ready: true,
      connected: true,
      playing: false,
      position: 20,
      volume: 50,
      current: track('concert0001', 'Synchronized concert'),
      queue: [],
      queueRevision: 'queue-1',
      lastSeen: Date.now(),
      online: true,
      playbackKey: 'playback-1',
    };
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        external.push(url.href);
        await route.abort();
        return;
      }
      if (!url.pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }
      if (route.request().method() === 'POST') {
        writes.push(route.request().postDataJSON());
        await route.fulfill({ status: 500, json: { error: 'No writes expected' } });
        return;
      }
      if (url.pathname === '/api/realtime/clock') {
        await route.fulfill({ json: { serverTime: Date.now() } });
        return;
      }
      if (url.pathname === '/api/discord/queue') {
        await route.fulfill({
          json: { canManage: false, state: { revision: 'queue-1', queue: [] } },
        });
        return;
      }
      if (url.pathname === '/api/discord') {
        await route.fulfill({ json: { state: snapshot } });
        return;
      }
      if (url.pathname === '/api/admin/guilds') {
        await route.fulfill({ json: { guilds: [] } });
        return;
      }
      await route.fulfill({ status: 404, json: { error: 'Unexpected endpoint' } });
    });
    await page.goto(`${origin}/v3/discord?guildId=${guildId}`);
    await page.getByRole('heading', { name: 'Synchronized concert' }).waitFor();
    await page.waitForFunction(() => Boolean((window as unknown as { __emit?: unknown }).__emit));
    assert.equal(await page.getByRole('button', { name: 'Enable room audio' }).count(), 0);
    const emit = async (sequence: number, playing: boolean, position: number) =>
      page.evaluate(
        ({ snapshot, sequence, playing, position }) => {
          (window as unknown as { __emit: (state: unknown) => void }).__emit({
            ...snapshot,
            engine: 'gutta-krutt-core',
            epoch: 'epoch-1',
            sequence,
            playing,
            position,
            serverTime: Date.now(),
            buffering: false,
          });
        },
        { snapshot, sequence, playing, position },
      );
    await emit(1, true, 25);
    await page.getByRole('button', { name: 'Enable room audio' }).waitFor();
    assert.deepEqual(
      await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls),
      [],
    );
    await page.getByRole('button', { name: 'Enable room audio' }).click();
    await page.waitForFunction(() =>
      (window as unknown as { __calls: Array<{ action: string }> }).__calls.some(
        (call) => call.action === 'load',
      ),
    );
    const started = await page.evaluate(
      () =>
        (
          window as unknown as { __calls: Array<{ action: string; position?: number }> }
        ).__calls.find((call) => call.action === 'load')?.position,
    );
    assert(started !== undefined && started >= 25 && started < 27);
    await emit(2, false, 30);
    await page.waitForFunction(() =>
      (window as unknown as { __calls: Array<{ action: string }> }).__calls.some(
        (call) => call.action === 'pause',
      ),
    );
    await emit(3, true, 31);
    await page.waitForFunction(() =>
      (window as unknown as { __calls: Array<{ action: string }> }).__calls.some(
        (call) => call.action === 'play',
      ),
    );
    await page.evaluate(() => (window as unknown as { __disconnect: () => void }).__disconnect());
    await page.waitForFunction(() =>
      (window as unknown as { __calls: Array<{ action: string }> }).__calls.some(
        (call) => call.action === 'destroy',
      ),
    );
    assert.equal(await page.getByRole('button', { name: 'Enable room audio' }).count(), 0);
    await emit(4, false, 40);
    await page.getByRole('button', { name: 'Enable room audio' }).waitFor();
    await page.getByRole('button', { name: 'Enable room audio' }).click();
    await page.waitForFunction(() =>
      (window as unknown as { __calls: Array<{ action: string }> }).__calls.some(
        (call) => call.action === 'cue',
      ),
    );
    assert.equal(
      await page.evaluate(() => (window as unknown as { __streamPath: string }).__streamPath),
      '/api/realtime/stream?guildId=' + guildId,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  } finally {
    await browser.close();
  }
});
