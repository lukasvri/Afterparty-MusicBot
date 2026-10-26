// Synthetic WAV and a browser Audio boundary test consent, not audible playback.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, type Page } from 'playwright';
import { guessWave } from '../../../services/core/src/guess-audio-format.ts';
import type { GameResponse } from '../src/lib/games/game-client.ts';
const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
type AudioProbe = {
  calls: { action: string; index: number; volume?: number }[];
  players: { onended?: (() => void) | null }[];
  rejectNext: boolean;
  holdNext: boolean;
  releasePlay?: () => void;
};
type ProbeWindow = Window & { __gameAudio: AudioProbe };
async function fixture() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      'afterparty-audio',
      JSON.stringify({ level: 71, muted: true, lastAudible: 71 }),
    );
    localStorage.setItem('afterparty-volume', '71');
    const probe: AudioProbe = { calls: [], players: [], rejectNext: false, holdNext: false };
    (window as unknown as ProbeWindow).__gameAudio = probe;
    class GameTestAudio {
      currentTime = 0;
      duration = 30;
      level = 0.5;
      index: number;
      onloadedmetadata: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        this.index = probe.players.length;
        probe.players.push(this);
        probe.calls.push({ action: 'create', index: this.index });
        setTimeout(() => this.onloadedmetadata?.(), 0);
      }
      set volume(value: number) {
        this.level = value;
        probe.calls.push({ action: 'volume', index: this.index, volume: value });
      }
      get volume() {
        return this.level;
      }
      play() {
        probe.calls.push({ action: 'play', index: this.index });
        if (probe.rejectNext) {
          probe.rejectNext = false;
          return Promise.reject(Error('Synthetic autoplay rejection'));
        }
        if (probe.holdNext) {
          probe.holdNext = false;
          return new Promise<void>((resolve) => {
            probe.releasePlay = resolve;
          });
        }
        return Promise.resolve();
      }
      pause() {
        probe.calls.push({ action: 'pause', index: this.index });
      }
      removeAttribute() {}
      load() {}
    }
    window.Audio = GameTestAudio as unknown as typeof Audio;
  });
  let revision = 1,
    round = 1,
    failRead = false,
    holdMedia = false,
    mediaCalls = 0;
  let releaseMedia: (() => void) | undefined;
  const media = guessWave(new Uint8Array(32000));
  const snapshot = (): GameResponse => ({
    canManage: false,
    token: 'synthetic-audio-grant',
    sourceState: 'ready',
    mediaAvailable: true,
    self: { participantId: 'listener', result: null, skipVoted: false },
    game: {
      scope: 'room',
      scopeId: 'TESTROOM',
      sessionId: '11111111-1111-4111-8111-111111111111',
      gameId: 'audio-test',
      revision,
      phase: 'round',
      serverTime: Date.now(),
      categoryId: 'synthetic-test',
      settings: {
        durationSeconds: 30,
        roundCount: 5,
        maxPoints: 1000,
        minPoints: 100,
        hints: true,
        answerMode: 'title',
      },
      categories: [{ id: 'synthetic-test', name: 'Synthetic test', available: true, count: 5 }],
      scoreboard: [{ id: 'listener', nickname: 'Audio listener', total: 0, hasAnswered: false }],
      answeredCount: 0,
      roundNumber: round,
      round: {
        roundId: `audio-round-${round}`,
        startsAt: Date.now() - 500,
        deadline: Date.now() + 29500,
        hints: {},
        skipVotes: 0,
        skipRequired: 1,
      },
    },
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    assert(['/api/guess', '/api/guess/media'].includes(path), `No music commands: ${path}`);
    const body = route.request().postDataJSON();
    assert.equal(body.scopeId, 'TESTROOM');
    if (path.endsWith('/media')) {
      mediaCalls++;
      assert.equal(body.token, 'synthetic-audio-grant');
      if (holdMedia)
        await new Promise<void>((resolve) => {
          releaseMedia = resolve;
        });
      await route
        .fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.from(media) })
        .catch(() => {});
    } else if (body.action === 'read' && failRead) {
      failRead = false;
      await route.fulfill({ status: 503, json: { error: 'Synthetic read loss' } });
    } else {
      assert(['join', 'read'].includes(body.action));
      await route.fulfill({ json: snapshot() });
    }
  });
  await page.goto(`${origin}/games?room=TESTROOM`);
  await page.waitForFunction(
    () =>
      (document.querySelector('input[placeholder="8-character code"]') as HTMLInputElement)
        ?.value === 'TESTROOM',
  );
  await page.getByRole('button', { name: 'Join lobby', exact: true }).click();
  await page.getByRole('button', { name: 'Enable game audio', exact: true }).waitFor();
  return {
    browser,
    page,
    errors,
    mediaCalls: () => mediaCalls,
    next() {
      round++;
      revision++;
    },
    loseRead() {
      failRead = true;
    },
    hold() {
      holdMedia = true;
    },
    release() {
      holdMedia = false;
      releaseMedia?.();
    },
  };
}
const plays = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as ProbeWindow).__gameAudio.calls.filter((call) => call.action === 'play')
        .length,
  );
const refresh = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('online')));
async function settle(page: Page) {
  await page.waitForTimeout(400);
}

test('explicit consent carries to new rounds; local volume, read loss, natural end and deliberate stop remain safe', async () => {
  const f = await fixture();
  try {
    assert.equal(f.mediaCalls(), 0, 'Joining never enables audio');
    await f.page.getByRole('button', { name: 'Enable game audio', exact: true }).click();
    await f.page.getByRole('button', { name: 'Stop game audio', exact: true }).waitFor();
    assert.equal(await plays(f.page), 1);
    await f.page
      .getByRole('slider', { name: 'Game audio volume', exact: true })
      .evaluate((input) => {
        (input as HTMLInputElement).value = '25';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    assert.equal(
      await f.page.evaluate(
        () =>
          (window as unknown as ProbeWindow).__gameAudio.calls
            .filter((call) => call.action === 'volume')
            .at(-1)?.volume,
      ),
      0.25,
    );
    assert.deepEqual(
      await f.page.evaluate(() => ({
        game: localStorage.getItem('afterparty-guess-audio-volume'),
        music: JSON.parse(localStorage.getItem('afterparty-audio') ?? 'null'),
        legacy: localStorage.getItem('afterparty-volume'),
      })),
      { game: '25', music: { level: 71, muted: true, lastAudible: 71 }, legacy: '71' },
    );
    f.loseRead();
    await refresh(f.page);
    await f.page.getByText('Synthetic read loss', { exact: false }).waitFor();
    await refresh(f.page);
    await f.page.waitForFunction(
      () =>
        !(
          Array.from(document.querySelectorAll('button')).find((button) =>
            button.textContent?.includes('Enable game audio'),
          ) as HTMLButtonElement
        )?.disabled,
    );
    await settle(f.page);
    assert.equal(await plays(f.page), 1, 'Read recovery cannot resume the same round');
    f.next();
    await refresh(f.page);
    await f.page.getByRole('button', { name: 'Stop game audio', exact: true }).waitFor();
    assert.equal(await plays(f.page), 2, 'A new keyed round inherits explicit consent');
    assert.equal(
      await f.page.getByRole('slider', { name: 'Game audio volume', exact: true }).inputValue(),
      '25',
    );
    assert.equal(
      await f.page.evaluate(
        () =>
          (window as unknown as ProbeWindow).__gameAudio.calls
            .filter((call) => call.action === 'volume')
            .at(-1)?.volume,
      ),
      0.25,
    );
    await f.page.evaluate(() =>
      (window as unknown as ProbeWindow).__gameAudio.players.at(-1)?.onended?.(),
    );
    await refresh(f.page);
    await settle(f.page);
    assert.equal(await plays(f.page), 2, 'Expired audio stays stopped within the round');
    f.next();
    await refresh(f.page);
    await f.page.getByRole('button', { name: 'Stop game audio', exact: true }).waitFor();
    assert.equal(await plays(f.page), 3);
    await f.page.getByRole('button', { name: 'Stop game audio', exact: true }).click();
    await refresh(f.page);
    await settle(f.page);
    assert.equal(await plays(f.page), 3, 'Deliberate stop survives polling');
    f.next();
    await refresh(f.page);
    await settle(f.page);
    assert.equal(await plays(f.page), 3, 'Deliberate stop revokes next-round consent');
    assert.equal(f.mediaCalls(), 3);
    assert.deepEqual(f.errors, []);
  } finally {
    f.release();
    await f.browser.close();
  }
});

test('cancelled fetches cannot start late, and blocked automatic playback needs an explicit retry', async () => {
  const f = await fixture();
  try {
    f.hold();
    await f.page.getByRole('button', { name: 'Enable game audio', exact: true }).click();
    await f.page.getByRole('button', { name: 'Cancel audio', exact: true }).waitFor();
    await f.page.getByRole('button', { name: 'Cancel audio', exact: true }).click();
    f.release();
    await settle(f.page);
    assert.equal(await plays(f.page), 0);
    assert.equal(
      await f.page.evaluate(() => (window as unknown as ProbeWindow).__gameAudio.players.length),
      0,
    );
    f.hold();
    await f.page.getByRole('button', { name: 'Enable game audio', exact: true }).click();
    await f.page.getByRole('button', { name: 'Cancel audio', exact: true }).waitFor();
    f.next();
    await refresh(f.page);
    await f.page.getByRole('button', { name: 'Enable game audio', exact: true }).waitFor();
    f.release();
    await settle(f.page);
    assert.equal(await plays(f.page), 0, 'A retired round cannot start a late media response');
    await f.page.getByRole('button', { name: 'Enable game audio', exact: true }).click();
    await f.page.getByRole('button', { name: 'Stop game audio', exact: true }).waitFor();
    await f.page.evaluate(() => {
      (window as unknown as ProbeWindow).__gameAudio.rejectNext = true;
    });
    f.next();
    await refresh(f.page);
    await f.page.getByText('Your browser needs a tap.', { exact: false }).waitFor();
    assert.equal(await plays(f.page), 2);
    await f.page.waitForTimeout(2800);
    assert.equal(await plays(f.page), 2, 'Autoplay rejection cannot cause a retry loop');
    await f.page.getByRole('button', { name: 'Enable game audio', exact: true }).click();
    await f.page.getByRole('button', { name: 'Stop game audio', exact: true }).waitFor();
    assert.equal(await plays(f.page), 3);
    assert.equal(f.mediaCalls(), 4, 'Explicit retry reuses the decoded round');
    assert.deepEqual(f.errors, []);
  } finally {
    f.release();
    await f.browser.close();
  }
});

test('cancelling while awaiting Audio.play stops late playback without granting next-round consent', async () => {
  for (const retry of [false, true]) {
    const f = await fixture();
    try {
      if (retry) {
        await f.page.evaluate(() => {
          (window as unknown as ProbeWindow).__gameAudio.rejectNext = true;
        });
        await f.page.getByRole('button', { name: 'Enable game audio', exact: true }).click();
        await f.page.getByText('Your browser needs a tap.', { exact: false }).waitFor();
      }
      await f.page.evaluate(() => {
        (window as unknown as ProbeWindow).__gameAudio.holdNext = true;
      });
      await f.page.getByRole('button', { name: 'Enable game audio', exact: true }).click();
      await f.page.waitForFunction(
        () => typeof (window as unknown as ProbeWindow).__gameAudio.releasePlay === 'function',
      );
      await f.page.getByRole('button', { name: 'Cancel audio', exact: true }).click();
      const expectedPlays = retry ? 2 : 1;
      assert.equal(await plays(f.page), expectedPlays, 'Cancel must not invoke Audio.play again');
      await f.page.evaluate(() => (window as unknown as ProbeWindow).__gameAudio.releasePlay?.());
      await settle(f.page);
      assert.equal(
        await f.page.getByRole('button', { name: 'Stop game audio', exact: true }).count(),
        0,
      );
      assert.equal(
        await f.page.evaluate(
          () =>
            (window as unknown as ProbeWindow).__gameAudio.calls.filter(
              (call) => call.action === 'pause',
            ).length >= 1,
        ),
        true,
      );
      f.next();
      await refresh(f.page);
      await f.page.getByRole('button', { name: 'Enable game audio', exact: true }).waitFor();
      await settle(f.page);
      assert.equal(
        await plays(f.page),
        expectedPlays,
        'A cancelled play promise must not grant next-round audio consent',
      );
      assert.equal(
        f.mediaCalls(),
        1,
        'Retry reuses decoded audio and cancellation never fetches another round',
      );
      assert.deepEqual(f.errors, []);
    } finally {
      f.release();
      await f.browser.close();
    }
  }
});
