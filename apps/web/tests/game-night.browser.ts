// A shared, synthetic game exercises real host/guest pages without providers or Discord.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, type Page } from 'playwright';
import type { GameResponse } from '../src/lib/game-client.ts';
import type { Room } from '../../../lib/types.ts';
const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const code = 'GAMENITE',
  owner = 'd'.repeat(64);
const refresh = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('online')));

test(
  'a new game night takes one host action, shares a guest invite and keeps every round focused',
  { timeout: 45000 },
  async (context) => {
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox'],
    });
    context.after(() => browser.close());
    const host = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      reducedMotion: 'reduce',
    });
    const guest = await browser.newPage({
      viewport: { width: 390, height: 1000 },
      reducedMotion: 'reduce',
    });
    const errors: string[] = [],
      writes: Array<{ role: string; action: string; revision: number }> = [];
    let creates = 0;
    const data: GameResponse = {
      canManage: true,
      token: 'host-game-grant',
      sourceState: 'ready',
      mediaAvailable: false,
      self: { participantId: 'host', result: null, skipVoted: false },
      game: {
        scope: 'room',
        scopeId: code,
        sessionId: '11111111-1111-4111-8111-111111111111',
        gameId: 'party',
        revision: 1,
        phase: 'lobby',
        serverTime: Date.now(),
        categoryId: 'party',
        settings: {
          durationSeconds: 30,
          roundCount: 5,
          maxPoints: 1000,
          minPoints: 100,
          hints: true,
          answerMode: 'title',
        },
        categories: [
          {
            id: 'party',
            name: 'Party favourites',
            available: true,
            count: 8,
            durations: [{ seconds: 30, count: 8 }],
          },
        ],
        roundNumber: 0,
        round: null,
        scoreboard: [{ id: 'host', nickname: 'Alex', total: 0, hasAnswered: false }],
        answeredCount: 0,
      },
    };
    const feedback = new Map<string, { correct: boolean; awarded: number }>();
    const beginRound = () => {
      data.game.roundNumber++;
      data.game.phase = 'round';
      data.game.answeredCount = 0;
      feedback.clear();
      data.game.scoreboard.forEach((player) => {
        player.hasAnswered = false;
      });
      data.game.round = {
        roundId: `round-${data.game.roundNumber}`,
        startsAt: Date.now() - 500,
        deadline: Date.now() + data.game.settings.durationSeconds * 1000 - 500,
        hints: {},
        skipVotes: 0,
        skipRequired: 2,
      };
    };
    for (const [page, role] of [
      [host, 'host'],
      [guest, 'guest'],
    ] as const) {
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/api/**', async (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        const input = request.method() === 'POST' ? request.postDataJSON() : null;
        if (path === '/api/rooms' && input) {
          assert.equal(role, 'host');
          creates++;
          return route.fulfill({
            json: {
              token: owner,
              room: {
                code,
                name: 'Game night',
                current: null,
                queue: [],
                playing: false,
                position: 0,
                version: 1,
                serverTime: Date.now(),
                viewers: 1,
                isHost: false,
                isOwner: false,
                isPublic: false,
                expiresAt: Date.now() + 3600000,
              } satisfies Room,
            },
          });
        }
        if (path === `/api/rooms/${code}`) {
          assert.equal(request.headers().authorization, `Bearer ${owner}`);
          return route.fulfill({
            json: {
              code,
              name: 'Game night',
              current: null,
              queue: [],
              playing: false,
              position: 0,
              version: 1,
              serverTime: Date.now(),
              viewers: 1,
              isHost: true,
              isOwner: true,
              isPublic: false,
              expiresAt: Date.now() + 3600000,
            } satisfies Room,
          });
        }
        assert.equal(path, '/api/guess', 'Game actions never control music');
        assert.equal(input.scopeId, code);
        if (
          input.action === 'join' &&
          role === 'guest' &&
          !data.game.scoreboard.some((player) => player.id === 'guest')
        ) {
          data.game.revision++;
          data.game.scoreboard.push({
            id: 'guest',
            nickname: 'Blair',
            total: 0,
            hasAnswered: false,
          });
        }
        if (!['read', 'join'].includes(input.action)) {
          assert.equal(input.token, `${role}-game-grant`);
          assert.equal(input.sessionId, data.game.sessionId);
          assert.equal(
            input.revision,
            data.game.revision,
            'Every explicit action uses the latest snapshot',
          );
          writes.push({ role, action: input.action, revision: input.revision });
          data.game.revision++;
          if (input.action === 'configure') {
            assert.equal(role, 'host');
            data.game.settings = input.settings;
          } else if (input.action === 'start') {
            assert.equal(role, 'host');
            beginRound();
          } else if (input.action === 'guess') {
            if (input.text === 'The midnight song') {
              const player = data.game.scoreboard.find((item) => item.id === role)!;
              player.hasAnswered = true;
              player.total += 950;
              data.game.answeredCount++;
              feedback.set(role, { correct: true, awarded: 950 });
            } else feedback.set(role, { correct: false, awarded: 0 });
          } else if (input.action === 'reveal') {
            assert.equal(role, 'host');
            data.game.phase = 'reveal';
            data.game.round!.answer = { title: 'The midnight song', artist: 'Synthetic Friends' };
          } else if (input.action === 'next') {
            assert.equal(role, 'host');
            if (data.game.roundNumber >= data.game.settings.roundCount) data.game.phase = 'results';
            else beginRound();
          } else assert.fail(`Unexpected game command ${input.action}`);
        }
        data.game.serverTime = Date.now();
        return route.fulfill({
          json: {
            ...structuredClone(data),
            canManage: role === 'host',
            token: `${role}-game-grant`,
            self: { participantId: role, result: feedback.get(role) ?? null, skipVoted: false },
          },
        });
      });
    }
    await host.goto(`${origin}/games`);
    await host.getByLabel('Nickname', { exact: true }).fill('Alex');
    await host.getByRole('button', { name: 'Host a game', exact: true }).click();
    await host.getByRole('heading', { name: 'Set the mood.', exact: true }).waitFor();
    assert.equal(creates, 1);
    await host.getByText('Game invite link', { exact: true }).click();
    const invite = await host
      .getByRole('textbox', { name: 'Game invite link', exact: true })
      .inputValue();
    assert.equal(new URL(invite).searchParams.get('room'), code);
    assert.equal(new URL(invite).hash, '');
    assert(!invite.includes(owner));
    await guest.goto(invite);
    await guest.getByLabel('Nickname', { exact: true }).fill('Blair');
    await guest.getByRole('button', { name: 'Join lobby', exact: true }).click();
    await guest.getByRole('heading', { name: 'Get comfortable.', exact: true }).waitFor();
    assert.equal(await guest.getByRole('group', { name: 'Game pace' }).count(), 0);
    await refresh(host);
    await host.getByText('Blair', { exact: true }).waitFor();
    await host.getByRole('button', { name: /Quickfire/ }).click();
    assert.equal(
      await host.getByLabel('Round seconds', { exact: true }).isVisible(),
      false,
      'Advanced settings stay collapsed',
    );
    await host.screenshot({ path: '/tmp/game-night-lobby-1440.png', fullPage: true });
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    await host.getByRole('heading', { name: 'What’s the song?', exact: true }).waitFor();
    assert.deepEqual(
      writes.map((write) => write.action),
      ['configure', 'start'],
      'One start action saves the chosen pace then starts once',
    );
    assert.equal(data.game.settings.durationSeconds, 15);
    await refresh(guest);
    await guest.getByLabel('Song title', { exact: true }).waitFor();
    await guest.getByLabel('Song title', { exact: true }).fill('Wrong track');
    await guest.getByRole('button', { name: 'Submit answer', exact: true }).click();
    await guest.getByText('Not quite. Take another shot.', { exact: true }).waitFor();
    assert.equal(
      await host.getByText('Not quite. Take another shot.', { exact: true }).count(),
      0,
      'Answer feedback remains private',
    );
    await guest.getByLabel('Song title', { exact: true }).fill('Unfinished guess');
    await guest.screenshot({ path: '/tmp/game-night-round-390.png', fullPage: true });
    await refresh(host);
    await host.getByLabel('Song title', { exact: true }).fill('The midnight song');
    await host.getByRole('button', { name: 'Submit answer', exact: true }).click();
    await host.getByText('Correct! +950 points', { exact: true }).waitFor();
    await host.getByRole('button', { name: 'Reveal answer', exact: true }).click();
    await host.getByRole('heading', { name: 'The midnight song', exact: true }).waitFor();
    await host.getByRole('button', { name: 'Next round', exact: true }).click();
    await refresh(guest);
    await guest.getByText('Round 2/5', { exact: true }).waitFor();
    await guest.getByLabel('Song title', { exact: true }).waitFor();
    assert.equal(
      await guest.getByLabel('Song title', { exact: true }).inputValue(),
      '',
      'An old guess never carries into a new round',
    );
    data.game.phase = 'results';
    data.game.revision++;
    data.game.scoreboard.forEach((player) => {
      player.total = 950;
    });
    await refresh(host);
    await host.getByRole('heading', { name: 'The joint champions.', exact: true }).waitFor();
    await host.screenshot({ path: '/tmp/game-night-results-1440.png', fullPage: true });
    for (const page of [host, guest])
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Game fits the screen',
      );
    assert.deepEqual(errors, []);
  },
);
