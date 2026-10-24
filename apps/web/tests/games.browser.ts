import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import type { GameResponse } from '../src/lib/game-client.ts';
const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
for (const width of [1440, 390])
  test(`native game host lifecycle and guest restrictions at ${width}px`, async () => {
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox'],
    });
    try {
      for (const host of [true, false]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        page.setDefaultTimeout(10000);
        const errors: string[] = [],
          actions: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const data: GameResponse = {
          canManage: host,
          token: 'synthetic-game-grant',
          sourceState: 'ready',
          mediaAvailable: false,
          self: { participantId: 'player', result: null, skipVoted: false },
          game: {
            scope: 'room',
            scopeId: 'TESTROOM',
            sessionId: '11111111-1111-4111-8111-111111111111',
            gameId: 'synthetic',
            revision: 1,
            phase: 'lobby',
            serverTime: Date.now(),
            categoryId: 'synthetic-test',
            settings: {
              durationSeconds: 30,
              roundCount: 1,
              maxPoints: 1000,
              minPoints: 100,
              hints: true,
              answerMode: 'title',
            },
            categories: [
              { id: 'synthetic-test', name: 'Synthetic test', available: true, count: 5 },
            ],
            roundNumber: 0,
            round: null,
            scoreboard: [
              { id: 'player', nickname: 'Synthetic player', total: 0, hasAnswered: false },
            ],
            answeredCount: 0,
          },
        };
        await page.route('**/api/**', async (route) => {
          assert.equal(
            new URL(route.request().url()).pathname,
            '/api/guess',
            'game never sends playback commands',
          );
          const input = route.request().postDataJSON();
          actions.push(input.action);
          assert.equal(input.scope, 'room');
          assert.equal(input.scopeId, 'TESTROOM');
          if (!['join', 'read'].includes(input.action)) {
            assert.equal(input.token, 'synthetic-game-grant');
            assert.equal(input.sessionId, data.game.sessionId);
            assert.equal(input.revision, data.game.revision);
            if (['start', 'reveal', 'next', 'end', 'reset', 'configure'].includes(input.action))
              assert(host);
            data.game.revision++;
          }
          if (input.action === 'configure') data.game.settings = input.settings;
          if (input.action === 'start') {
            data.game.phase = 'round';
            data.game.roundNumber = 1;
            data.game.round = {
              roundId: 'round-one',
              startsAt: Date.now() - 200,
              deadline: Date.now() + 30000,
              hints: {},
              skipVotes: 0,
              skipRequired: 1,
            };
          }
          if (input.action === 'guess') {
            assert.equal(input.text, 'Test Tone One');
            data.self.result = { correct: true, awarded: 950 };
            data.game.scoreboard[0].hasAnswered = true;
            data.game.scoreboard[0].total = 950;
          }
          if (input.action === 'reveal') {
            data.game.phase = 'reveal';
            data.game.round!.answer = {
              title: 'Test Tone One',
              artist: 'Synthetic Test Generator',
            };
          }
          if (input.action === 'next') data.game.phase = 'results';
          if (input.action === 'reset') {
            data.game.phase = 'lobby';
            data.game.round = null;
            data.game.roundNumber = 0;
          }
          data.game.serverTime = Date.now();
          await route.fulfill({ json: structuredClone(data) });
        });
        await page.goto(`${origin}/games?room=TESTROOM`);
        await page.waitForFunction(
          () =>
            (document.querySelector('input[placeholder="8-character code"]') as HTMLInputElement)
              ?.value === 'TESTROOM',
        );
        await page.getByLabel('Nickname', { exact: true }).fill('Synthetic player');
        await page.getByRole('button', { name: 'Join lobby', exact: true }).click();
        await page.getByRole('heading', { name: 'The room is ready. Are you?' }).waitFor();
        if (host) {
          await page.getByLabel('Rounds', { exact: true }).fill('2');
          await page.getByRole('button', { name: 'Save settings', exact: true }).click();
          await page.getByRole('button', { name: 'Start game', exact: true }).click();
          await page.getByLabel('Song title', { exact: true }).fill('Test Tone One');
          await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
          await page.getByText('Correct! +950 points', { exact: true }).waitFor();
          await page.getByRole('button', { name: 'Reveal answer', exact: true }).click();
          await page.getByRole('heading', { name: 'Test Tone One', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Next round', exact: true }).click();
          await page.getByRole('heading', { name: 'That’s a wrap.', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Back to lobby', exact: true }).click();
          await page.getByRole('heading', { name: 'The room is ready. Are you?' }).waitFor();
          assert(actions.includes('guess'));
        } else {
          assert.equal(
            await page.getByRole('button', { name: 'Start game', exact: true }).count(),
            0,
          );
          assert.equal(await page.getByLabel('Rounds', { exact: true }).isDisabled(), true);
          assert.deepEqual(
            actions.filter((action) => !['read', 'join'].includes(action)),
            [],
          );
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.getByRole('button', { name: 'Leave game', exact: true }).click();
        await page.getByRole('button', { name: 'Join lobby', exact: true }).waitFor();
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });
