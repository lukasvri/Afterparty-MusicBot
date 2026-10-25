// Local player calibration uses synthetic room/Core state and an official-player boundary.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const guildId = '123456789012345678';
type Call = {
  action: string;
  position?: number;
  controls?: number;
  disablekb?: number;
  rate?: number;
};
type Probe = {
  calls: Call[];
  player?: { position: number; state: number; rate: number; level: number; muted: boolean };
  staleAudio: boolean;
  audioReads: number;
  audioWrites: number;
  stateChanged?: (value: number) => void;
  rateChanged?: (value: number) => void;
  emit?: (value: unknown) => void;
  throwDestroy: boolean;
};
type ProbeWindow = Window & { __audioSettings: Probe };
for (const mode of ['room', 'discord'] as const) {
  test(
    `saved ${mode} player settings migrate, sync and reload locally without shared commands`,
    { timeout: 20000 },
    async (context) => {
      const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_PATH,
        args: ['--no-sandbox'],
      });
      context.after(() => browser.close());
      const page = await browser.newPage({
        viewport: { width: 390, height: 1000 },
        reducedMotion: 'reduce',
      });
      const writes: string[] = [],
        errors: string[] = [],
        external: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('muse-sync-offset', '1.2');
        localStorage.setItem('muse-sync-mode-v1', 'stable');
        const probe: Probe = {
          calls: [],
          throwDestroy: false,
          staleAudio: false,
          audioReads: 0,
          audioWrites: 0,
        };
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (key === 'afterparty-audio') probe.audioWrites++;
          setItem.call(this, key, value);
        };
        (window as unknown as ProbeWindow).__audioSettings = probe;
        Object.defineProperty(window, 'EventSource', {
          value: class {
            readyState = 1;
            onopen: (() => void) | null = null;
            onmessage: ((event: { data: string }) => void) | null = null;
            onerror: (() => void) | null = null;
            constructor() {
              probe.emit = (value) =>
                this.onmessage?.({ data: JSON.stringify({ type: 'state', state: value }) });
              setTimeout(() => this.onopen?.(), 0);
            }
            close() {
              this.readyState = 2;
            }
          },
        });
        window.YT = {
          Player: class {
            position = 0;
            state = 2;
            rate = 1;
            level = 100;
            muted = false;
            rateCallback?: (event: { data: number }) => void;
            iframe: HTMLIFrameElement;
            constructor(
              element: HTMLElement,
              options: {
                playerVars: { controls: number; disablekb: number };
                events: {
                  onReady: () => void;
                  onStateChange?: (event: { data: number }) => void;
                  onPlaybackRateChange?: (event: { data: number }) => void;
                };
              },
            ) {
              probe.calls.push({ action: 'construct', ...options.playerVars });
              this.iframe = document.createElement('iframe');
              element.replaceWith(this.iframe);
              probe.player = this;
              probe.stateChanged = (value) => {
                this.state = value;
                options.events.onStateChange?.({ data: value });
              };
              probe.rateChanged = (value) => {
                this.rate = value;
                options.events.onPlaybackRateChange?.({ data: value });
              };
              this.rateCallback = options.events.onPlaybackRateChange;
              setTimeout(() => options.events.onReady(), 0);
            }
            cueVideoById(value: { startSeconds: number }) {
              this.position = value.startSeconds;
              this.state = 2;
              probe.calls.push({ action: 'cue', position: this.position });
            }
            loadVideoById(value: { startSeconds: number }) {
              this.position = value.startSeconds;
              this.state = 1;
              probe.calls.push({ action: 'load', position: this.position });
            }
            seekTo(value: number) {
              this.position = value;
              probe.calls.push({ action: 'seek', position: value });
            }
            playVideo() {
              this.state = 1;
              probe.calls.push({ action: 'play' });
            }
            pauseVideo() {
              this.state = 2;
              probe.calls.push({ action: 'pause' });
            }
            getCurrentTime() {
              return this.position;
            }
            getPlayerState() {
              return this.state;
            }
            setPlaybackRate(rate: number) {
              this.rate = rate;
              probe.calls.push({ action: 'rate', rate });
              this.rateCallback?.({ data: rate });
            }
            setVolume(value: number) {
              this.level = value;
            }
            mute() {
              this.muted = true;
            }
            unMute() {
              this.muted = false;
            }
            getVolume() {
              probe.audioReads++;
              return probe.staleAudio ? 100 : this.level;
            }
            isMuted() {
              return this.muted;
            }
            destroy() {
              probe.calls.push({ action: 'destroy' });
              if (probe.throwDestroy) {
                probe.throwDestroy = false;
                throw Error('Controlled stale iframe failure');
              }
              this.iframe.remove();
            }
          },
        } as unknown as NonNullable<Window['YT']>;
      });
      const video = {
        id: 'concert0001',
        title: 'Synthetic calibration song',
        artist: 'Fixture',
        duration: 180,
        image: '',
        live: false,
        embeddable: true,
        concert: true,
      };
      const state = {
        guildId,
        guildName: 'Fixture server',
        roomCode: 'DISCORD1',
        engine: 'gutta-krutt-core',
        epoch: 'calibration',
        sequence: 1,
        ready: true,
        connected: true,
        playing: false,
        position: 40,
        buffering: false,
        volume: 60,
        current: video,
        queue: [],
        queueRevision: 'queue-1',
        lastSeen: Date.now(),
        online: true,
        playbackKey: 'same-track',
      };
      await page.route('**/*', async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.origin !== origin) {
          external.push(url.href);
          return route.abort();
        }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (!['GET', 'HEAD'].includes(request.method())) {
          writes.push(url.pathname);
          return route.fulfill({ status: 403, json: { error: 'No writes expected' } });
        }
        if (url.pathname === '/api/rooms/TESTROOM')
          return route.fulfill({
            json: {
              code: 'TESTROOM',
              name: 'Synthetic calibration room',
              current: video,
              queue: [],
              playing: false,
              position: 40,
              version: 5,
              serverTime: Date.now(),
              viewers: 1,
              isHost: false,
              isPublic: false,
              expiresAt: Date.now() + 60000,
            },
          });
        if (url.pathname === '/api/discord') return route.fulfill({ json: { state } });
        if (url.pathname === '/api/discord/queue')
          return route.fulfill({
            json: { canManage: false, state: { revision: 'queue-1', queue: [] } },
          });
        if (url.pathname === '/api/realtime/clock')
          return route.fulfill({ json: { serverTime: Date.now() } });
        if (url.pathname === '/api/admin/guilds')
          return route.fulfill({ json: { authenticated: false, guilds: [] } });
        return route.fulfill({ status: 503, json: { error: 'Unused synthetic endpoint' } });
      });
      await page.goto(
        origin + (mode === 'room' ? '/?room=TESTROOM' : `/discord?guildId=${guildId}`),
      );
      await page
        .getByRole('heading', {
          name: mode === 'room' ? 'Synthetic calibration room' : video.title,
          exact: true,
        })
        .waitFor();
      if (mode === 'discord') {
        await page.waitForFunction(() =>
          Boolean((window as unknown as ProbeWindow).__audioSettings.emit),
        );
        await page.evaluate((state) => {
          const emit = () =>
            (window as unknown as ProbeWindow).__audioSettings.emit?.({
              ...state,
              serverTime: Date.now(),
            });
          emit();
          setInterval(emit, 1000);
        }, state);
      }
      await page.getByRole('button', { name: 'Enable room audio', exact: true }).waitFor();
      await page.getByText('Playback settings', { exact: true }).click();
      assert.equal(
        await page
          .getByRole('combobox', { name: 'Synchronization mode', exact: true })
          .inputValue(),
        'stable',
      );
      assert.equal(
        await page.getByRole('button', { name: 'Sync now', exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await page.getByRole('button', { name: 'Reload video', exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await page.evaluate(() => (window as unknown as ProbeWindow).__audioSettings.calls.length),
        0,
        'preferences do not enable audio',
      );
      assert.equal(
        await page.evaluate(() => (window as unknown as ProbeWindow).__audioSettings.audioReads),
        0,
      );
      await page.getByRole('button', { name: 'Enable room audio', exact: true }).click();
      const initialPosition = mode === 'discord' ? 41.2 : 40;
      await page.waitForFunction(
        (position) =>
          (window as unknown as ProbeWindow).__audioSettings.calls.some(
            (call) => call.action === 'cue' && call.position === position,
          ),
        initialPosition,
      );
      const calls = () =>
        page.evaluate(() => (window as unknown as ProbeWindow).__audioSettings.calls);
      assert.equal((await calls()).find((call) => call.action === 'construct')?.controls, 1);
      assert.equal((await calls()).find((call) => call.action === 'construct')?.disablekb, 1);
      await page.evaluate(() =>
        (window as unknown as ProbeWindow).__audioSettings.stateChanged?.(1),
      );
      assert.equal(
        await page.evaluate(() => (window as unknown as ProbeWindow).__audioSettings.player?.state),
        2,
        'official play cannot override a shared pause',
      );
      await page.evaluate(() =>
        (window as unknown as ProbeWindow).__audioSettings.rateChanged?.(2),
      );
      assert.equal(
        await page.evaluate(() => (window as unknown as ProbeWindow).__audioSettings.player?.rate),
        1,
        'official speed settings retain the shared playback rate',
      );
      if (mode === 'discord') {
        const slider = page.getByRole('slider', { name: 'Video timing adjustment', exact: true });
        assert.equal(await slider.inputValue(), '1.2');
        await page.evaluate(() => {
          (window as unknown as ProbeWindow).__audioSettings.player!.state = 3;
        });
        await slider.evaluate((input) => {
          (input as HTMLInputElement).value = '-2';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.getByRole('button', { name: 'Sync now', exact: true }).click();
        assert.equal(
          await page.evaluate(
            () => (window as unknown as ProbeWindow).__audioSettings.player?.position,
          ),
          41.2,
          'buffering rejects even forced local corrections',
        );
        await page.evaluate(() => {
          (window as unknown as ProbeWindow).__audioSettings.player!.state = 2;
        });
        await page.getByRole('button', { name: 'Sync now', exact: true }).click();
        await page.waitForFunction(
          () => (window as unknown as ProbeWindow).__audioSettings.player?.position === 38,
        );
        await page.evaluate(() => {
          localStorage.setItem('afterparty-sync-offset', '2.1');
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: 'afterparty-sync-offset',
              storageArea: localStorage,
            }),
          );
        });
        await page.waitForFunction(
          () => (window as unknown as ProbeWindow).__audioSettings.player?.position === 42.1,
        );
        await page.getByRole('button', { name: 'Reset video timing', exact: true }).click();
        await page.waitForFunction(
          () => (window as unknown as ProbeWindow).__audioSettings.player?.position === 40,
        );
        assert.equal(await slider.inputValue(), '0');
      } else
        assert.equal(
          await page.getByRole('slider', { name: 'Video timing adjustment', exact: true }).count(),
          0,
          'saved concert calibration does not offset own rooms',
        );
      await page
        .getByRole('combobox', { name: 'Synchronization mode', exact: true })
        .selectOption('precise');
      assert.equal(
        await page.evaluate(() => localStorage.getItem('afterparty-sync-mode-v1')),
        'precise',
      );
      await page.evaluate(() => {
        localStorage.setItem('afterparty-sync-mode-v1', 'stable');
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'afterparty-sync-mode-v1',
            storageArea: localStorage,
          }),
        );
      });
      await page.waitForFunction(() => {
        const select = document.querySelector('select[aria-label="Synchronization mode"]');
        return select instanceof HTMLSelectElement && select.value === 'stable';
      });
      await page.evaluate(() => {
        (window as unknown as ProbeWindow).__audioSettings.player!.position = 35;
      });
      await page.getByRole('button', { name: 'Sync now', exact: true }).click();
      await page.waitForFunction(
        () => (window as unknown as ProbeWindow).__audioSettings.player?.position === 40,
      );
      await page.evaluate(() => {
        (window as unknown as ProbeWindow).__audioSettings.throwDestroy = true;
      });
      await page.getByRole('button', { name: 'Reload video', exact: true }).click();
      await page.waitForFunction(
        () =>
          (window as unknown as ProbeWindow).__audioSettings.calls.filter(
            (call) => call.action === 'construct',
          ).length === 2,
      );
      assert.equal(
        await page.locator('.audio-stage iframe').count(),
        1,
        'reload removes even a broken old iframe',
      );
      await page.waitForFunction(
        () => (window as unknown as ProbeWindow).__audioSettings.player?.position === 40,
      );
      assert.equal(
        (await calls()).filter((call) => call.action === 'play').length,
        0,
        'reload keeps a shared pause',
      );
      const volume = page.getByRole('slider', { name: 'Volume on this device', exact: true });
      await volume.evaluate((input) => {
        (input as HTMLInputElement).value = '25';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.evaluate(() => {
        (window as unknown as ProbeWindow).__audioSettings.staleAudio = true;
      });
      await page.waitForTimeout(400);
      assert.equal(await volume.inputValue(), '25', 'stale iframe reads respect write settling');
      assert.equal(
        await page.evaluate(() => JSON.parse(localStorage.getItem('afterparty-audio')!).level),
        25,
      );
      await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__audioSettings;
        probe.staleAudio = false;
        probe.player!.level = 27;
        probe.player!.muted = true;
      });
      await page.waitForFunction(() => {
        const saved = localStorage.getItem('afterparty-audio');
        return saved && JSON.parse(saved).level === 27 && JSON.parse(saved).muted === true;
      });
      assert.equal(await volume.inputValue(), '27');
      assert.equal(
        await page
          .getByRole('button', { name: 'Unmute', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      );
      const savedWrites = await page.evaluate(
        () => (window as unknown as ProbeWindow).__audioSettings.audioWrites,
      );
      await page.waitForTimeout(1400);
      assert.equal(
        await page.evaluate(() => (window as unknown as ProbeWindow).__audioSettings.audioWrites),
        savedWrites,
        'unchanged iframe preferences do not write repeatedly',
      );
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    },
  );
}
