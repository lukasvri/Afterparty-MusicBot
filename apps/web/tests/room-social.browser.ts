// Synthetic grants and an isolated SSE boundary; no live Discord or provider requests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import type { SocialState } from '../../../services/core/src/social.ts';
const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const code = 'TESTROOM',
  playbackKey = 'synthetic-playback';
for (const width of [1440, 390])
  test(`native room social reactions, moments and host bingo at ${width}px`, async () => {
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
    });
    page.setDefaultTimeout(12000);
    const errors: string[] = [],
      writes: Array<Record<string, unknown>> = [];
    let joins = 0;
    const social: SocialState = {
      scope: 'room',
      scopeId: code,
      playbackKey,
      revision: 5,
      enabled: true,
      reactions: [],
      highlights: [],
      bingo: null,
    };
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(
      ({ code }) => {
        localStorage.setItem(`afterparty-host:${code}`, 'a'.repeat(64));
        const original = window.fetch;
        window.fetch = async (input, init) => {
          const value =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (!value.endsWith('/api/social/stream')) return original(input, init);
          return new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener(
                  'abort',
                  () => {
                    try {
                      controller.close();
                    } catch {
                      /* retired */
                    }
                  },
                  { once: true },
                );
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } },
          );
        };
      },
      { code },
    );
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/rooms/${code}`)
        return route.fulfill({
          json: {
            code,
            playbackKey,
            name: 'Synthetic social room',
            current: {
              id: 'synthetic01',
              title: 'Synthetic soundtrack',
              artist: 'Test artist',
              duration: 240,
              live: false,
              image: '',
              embeddable: true,
            },
            queue: [],
            playing: false,
            position: 32,
            version: 1,
            serverTime: Date.now(),
            viewers: 3,
            isHost: true,
            isOwner: true,
            expiresAt: Date.now() + 3600000,
          },
        });
      if (path === '/api/social') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        assert.equal(body.scopeId, code);
        assert.equal(body.scope, 'room');
        assert.equal(body.playbackKey, playbackKey);
        assert.equal(route.request().headers().authorization, `Bearer ${'a'.repeat(64)}`);
        if (body.action === 'join') {
          joins++;
          return route.fulfill({
            json: { social, token: 'synthetic.scoped-grant', canManage: true },
          });
        }
        if (body.action === 'read') return route.fulfill({ json: { social, canManage: true } });
        writes.push(body);
        assert.equal(body.token, 'synthetic.scoped-grant');
        assert.equal(body.revision, social.revision);
        if (body.action === 'reaction')
          social.reactions.push({
            id: String(body.eventId),
            emoji: String(body.emoji),
            at: Date.now(),
          });
        else if (body.action === 'highlight') {
          social.highlights.push({
            id: String(body.eventId),
            text: String(body.text),
            videoId: 'synthetic01',
            position: 32,
            at: Date.now(),
          });
          social.revision++;
        } else if (body.action === 'bingo-start') {
          social.bingo = { cells: body.cells as string[], marked: [], active: true };
          social.revision++;
        } else if (body.action === 'bingo-mark') {
          social.bingo!.marked.push(Number(body.cell));
          social.revision++;
        }
        return route.fulfill({ json: { social, canManage: true } });
      }
      if (path === '/api/history' || path === '/api/videos')
        return route.fulfill({ json: { videos: [] } });
      return route.fulfill({
        status: 503,
        json: { error: 'Synthetic unavailable optional endpoint' },
      });
    });
    try {
      await page.goto(`${origin}/v3?room=${code}`);
      const section = page.getByRole('region', { name: 'Games and extras' });
      await section.getByRole('button', { name: 'Open extras' }).click();
      await section.getByRole('button', { name: 'Fire', exact: true }).click();
      await section.getByRole('status').filter({ hasText: 'Reaction sent.' }).waitFor();
      await section.getByRole('button', { name: 'Shared moments', exact: true }).click();
      await section.getByLabel('What made this moment?').fill('The synthetic chorus');
      await section.getByRole('button', { name: 'Save this moment' }).click();
      const moment = section.getByRole('link', { name: /The synthetic chorus/ });
      await moment.waitFor();
      assert.equal(
        await moment.getAttribute('href'),
        'https://www.youtube.com/watch?v=synthetic01&t=32s',
      );
      await section.getByRole('button', { name: 'Concert bingo', exact: true }).click();
      await section.getByRole('button', { name: 'Create card', exact: true }).click();
      await section.getByRole('button', { name: 'Start card', exact: true }).click();
      await section.getByRole('button', { name: /01\s*Opening song/ }).click();
      await page.waitForFunction(
        () => document.querySelector('.bingo-grid button')?.getAttribute('aria-pressed') === 'true',
      );
      assert.equal(
        await section.getByRole('button', { name: /Opening song/ }).getAttribute('aria-pressed'),
        'true',
      );
      await page.waitForTimeout(1200);
      assert.equal(joins, 1, 'polling the same playback must not recreate grants');
      assert.deepEqual(
        writes.map((write) => write.action),
        ['reaction', 'highlight', 'bingo-start', 'bingo-mark'],
      );
      assert.equal(new Set(writes.map((write) => write.eventId)).size, 4);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await section.screenshot({ path: `/tmp/v3-social-${width}.png` });
      await section.getByRole('button', { name: 'Close extras' }).click();
      assert.equal(await section.getByRole('button', { name: 'Fire', exact: true }).count(), 0);
    } finally {
      await browser.close();
    }
  });
