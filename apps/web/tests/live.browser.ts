// Native EventSource against a loopback HTTP fixture, two isolated browser contexts.
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { chromium, type Browser } from 'playwright';
import type { Room } from '../../../lib/types.ts';

const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const code = 'TESTROOM',
  token = 'b'.repeat(64);

test(
  'two clients share live transport, retain host rights and recover without replaying playback',
  { timeout: 45000 },
  async (context) => {
    let version = 1,
      position = 12,
      playing = true,
      epoch = 'synthetic-core-a',
      title = 'Shared live soundtrack',
      streaming = true,
      unavailable = false,
      reads = 0,
      heartbeats = 0;
    const peers = new Set<ServerResponse>(),
      writes: { action: string; version: number }[] = [];
    const snapshot = (host = false): Room => ({
      code,
      name: 'Synthetic live room',
      current: {
        id: 'current0001',
        title,
        artist: 'Synthetic artist',
        duration: 240,
        image: '',
        live: false,
        embeddable: true,
      },
      queue: [],
      playing,
      position,
      version,
      serverTime: Date.now(),
      viewers: 2,
      isHost: host,
      isOwner: host,
      isPublic: false,
      expiresAt: Date.now() + 3600000,
      syncSource: 'live',
      syncEpoch: epoch,
      syncValidForMs: 5000,
    });
    const broadcast = (room = snapshot()) => {
      for (const peer of peers) peer.write(`data: ${JSON.stringify({ type: 'room', room })}\n\n`);
    };
    const server = createServer(async (request, response) => {
      const url = new URL(request.url!, 'http://127.0.0.1');
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader(
        'Access-Control-Allow-Headers',
        'authorization,content-type,x-afterparty-visitor',
      );
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      const json = (body: unknown, status = 200) => {
        response.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify(body));
      };
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (url.pathname === '/api/realtime/clock') return json({ serverTime: Date.now() });
      if (url.pathname === '/api/realtime/stream' && url.searchParams.get('room') === code) {
        if (!streaming) return json({ error: 'Synthetic stream unavailable' }, 503);
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
        });
        response.flushHeaders();
        peers.add(response);
        response.on('close', () => peers.delete(response));
        response.write(`data: ${JSON.stringify({ type: 'room', room: snapshot() })}\n\n`);
        return;
      }
      if (url.pathname !== `/api/rooms/${code}`)
        return json({ error: 'Unknown synthetic route' }, 404);
      const host = request.headers.authorization === `Bearer ${token}`;
      if (request.method === 'GET') {
        reads++;
        return unavailable
          ? json({ error: 'Synthetic connection loss' }, 503)
          : json(snapshot(host));
      }
      if (!host) return json({ error: 'Only the host can control playback.' }, 403);
      let body = '';
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body) as { action: string; version: number; position?: number };
      if (input.version !== version) return json({ error: 'The room changed.' }, 409);
      writes.push(input);
      if (input.action === 'pause') playing = false;
      else if (input.action === 'play') playing = true;
      else if (input.action === 'seek') position = input.position!;
      else return json({ error: 'Unknown synthetic command' }, 400);
      version++;
      broadcast();
      return json({ room: snapshot(host) });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address !== 'string');
    const api = `http://127.0.0.1:${address.port}`;
    const heartbeat = setInterval(() => {
      heartbeats++;
      broadcast();
    }, 1000);
    const resources: { browser?: Browser } = {};
    context.after(async () => {
      clearInterval(heartbeat);
      await resources.browser?.close();
      for (const peer of peers) peer.end();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox'],
    });
    resources.browser = browser;
    const errors: string[] = [],
      external: string[] = [];
    const pages = [];
    for (const [index, width] of [1440, 390].entries()) {
      const browserContext = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await browserContext.newPage();
      pages.push(page);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(
        ({ code, token, host }) => {
          localStorage.setItem('afterparty-visitor', (host ? 'a' : 'c').repeat(32));
          if (host) localStorage.setItem(`afterparty-host:${code}`, token);
        },
        { code, token, host: index === 0 },
      );
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
          external.push(url.origin);
          return route.abort();
        }
        return url.pathname.startsWith('/api/')
          ? route.continue({ url: api + url.pathname + url.search })
          : route.continue();
      });
      await page.goto(`${origin}/v3?room=${code}`);
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await page.locator('.top-status').getByText('Live', { exact: true }).waitFor();
    }
    const [host, guest] = pages;
    assert.equal(peers.size, 2, 'each isolated browser owns one real SSE connection');
    assert.equal(await host.getByRole('button', { name: 'Pause playback' }).isEnabled(), true);
    assert.equal(await guest.getByRole('button', { name: 'Pause playback' }).isEnabled(), false);
    const initialReads = reads,
      initialBeats = heartbeats;
    await host.waitForTimeout(2100);
    assert(heartbeats >= initialBeats + 2);
    assert.equal(reads, initialReads, 'fresh live updates replace one-second room polling');

    await host.getByRole('button', { name: 'Pause playback' }).click();
    await guest.getByRole('button', { name: 'Resume playback' }).waitFor();
    assert.equal(await guest.getByRole('button', { name: 'Resume playback' }).isEnabled(), false);
    assert.deepEqual(
      writes.map((write) => write.action),
      ['pause'],
    );

    const oldEpoch = snapshot();
    epoch = 'synthetic-core-b';
    version = 1;
    title = 'After the synthetic Core restart';
    broadcast();
    for (const page of pages)
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
    broadcast({
      ...oldEpoch,
      version: 99,
      current: { ...oldEpoch.current!, title: 'Retired epoch' },
    });
    await host.waitForTimeout(100);
    for (const page of pages) assert.equal(await page.getByText('Retired epoch').count(), 0);

    await guest.getByRole('button', { name: 'Leave room', exact: true }).click();
    await host.waitForTimeout(200);
    assert.equal(peers.size, 1, 'leaving closes the guest stream while the host stays connected');
    version++;
    title = 'The host keeps listening';
    broadcast();
    await host.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.equal(await guest.getByText(title, { exact: true }).count(), 0);
    await guest.getByRole('textbox', { name: 'Room code', exact: true }).fill(code);
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await guest.getByRole('heading', { name: title, exact: true }).waitFor();
    await guest.locator('.top-status').getByText('Live', { exact: true }).waitFor();
    assert.equal(peers.size, 2, 'rejoining owns exactly one new stream');

    streaming = false;
    for (const peer of peers) peer.end();
    version++;
    title = 'Fallback keeps the shared room';
    for (const page of pages) {
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await page.locator('.top-status').getByText('Connected', { exact: true }).waitFor();
    }
    assert(reads > initialReads, 'stream loss resumes authenticated polling');
    unavailable = true;
    await host.getByRole('alert').filter({ hasText: 'Synthetic connection loss' }).waitFor();
    assert.equal(await host.getByRole('button', { name: 'Resume playback' }).isEnabled(), false);
    unavailable = false;
    await host.locator('.top-status').getByText('Connected', { exact: true }).waitFor();
    assert.equal(await host.getByRole('button', { name: 'Resume playback' }).isEnabled(), true);
    assert.equal(playing, false, 'recovery respects the earlier explicit pause');
    assert.deepEqual(
      writes.map((write) => write.action),
      ['pause'],
      'recovery sends no playback writes',
    );

    for (const page of pages)
      await page.getByRole('button', { name: 'Leave room', exact: true }).click();
    await host.waitForTimeout(200);
    assert.equal(peers.size, 0, 'no stream remains after leaving');
    const readsAfterLeave = reads;
    await host.waitForTimeout(1300);
    assert.equal(reads, readsAfterLeave, 'leaving stops fallback polling too');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, [], 'no provider or non-loopback network is used');
  },
);
