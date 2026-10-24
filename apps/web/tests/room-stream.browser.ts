// A real browser EventSource talks to a loopback synthetic Core protocol fixture.
// Only the official player boundary is simulated. No provider or Discord is contacted.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { Room, Video } from '../../../lib/types.ts';

const preview = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(preview).hostname));
const code = 'SSELIVE1',
  token = 'b'.repeat(64),
  visitor = 'a'.repeat(32);
const track = (id: string, title: string): Video => ({
  id,
  title,
  artist: 'Synthetic live ensemble',
  image: '',
  duration: 240,
  live: false,
  embeddable: true,
});

async function liveFixture() {
  let version = 1,
    playing = false,
    updatedAt = Date.now();
  let current = track('stream00001', 'Before the stream');
  let holdReads = false,
    broadcast = true,
    acceptStreams = true,
    hostAccess = true;
  let successfulReads = 0,
    clockReads = 0;
  const writes: { action: string; version: number }[] = [];
  const streams = new Set<ServerResponse>();
  const held = new Map<ServerResponse, boolean>();
  const errors: string[] = [];
  const snapshot = (authenticated: boolean): Room => ({
    code,
    name: 'Synthetic live listening',
    version,
    playing,
    current,
    queue: [],
    position: 12 + (playing ? (Date.now() - updatedAt) / 1000 : 0),
    serverTime: Date.now(),
    viewers: 2,
    isHost: authenticated && hostAccess,
    isOwner: authenticated && hostAccess,
    isPublic: false,
    expiresAt: Date.now() + 3600000,
    syncSource: 'live',
    syncEpoch: 'synthetic-browser-epoch',
    syncValidForMs: 5000,
    playbackKey: `synthetic-playback-${current.id}`,
  });
  const json = (response: ServerResponse, value: unknown, status = 200) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  const send = () => {
    if (!broadcast) return;
    // Even an incorrect public role flag must never replace authenticated roles.
    const room = { ...snapshot(false), isHost: true, isOwner: true, isPublic: true, viewers: 999 };
    for (const response of streams)
      response.write(`data: ${JSON.stringify({ type: 'room', room })}\n\n`);
  };
  const server = createServer(async (request, response) => {
    if (!request.url?.startsWith('/') || request.url.startsWith('//'))
      return json(response, { error: 'Only relative fixture paths are accepted' }, 400);
    const url = new URL(request.url, 'http://127.0.0.1');
    try {
      if (url.pathname === '/api/realtime/clock') {
        clockReads++;
        return json(response, { serverTime: Date.now() });
      }
      if (url.pathname === '/api/realtime/stream') {
        if (!acceptStreams) return json(response, { error: 'Synthetic stream outage' }, 503);
        assert.equal(url.searchParams.get('room'), code);
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        response.flushHeaders();
        response.write(': synthetic stream connected\n\n');
        streams.add(response);
        response.on('close', () => streams.delete(response));
        return;
      }
      if (url.pathname === `/api/rooms/${code}`) {
        assert.equal(request.headers['x-afterparty-visitor'], visitor);
        const authenticated = request.headers.authorization === `Bearer ${token}`;
        if (request.method === 'GET') {
          if (holdReads) {
            held.set(response, authenticated);
            response.on('close', () => held.delete(response));
            return;
          }
          successfulReads++;
          return json(response, snapshot(authenticated));
        }
        let body = '';
        for await (const chunk of request) body += chunk;
        const input = JSON.parse(body) as { action: string; version: number };
        writes.push(input);
        if (!authenticated || !hostAccess)
          return json(response, { error: 'Host access required' }, 403);
        if (input.version !== version)
          return json(response, { error: 'Synthetic revision conflict' }, 409);
        if (!['play', 'pause'].includes(input.action))
          return json(response, { error: 'Unexpected action' }, 400);
        version++;
        playing = input.action === 'play';
        updatedAt = Date.now();
        send();
        return json(response, { room: snapshot(authenticated) });
      }
      if (url.pathname.startsWith('/api/'))
        return json(response, { error: 'Unused synthetic endpoint' }, 404);
      // Serve the built candidate unchanged. All application API traffic stays here.
      const target = new URL(preview);
      target.pathname = url.pathname;
      target.search = url.search;
      const upstream = await fetch(target, {
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      const headers = Object.fromEntries(upstream.headers);
      for (const key of ['content-encoding', 'content-length', 'transfer-encoding', 'connection'])
        delete headers[key];
      response.writeHead(upstream.status, headers);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      json(response, { error: 'Synthetic fixture failure' }, 500);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const heartbeat = setInterval(send, 200);
  return {
    origin,
    writes,
    errors,
    get streams() {
      return streams.size;
    },
    get clockReads() {
      return clockReads;
    },
    get successfulReads() {
      return successfulReads;
    },
    get heldReads() {
      return held.size;
    },
    hold() {
      holdReads = true;
    },
    release() {
      holdReads = false;
      for (const [response, authenticated] of held) {
        successfulReads++;
        json(response, snapshot(authenticated));
      }
      held.clear();
    },
    advance(id: string, title: string, nextPlaying: boolean) {
      version++;
      current = track(id, title);
      playing = nextPlaying;
      updatedAt = Date.now();
      send();
    },
    silence() {
      broadcast = false;
    },
    disconnect() {
      broadcast = false;
      acceptStreams = false;
      for (const response of streams) response.end();
    },
    revokeOwner() {
      hostAccess = false;
    },
    async close() {
      clearInterval(heartbeat);
      for (const response of streams) response.end();
      for (const response of held.keys()) response.end();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

async function prepare(context: BrowserContext, owner: boolean, origin: string) {
  const errors: string[] = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await page.addInitScript(
    ({ code, token, visitor, owner }) => {
      localStorage.setItem('afterparty-visitor', visitor);
      if (owner) localStorage.setItem(`afterparty-host:${code}`, token);
      const calls: string[] = [];
      Object.assign(window, {
        __streamAudioCalls: calls,
        YT: {
          Player: class {
            position = 0;
            state = 2;
            constructor(_element: HTMLElement, options: { events: { onReady: () => void } }) {
              Object.assign(window, { __streamPlayer: this });
              setTimeout(() => options.events.onReady(), 0);
            }
            loadVideoById(value: { videoId: string; startSeconds: number }) {
              this.position = value.startSeconds;
              this.state = 1;
              calls.push(`load:${value.videoId}`);
            }
            cueVideoById(value: { videoId: string; startSeconds: number }) {
              this.position = value.startSeconds;
              this.state = 2;
              calls.push(`cue:${value.videoId}`);
            }
            playVideo() {
              this.state = 1;
              calls.push('play');
            }
            pauseVideo() {
              this.state = 2;
              calls.push('pause');
            }
            seekTo(position: number) {
              this.position = position;
            }
            getCurrentTime() {
              return this.position;
            }
            getPlayerState() {
              return this.state;
            }
            destroy() {
              calls.push('destroy');
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
        },
      });
    },
    { code, token, visitor, owner },
  );
  await page.goto(`${origin}/v3?room=${code}`);
  await page.getByRole('heading', { name: 'Synthetic live listening', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Enable room audio', exact: true }).click();
  return { page, errors };
}
async function waitFor(predicate: () => boolean, description: string) {
  const deadline = Date.now() + 10000;
  while (!predicate() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert(predicate(), description);
}
async function played(page: Page, id: string) {
  try {
    await page.waitForFunction(
      (id) =>
        (window as unknown as { __streamAudioCalls: string[] }).__streamAudioCalls.some(
          (call) => call === `load:${id}` || call === `cue:${id}`,
        ) &&
        (window as unknown as { __streamPlayer?: { state: number } }).__streamPlayer?.state === 1,
      id,
      { timeout: 8000 },
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      calls: (window as unknown as { __streamAudioCalls: string[] }).__streamAudioCalls,
      text: document.body.innerText,
    }));
    throw new Error(`Synthetic playback did not load ${id}: ${JSON.stringify(state)}`, {
      cause: error,
    });
  }
}

test(
  'native browser SSE synchronizes two clients, preserves roles and stops expired audio without replay',
  { timeout: 60000 },
  async () => {
    const fixture = await liveFixture();
    const browser = await chromium
      .launch({
        headless: true,
        executablePath: process.env.CHROMIUM_PATH,
        args: ['--no-sandbox'],
      })
      .catch(async (error) => {
        await fixture.close();
        throw error;
      });
    try {
      const host = await prepare(
        await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
        true,
        fixture.origin,
      );
      const guest = await prepare(
        await browser.newContext({ viewport: { width: 390, height: 844 } }),
        false,
        fixture.origin,
      );
      await waitFor(
        () => fixture.streams === 2 && fixture.clockReads >= 2,
        'both browsers opened a native SSE stream and sampled the server clock',
      );
      fixture.hold();
      await waitFor(() => fixture.heldReads >= 2, 'authenticated polling is held for both clients');
      const readsBeforeStream = fixture.successfulReads;
      fixture.advance('stream00002', 'Only the stream knows this song', true);
      await Promise.all([played(host.page, 'stream00002'), played(guest.page, 'stream00002')]);
      assert.equal(
        fixture.successfulReads,
        readsBeforeStream,
        'new playback reached both clients exclusively through the real SSE response',
      );
      assert.equal(
        await host.page.getByRole('button', { name: 'Pause playback' }).isEnabled(),
        true,
      );
      assert.equal(
        await guest.page.getByRole('button', { name: 'Pause playback' }).isDisabled(),
        true,
      );
      await host.page.getByRole('button', { name: 'Room settings', exact: true }).click();
      await guest.page.getByRole('button', { name: 'Room settings', exact: true }).click();
      assert.equal(
        await host.page.getByRole('button', { name: 'Invite a co-host', exact: true }).isVisible(),
        true,
      );
      assert.equal(
        await guest.page.getByRole('button', { name: 'Invite a co-host', exact: true }).count(),
        0,
        'public stream fields cannot grant owner access',
      );
      await host.page.getByRole('button', { name: 'Pause playback' }).click();
      await host.page.getByRole('button', { name: 'Resume playback' }).waitFor();
      await guest.page.getByRole('button', { name: 'Resume playback' }).waitFor();
      await host.page.getByRole('button', { name: 'Resume playback' }).click();
      await guest.page.getByRole('button', { name: 'Pause playback' }).waitFor();
      assert.deepEqual(
        fixture.writes.map((write) => [write.action, write.version]),
        [
          ['pause', 2],
          ['play', 3],
        ],
      );

      fixture.advance('stream00003', 'The last leased frame', true);
      await Promise.all([played(host.page, 'stream00003'), played(guest.page, 'stream00003')]);
      for (const { page } of [host, guest])
        await page.evaluate(() => {
          (window as unknown as { __streamAudioCalls: string[] }).__streamAudioCalls.length = 0;
        });
      fixture.silence();
      // The TCP stream stays open. Its final lease must expire without an error event.
      await Promise.all(
        [host, guest].map(({ page }) =>
          page.waitForFunction(
            () =>
              (window as unknown as { __streamAudioCalls: string[] }).__streamAudioCalls.includes(
                'pause',
              ),
            undefined,
            { timeout: 8000 },
          ),
        ),
      );
      for (const { page } of [host, guest])
        await page.getByText('Reconnecting…', { exact: true }).waitFor();
      assert.equal(
        fixture.writes.length,
        2,
        'lease recovery never emits play, pause or next commands',
      );
      fixture.disconnect();
      fixture.advance('stream00003', 'The last leased frame', false);
      fixture.release();
      for (const { page } of [host, guest]) {
        await page.getByText('Connected', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Resume playback' }).waitFor();
      }
      fixture.revokeOwner();
      await host.page
        .getByRole('button', { name: 'Invite a co-host', exact: true })
        .waitFor({ state: 'detached' });
      assert.equal(
        await host.page.getByRole('button', { name: 'Resume playback' }).isDisabled(),
        true,
        'polling independently refreshes revoked owner and host permissions',
      );
      assert.equal(fixture.writes.length, 2);
      assert.deepEqual(host.errors, []);
      assert.deepEqual(guest.errors, []);
      assert.deepEqual(fixture.errors, []);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

// Absolute-form request targets must never replace the fixture's loopback upstream.
test('the loopback SSE fixture rejects external request targets before forwarding', async (context) => {
  const fixture = await liveFixture();
  context.after(() => fixture.close());
  for (const path of ['http://outside.invalid/v3', '//outside.invalid/v3']) {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = httpRequest(new URL(fixture.origin), { method: 'GET', path }, (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      });
      outgoing.once('error', reject);
      outgoing.end();
    });
    assert.equal(status, 400);
  }
  assert.deepEqual(fixture.errors, []);
});
