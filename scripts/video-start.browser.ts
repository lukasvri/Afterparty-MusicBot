// Run against a local preview only. Playwright can be supplied via PLAYWRIGHT_MODULE.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Room, Video } from "../lib/types.ts";
import type { Player } from "../lib/youtube-player.ts";
import type { concertCore } from "./concert-core-fixture.ts";

type BrowserCommand = {
  action: string;
  position?: number;
  seconds?: number;
  version?: number;
  enabled?: boolean;
  queueRevision?: string;
};
type PlayerOptions = {
  events: {
    onReady: () => void;
    onStateChange: (event: { data: number }) => void;
    onAutoplayBlocked: () => void;
    onPlaybackQualityChange: (event: { data: string }) => void;
  };
};
type FixturePlayer = Player & {
  options: PlayerOptions;
  position: number;
  state: number;
  volume: number;
  muted: boolean;
  at: number;
  emit: (state: number) => void;
};
declare global {
  interface Window {
    __streams: Array<EventTarget & { url: string; closed: boolean }>;
    __blockAudio: boolean;
    __jitter: boolean;
    __videoCalls: string[];
    __transportCalls: string[];
    __fakePlayer: FixturePlayer;
    __originalPlayer: FixturePlayer;
  }
}
type FixtureOptions = {
  playing?: boolean;
  blocked?: boolean;
  host?: boolean;
  nextGate?: Promise<void> | null;
  nextFails?: boolean;
  previousStorage?: boolean;
  jitter?: boolean;
  streaming?: boolean;
  staleNext?: string;
  discord?: boolean;
  seekDelay?: number;
  seekFails?: boolean;
  core?: Awaited<ReturnType<typeof concertCore>> | null;
};
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
) as typeof import("playwright");
const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:8787";
assert(
  ["127.0.0.1", "localhost"].includes(new URL(base).hostname),
  "Synthetic browser checks require a local preview",
);

async function fixture({
  playing = false,
  blocked = false,
  host = true,
  nextGate = null,
  nextFails = false,
  previousStorage = true,
  jitter = false,
  streaming = false,
  staleNext = "",
  discord = false,
  seekDelay = 0,
  seekFails = false,
  core = null,
}: FixtureOptions = {}) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
      viewport: { width: 1500, height: 1000 },
    }),
    commands: BrowserCommand[] = [];
  const video = (id: string): Video => ({
    id,
    title: "Synthetic " + id,
    artist: "Synthetic artist",
    image: "",
    duration: 200,
    live: false,
    embeddable: true,
  });
  let current: Video | null = video("seed1234567");
  let version = 1,
    radio = true;
  let anchor = Date.now(),
    position = 20;
  const room = (): Room => ({
    code: "TESTROOM",
    name: "Synthetic own room",
    current,
    queue: [],
    playing,
    radio,
    position: position + (playing ? (Date.now() - anchor) / 1000 : 0),
    version,
    serverTime: Date.now(),
    viewers: 1,
    isHost: discord ? false : host,
    ...(discord ? { mode: "discord", guildId: "123456789012345678", playbackKey: "synthetic-playback" } : {}),
    expiresAt: Date.now() + 60000,
  });
  let seekJob: { id: string; status: string; seconds: number; readyAt: number } | null = null;
  const finishSeek = () => {
    if (!seekJob || Date.now() < seekJob.readyAt || seekJob.status !== "processing") return;
    seekJob.status = seekFails ? "failed" : "done";
    if (!seekFails) {
      position = seekJob.seconds;
      anchor = Date.now();
      version++;
    }
  };
  await page.addInitScript(
    ({ blocked, previousStorage, jitter, streaming }) => {
      localStorage.setItem("gutta-language", "en");
      const prefix = previousStorage ? "muse-" : "afterparty-";
      localStorage.setItem(
        prefix + "audio",
        JSON.stringify({ level: 77, muted: false, lastAudible: 77 }),
      );
      localStorage.setItem(prefix + "host:TESTROOM", "synthetic-host-token");
      localStorage.setItem(prefix + "visitor", "synthetic-visitor");
      if(streaming){
        window.__streams = [];
        Object.assign(window, { EventSource: class extends EventTarget {
          url: string;
          closed: boolean;
          constructor(url: string){super();this.url=url;this.closed=false;window.__streams.push(this);queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
          close(){this.closed=true;}
        }});
      }
      window.__blockAudio = blocked;
      window.__jitter = jitter;
      window.__videoCalls = [];
      window.__transportCalls = [];
      window.YT = {
        Player: class {
          options: PlayerOptions;
          state: number;
          position: number;
          volume: number;
          muted: boolean;
          at: number;
          constructor(_target: HTMLElement, options: Record<string, unknown>) {
            this.options = options as PlayerOptions;
            this.state = 5;
            this.position = 0;
            this.volume = 77;
            this.muted = false;
            this.at = performance.now();
            window.__fakePlayer = this;
            queueMicrotask(() => this.options.events.onReady());
          }
          emit(state: number) {
            if (this.state === 1) this.position = this.getCurrentTime();
            this.state = state;
            this.at = performance.now();
            this.options.events.onStateChange({ data: state });
          }
          loadVideoById(value: { videoId: string; startSeconds: number }) {
            window.__videoCalls.push(value.videoId);
            this.position = value.startSeconds;
            this.playVideo();
          }
          cueVideoById(value: { videoId: string; startSeconds: number }) {
            window.__videoCalls.push(value.videoId);
            this.position = value.startSeconds;
            this.emit(5);
          }
          playVideo() {
            window.__transportCalls.push("play");
            if (window.__blockAudio && !this.muted) {
              this.options.events.onAutoplayBlocked();
              return;
            }
            if (this.state !== 1) this.emit(1);
          }
          pauseVideo() {
            if (this.state !== 2) this.emit(2);
          }
          getCurrentTime() {
            const value =
              this.position +
              (this.state === 1 ? (performance.now() - this.at) / 1000 : 0);
            return window.__jitter ? Math.floor(value * 4) / 4 : value;
          }
          getPlayerState() {
            return this.state;
          }
          setVolume(value: number) {
            this.volume = value;
          }
          getVolume() {
            return this.volume;
          }
          mute() {
            this.muted = true;
          }
          unMute() {
            this.muted = false;
          }
          isMuted() {
            return this.muted;
          }
          seekTo(value: number) {
            window.__transportCalls.push("seek");
            this.position = value;
            this.at = performance.now();
          }
          setPlaybackRate() {}
          destroy() {}
        },
      };
    },
    { blocked, previousStorage, jitter, streaming },
  );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (core && await core.route(route, url, commands, host)) return;
    let result;
    if (url.pathname === "/api/rooms/TESTROOM") {
      assert.equal(
        route.request().headers()["x-afterparty-visitor"],
        "synthetic-visitor",
      );
      assert.equal(
        route.request().headers().authorization,
        "Bearer synthetic-host-token",
      );
      if (route.request().method() === "POST") {
        const command: BrowserCommand = route.request().postDataJSON();
        commands.push(command);
        if (command.action === "next" && staleNext) {
          if (staleNext === "new-track") current = video("newtrack123");
          staleNext = "";
          version++;
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic stale revision" }),
          });
        }
        if (command.action === "played") result = { ok: true };
        else {
          assert.equal(command.version, version);
          position = room().position;
          anchor = Date.now();
          if (command.action === "seek") {
            assert.equal(typeof command.position, "number");
            position = command.position!;
          }
          if (command.action === "play") playing = true;
          if (command.action === "pause") playing = false;
          if (command.action === "radio") {
            assert.equal(typeof command.enabled, "boolean");
            radio = command.enabled!;
          }
          if (command.action === "next") {
            if (nextGate) await nextGate;
            if (nextFails)
              return route.fulfill({
                status: 502,
                contentType: "application/json",
                body: JSON.stringify({
                  error: "Synthetic radio lookup failure",
                }),
              });
            current = radio ? video("next1234567") : null;
            playing = Boolean(current);
          }
          version++;
          result = { room: room() };
        }
      } else result = room();
    } else if (url.pathname === "/api/realtime") result = { url: null };
    else if (url.pathname === "/api/discord/queue" && discord) result = {
      state: { queue: [], requests: [], revision: "synthetic-revision" }, canManage: host,
    };
    else if (url.pathname === "/api/admin/control" && discord) {
      assert(host, "Guests must never attempt privileged seeking");
      if (route.request().method() === "POST") {
        const input: { guildId: string; operation: string; commandId: string; command: BrowserCommand & { seconds: number } } = route.request().postDataJSON();
        assert.equal(input.guildId, "123456789012345678");
        assert.equal(input.operation, "command");
        assert.equal(input.command.action, "seek");
        assert.equal(input.command.queueRevision, "synthetic-revision");
        commands.push(input.command);
        seekJob = { id: input.commandId, status: "processing", seconds: input.command.seconds, readyAt: Date.now() + seekDelay };
        finishSeek();
        result = { id: seekJob.id, status: seekJob.status };
      } else {
        finishSeek();
        result = { commands: [{ ...seekJob, result: seekFails ? "Synthetic seek failure" : "" }] };
      }
    }
    else if (url.pathname === "/api/discord") result = { state: discord ? {
      ...room(), ready: true, connected: true, online: true,
      volume: 80, queueRevision: "synthetic-revision", roomCode: "TESTROOM",
    } : null };
    else if (url.pathname === "/api/history") result = { videos: [] };
    else
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: "{}",
      });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  try {
    await page.goto(base + "/?room=TESTROOM", { waitUntil: "networkidle" });
    if (!core) await page.locator(".stage-intro button").waitFor();
  } catch (error) {
    await browser.close();
    throw error;
  }
  return {
    browser,
    page,
    commands,
    expectedPosition: () => room().position,
    advance: async () => {
      if (nextGate) await nextGate;
      current = nextFails ? null : video("next1234567");
      playing = Boolean(current);
      version++;
    },
  };
}
for (const playing of [true, false])
test(`Discord native seeking follows authorized audio while ${playing ? "playing" : "paused"}`, async () => {
  const { browser, page, commands, expectedPosition } = await fixture({ discord: true, playing, seekDelay: 1800 });
  try {
    await page.locator(".stage-intro button").click();
    await page.waitForFunction(() => window.__fakePlayer);
    await page.waitForTimeout(1400);
    for (const seconds of [80, 35]) {
      await page.evaluate((seconds) => {
        const p = window.__fakePlayer;
        p.emit(3);
        p.position = seconds;
        p.at = performance.now();
        p.emit(2);
      }, seconds);
      await page.waitForTimeout(3200);
      const measured = await page.evaluate(() => window.__fakePlayer.getCurrentTime());
      assert(Math.abs(measured - expectedPosition()) < 1, "Video follows confirmed Core position");
      assert(Math.abs(measured - seconds) < 5, "Seeking must not snap back to the old position");
    }
    assert.equal(commands.filter((c) => c.action === "seek").length, 2);
    await page.evaluate(() => window.__fakePlayer.emit(3));
    await page.waitForTimeout(1800);
    await page.evaluate((playing) => window.__fakePlayer.emit(playing ? 1 : 2), playing);
    await page.waitForTimeout(2200);
    assert.equal(commands.filter((c) => c.action === "seek").length, 2, "Buffering never publishes a seek");
  } finally { await browser.close(); }
});
for (const host of [true, false])
test(`Discord native seeking ${host ? "recovers from a rejected command" : "keeps guest controls local"}`, async () => {
  const { browser, page, commands, expectedPosition } = await fixture({ discord: true, playing: true, host, seekDelay: 600, seekFails: true });
  try {
    await page.locator(".stage-intro button").click();
    await page.waitForFunction(() => window.__fakePlayer?.state === 1);
    await page.waitForTimeout(1400);
    await page.evaluate(() => { const p = window.__fakePlayer; p.emit(3); p.position = 80; p.at = performance.now(); p.emit(1); });
    await page.waitForTimeout(7000);
    assert.equal(commands.filter((c) => c.action === "seek").length, host ? 1 : 0);
    assert(Math.abs(await page.evaluate(() => window.__fakePlayer.getCurrentTime()) - expectedPosition()) < 1);
  } finally { await browser.close(); }
});

test("one centre play click starts a paused own room and its local video", async () => {
  const { browser, page, commands } = await fixture();
  try {
    await page.locator(".stage-intro button").click();
    await page.waitForFunction(
      () => window.__fakePlayer?.state === 1,
      {},
      { timeout: 4000 },
    );
    assert.equal(
      commands.filter((command) => command.action === "play").length,
      1,
    );
    assert.deepEqual(await page.evaluate(() => window.__videoCalls), [
      "seed1234567",
    ]);
  } finally {
    await browser.close();
  }
});
test("the transport play click loads a locally unopened video without pausing the room", async () => {
  const { browser, page, commands } = await fixture({ playing: true });
  try {
    await page.locator(".now-playing .shared-play").click();
    await page.waitForFunction(
      () => window.__fakePlayer?.state === 1,
      {},
      { timeout: 4000 },
    );
    assert.equal(
      commands.filter((command) => ["play", "pause"].includes(command.action))
        .length,
      0,
    );
  } finally {
    await browser.close();
  }
});
test("blocked audible startup falls back to muted video without changing saved audio", async () => {
  const { browser, page } = await fixture({ playing: true, blocked: true });
  try {
    await page.locator(".stage-intro button").click();
    await page.waitForFunction(
      () => window.__fakePlayer?.state === 1,
      {},
      { timeout: 4000 },
    );
    assert.equal(await page.evaluate(() => window.__fakePlayer.muted), true);
    await page.clock.install();
    await page.clock.fastForward(1500);
    assert.equal(
      (
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("afterparty-audio") ?? "{}") as { muted: boolean },
        )
      ).muted,
      false,
    );
    await page.evaluate(() => {
      window.__blockAudio = false;
    });
    await page
      .getByRole("button", { name: "Enable sound", exact: true })
      .click();
    assert.equal(await page.evaluate(() => window.__fakePlayer.muted), false);
    assert.equal(await page.evaluate(() => window.__fakePlayer.volume), 77);
  } finally {
    await browser.close();
  }
});
test("a guest can open the local video without resuming a paused room", async () => {
  const { browser, page, commands } = await fixture({ host: false });
  try {
    await page.locator(".stage-intro button").click();
    await page.waitForFunction(() =>
      window.__videoCalls.includes("seed1234567"),
    );
    assert.equal(await page.evaluate(() => window.__fakePlayer.state), 5);
    assert.equal(commands.length, 0);
    assert.equal(await page.locator(".shared-play").count(), 0);
  } finally {
    await browser.close();
  }
});
test("server-owned room progression loads the next track without a browser next command", async () => {
  const { browser, page, commands, advance } = await fixture({ playing: true });
  try {
    await page.locator(".stage-intro button").click();
    await page.waitForFunction(() => window.__fakePlayer?.state === 1);
    await page.evaluate(() => window.__fakePlayer.emit(0));
    await advance();
    await page.waitForFunction(
      () =>
        window.__videoCalls.includes("next1234567") &&
        window.__fakePlayer.state === 1,
    );
    assert.equal(
      commands.filter((command) => command.action === "next").length,
      0,
    );
    await page.locator(".video-settings > summary").click();
    await page.getByRole("button", { name: "Radio on", exact: true }).click();
    await page
      .getByRole("button", { name: "Radio off", exact: true })
      .waitFor();
    assert.equal(
      commands.find((command) => command.action === "radio")?.enabled,
      false,
    );
  } finally {
    await browser.close();
  }
});
for (const nextFails of [false, true])
  test(`browser holds the ended video while the server resolves radio${nextFails ? " failure" : ""}`, async () => {
    let release = () => {};
    const nextGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { browser, page, commands, advance } = await fixture({
      playing: true,
      nextGate,
      nextFails,
    });
    try {
      await page.locator(".stage-intro button").click();
      await page.waitForFunction(() => window.__fakePlayer?.state === 1);
      await page.evaluate(() => {
        window.__fakePlayer.emit(0);
        window.__transportCalls = [];
      });
      const pending = advance();
      await page.waitForTimeout(1800);
      assert.equal(await page.evaluate(() => window.__fakePlayer.state), 0);
      assert.deepEqual(await page.evaluate(() => window.__transportCalls), []);
      assert.equal(
        commands.filter((command) => command.action === "next").length,
        0,
      );
      release();
      await pending;
      if (nextFails) {
        await page.waitForFunction(() => window.__fakePlayer.state === 2);
        assert.deepEqual(
          await page.evaluate(() => window.__transportCalls),
          [],
        );
      } else
        await page.waitForFunction(
          () =>
            window.__videoCalls.includes("next1234567") &&
            window.__fakePlayer.state === 1,
        );
    } finally {
      release();
      await browser.close();
    }
  });

test("a guest holds the ended video without sending a host command", async () => {
  const { browser, page, commands } = await fixture({
    playing: true,
    host: false,
  });
  try {
    await page.locator(".stage-intro button").click();
    await page.waitForFunction(() => window.__fakePlayer?.state === 1);
    await page.evaluate(() => {
      window.__fakePlayer.emit(0);
      window.__transportCalls = [];
    });
    await page.waitForTimeout(1800);
    assert.equal(await page.evaluate(() => window.__fakePlayer.state), 0);
    assert.deepEqual(await page.evaluate(() => window.__transportCalls), []);
    assert.equal(commands.length, 0);
  } finally {
    await browser.close();
  }
});

test("fresh Afterparty storage works without any old browser keys", async () => {
  const f = await fixture({ previousStorage: false });
  try {
    await f.page.locator(".stage-intro button").click();
    await f.page.waitForFunction(() => window.__fakePlayer?.state === 1);
    assert.equal(
      await f.page.evaluate(() =>
        Object.keys(localStorage).some((k) => k.startsWith("muse-")),
      ),
      false,
    );
    assert.equal(
      await f.page.evaluate(
        () => (JSON.parse(localStorage.getItem("afterparty-audio") ?? "{}") as { level: number }).level,
      ),
      77,
    );
  } finally {
    await f.browser.close();
  }
});

test("one host stays live without repeated seeks or publishing buffering as a room seek", async () => {
  const { browser, page, commands, expectedPosition } = await fixture({
    playing: true,
    jitter: true,
  });
  try {
    await page.locator(".stage-intro button").click();
    await page.waitForFunction(() => window.__fakePlayer?.state === 1);
    await page.waitForTimeout(12000);
    if (process.env.SCREENSHOT_DIR)
      await page.screenshot({
        path: process.env.SCREENSHOT_DIR + "/clean-room.png",
        fullPage: true,
      });
    assert.equal(
      await page.evaluate(
        () => window.__transportCalls.filter((c) => c === "seek").length,
      ),
      0,
    );
    await page.evaluate(() => window.__fakePlayer.emit(3));
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.__fakePlayer.emit(1));
    await page.waitForTimeout(8000);
    assert.equal(
      commands.filter((c) => c.action === "seek").length,
      0,
      "buffer recovery must never publish a host seek",
    );
    const seeks = await page.evaluate(
      () => window.__transportCalls.filter((c) => c === "seek").length,
    );
    assert.equal(seeks, 1, "recover once, then continue without seeking loops");
    const measured = await page.evaluate(() =>
      window.__fakePlayer.getCurrentTime(),
    );
    assert(
      Math.abs(expectedPosition() - measured) < 0.6,
      "recovery must return within 600ms of the shared live clock",
    );
    assert.equal(await page.locator(".video-settings .admin-seek").count(), 0);
    await page.evaluate(() => {
      const p = window.__fakePlayer;
      p.emit(3);
      p.position = 80;
      p.at = performance.now();
      p.emit(1);
    });
    await page.waitForTimeout(2000);
    assert.equal(
      commands.filter((c) => c.action === "seek").length,
      1,
      "native YouTube scrubbing publishes exactly one seek",
    );
    assert(
      Math.abs(commands.find((c) => c.action === "seek")!.position! - 80) < 2,
    );
  } finally {
    await browser.close();
  }
});

for (const staleNext of ["same-track", "new-track"])
  test(`skip safely handles a stale revision: ${staleNext}`, async () => {
    const { browser, page, commands } = await fixture({
      playing: true,
      staleNext,
    });
    try {
      await page.locator(".stage-intro button").click();
      await page.waitForFunction(() => window.__fakePlayer?.state === 1);
      await page
        .getByRole("button", { name: "Next video for everyone", exact: true })
        .click();
      await page.waitForFunction(
        (id) => window.__videoCalls.includes(id),
        staleNext === "same-track" ? "next1234567" : "newtrack123",
      );
      assert.equal(
        commands.filter((c) => c.action === "next").length,
        staleNext === "same-track" ? 2 : 1,
      );
    } finally {
      await browser.close();
    }
  });

test("quality changes preserve the iframe and never reload the song or publish transport", async () => {
  const { browser, page, commands } = await fixture({ playing: true });
  try {
    await page.locator(".stage-intro button").click();
    await page.waitForFunction(() => window.__fakePlayer?.state === 1);
    await page.waitForTimeout(2500);
    const before = await page.evaluate(() => ({
      loads: window.__videoCalls.length,
      seeks: window.__transportCalls.filter((c) => c === "seek").length,
    }));
    const sent = commands.length;
    await page.evaluate(() => {
      window.__originalPlayer = window.__fakePlayer;
      window.__fakePlayer.options.events.onPlaybackQualityChange({
        data: "hd1440",
      });
      window.__fakePlayer.emit(3);
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.__fakePlayer.options.events.onPlaybackQualityChange({
        data: "hd720",
      });
      window.__fakePlayer.emit(1);
    });
    await page.waitForTimeout(4000);
    assert(
      await page.evaluate(
        () => window.__fakePlayer === window.__originalPlayer,
      ),
    );
    assert.equal(
      await page.evaluate(() => window.__videoCalls.length),
      before.loads,
    );
    assert.equal(
      await page.evaluate(
        () => window.__transportCalls.filter((c) => c === "seek").length,
      ),
      before.seeks,
    );
    assert.equal(
      commands
        .slice(sent)
        .filter((c) => ["seek", "play", "pause", "next"].includes(c.action))
        .length,
      0,
    );
    assert.equal(
      await page.locator(".settings-quality").first().innerText(),
      "720p",
    );
  } finally {
    await browser.close();
  }
});

test("audio preferences update without replacing the player and survive mute and cross-tab changes", async () => {
  const {browser, page, commands} = await fixture({playing:true,previousStorage:false});
  try {
    await page.locator('.stage-intro button').filter({hasText:/Start video/}).click();
    await page.waitForFunction(() => window.__fakePlayer?.state === 1);
    await page.evaluate(() => {window.__originalPlayer = window.__fakePlayer;});
    await page.waitForTimeout(1200);
    const before = commands.length;
    await page.evaluate(() => window.__fakePlayer.setVolume(23));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('afterparty-audio') ?? '{}').level === 23);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.keyboard.press('m');
    await page.waitForFunction(() => window.__fakePlayer.muted);
    assert.equal(await page.evaluate(() => (JSON.parse(localStorage.getItem('afterparty-audio') ?? '{}') as { level: number }).level),23);
    await page.keyboard.press('m');
    await page.waitForFunction(() => !window.__fakePlayer.muted);
    await page.evaluate(() => {
      localStorage.setItem('afterparty-audio', JSON.stringify({level:41,muted:true,lastAudible:41}));
      dispatchEvent(new StorageEvent('storage',{key:'afterparty-audio'}));
    });
    await page.waitForFunction(() => window.__fakePlayer.volume === 41 && window.__fakePlayer.muted);
    assert(await page.evaluate(() => window.__fakePlayer === window.__originalPlayer));
    assert.equal(commands.length,before,'Device audio must not publish a shared transport command');
  } finally { await browser.close(); }
});

test("live room callbacks accept new timelines after rendering without reconnecting", async () => {
  const {browser, page} = await fixture({playing:true,streaming:true});
  try {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.stage-intro button').filter({hasText:/Start video/}).click();
    await page.waitForFunction(() => window.__fakePlayer?.state === 1);
    await page.getByRole('button',{name:'Bokmål',exact:true}).click();
    await page.evaluate(() => {
      const source = window.__streams.find(stream => stream.url.includes('room=TESTROOM'));
      if (!source) throw new Error('Expected the synthetic room stream');
      source.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'room',room:{
        code:'TESTROOM',name:'Synthetic own room',current:{id:'next1234567',title:'Fresh live title',artist:'Synthetic artist',image:'',duration:200,live:false,embeddable:true},queue:[],playing:true,position:45,version:2,serverTime:Date.now(),viewers:1,isHost:true,expiresAt:Date.now()+60000,syncSource:'live',syncEpoch:'synthetic-stream',syncValidForMs:5000,
      }})}));
    });
    await page.waitForFunction(() => window.__videoCalls.at(-1) === 'next1234567');
    assert.equal(await page.evaluate(() => window.__streams.length),1);
    assert.equal(await page.evaluate(() => window.__streams[0].closed),false);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

for (const source of ['website', 'discord'])
test(`Core integration: ${source} add from idle then manager seeks forward and backward`, async () => {
 const {concertCore} = await import('./concert-core-fixture.ts');
 const core = await concertCore();
 let f: Awaited<ReturnType<typeof fixture>> | undefined;
 try {
  f = await fixture({discord:true,core});
  const {page,commands} = f;
  page.setDefaultTimeout(10000);
  if(source==='website') {
   await page.locator('#music-tab').click();
   await page.locator('.search-form input').fill('Synthetic concert');
   await page.locator('.search-form input').press('Enter');
   await page.getByRole('button',{name:/Legg.*Synthetic concert|Add.*Synthetic concert/}).click();
  } else await core.addDiscord();
  await page.locator('.stage-intro button').filter({hasText:/Start video/}).click();
  await page.waitForFunction(()=>window.__fakePlayer?.state===1);
  await page.waitForTimeout(1600);
  assert(core.engine.loading, 'Core is preparing the newly added track');
  core.release();
  await page.waitForFunction(()=>window.__fakePlayer.getCurrentTime()>2);
  await page.waitForTimeout(500);
  for(const seconds of [80,35]) {
   await page.evaluate(seconds=>{const p=window.__fakePlayer;p.emit(3);p.position=seconds;p.at=performance.now();p.emit(2);},seconds);
   await page.waitForTimeout(1800);
   assert(Math.abs(core.engine.snapshot().position-seconds)<4, 'Native seek must reach Core instead of snapping back');
   const measured=await page.evaluate(()=>window.__fakePlayer.getCurrentTime());
   assert(Math.abs(measured-core.engine.snapshot().position)<1,'Browser follows Core after seek');
  }
  assert.equal(commands.filter(c=>c.action==='seek').length,2);
  await core.verifyPermissions();
 } finally { if(f) await f.browser.close(); await core.close(); }
});

for (const [outcome, name] of [
 ['success', 'the latest native seek survives an earlier Discord command in flight'],
 ['leave', 'leaving a room discards a native seek queued behind an earlier command'],
 ['failure', 'a failed native seek discards queued input and keeps its error visible'],
] as const)
test(`Core integration: ${name}`, async () => {
 const {concertCore} = await import('./concert-core-fixture.ts');
 const core = await concertCore();
 const release = Promise.withResolvers<void>();
 let f: Awaited<ReturnType<typeof fixture>> | undefined;
 try {
  f = await fixture({discord:true,core});
  const {page,commands} = f, errors: string[] = [], sent: number[] = [];
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  await core.addDiscord();
  await page.locator('.stage-intro button').filter({hasText:/Start video/}).click();
  await page.waitForFunction(()=>window.__fakePlayer?.state===1);
  await page.waitForTimeout(1600);
  assert(core.engine.loading, 'Core must still be preparing the initial track');
  core.release();
  await page.waitForFunction(()=>window.__fakePlayer.getCurrentTime()>2);
  await page.waitForTimeout(500);
  if(outcome==='failure') {
   const seek = core.engine.seek.bind(core.engine);
   core.engine.seek = async seconds=>{
    if(seconds===80) throw new Error('Synthetic first seek failure');
    await seek(seconds);
   };
  }
  await page.route('**/api/admin/control', async route => {
   if(route.request().method()==='POST') {
    const input = route.request().postDataJSON() as {command: BrowserCommand};
    assert.equal(input.command.action,'seek');
    assert.equal(typeof input.command.seconds,'number');
    sent.push(input.command.seconds!);
    if(sent.length===1) await release.promise;
   }
   await route.fallback();
  });
  const scrub = (seconds: number) => page.evaluate(seconds=>{
   const p=window.__fakePlayer;p.emit(3);p.position=seconds;p.at=performance.now();p.emit(2);
  },seconds);
  const firstRequest = page.waitForRequest(request=>new URL(request.url()).pathname==='/api/admin/control' && request.method()==='POST');
  await scrub(80);
  await firstRequest;
  await scrub(35);
  // Keep the first request blocked across several 100 ms sync samples so the
  // second scrub must survive the pending command and its later refresh.
  await page.waitForTimeout(350);
  assert.deepEqual(sent,[80],'The second command must wait for the first');
  assert.equal(commands.length,0,'The held request must not reach Core yet');
  assert.equal(await page.evaluate(()=>window.__fakePlayer.getCurrentTime()),35);
  const jobResponse = (seconds: number, status: string) => page.waitForResponse(async response=>{
   if(new URL(response.url()).pathname!=='/api/admin/control' || response.request().method()!=='GET') return false;
   const result = await response.json() as {commands?: Array<{status: string; payload?: BrowserCommand}>};
   return Boolean(result.commands?.some(job=>job.status===status && job.payload?.action==='seek' && job.payload.seconds===seconds));
  });
  if(outcome==='success') {
   const acknowledged = jobResponse(35,'done');
   release.resolve();
   await acknowledged;
   await page.waitForFunction(()=>window.__fakePlayer.state===1 && window.__fakePlayer.getCurrentTime()>=35 && window.__fakePlayer.getCurrentTime()<39);
   const current = core.engine.snapshot(), measured = await page.evaluate(()=>window.__fakePlayer.getCurrentTime());
   assert(Math.abs(current.position-35)<4,'Core must retain the latest native scrub');
   assert(Math.abs(measured-current.position)<1,'The iframe must follow the latest Core seek');
   assert.deepEqual(sent,[80,35],'Native commands must remain ordered and singular');
  } else if(outcome==='leave') {
   await page.evaluate(()=>{
    history.pushState(null,'','/');
    window.dispatchEvent(new PopStateEvent('popstate'));
   });
   await page.getByRole('heading',{name:'Afterparty',exact:true}).waitFor();
   const firstResponse = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/control' && response.request().method()==='POST');
   release.resolve();
   await firstResponse;
   // Let the first completion and several sync samples run after navigation.
   await page.waitForTimeout(700);
   assert.deepEqual(sent,[80],'A retired room must not replay deferred seeking');
   assert.equal(new URL(page.url()).searchParams.get('room'),null);
   await page.getByRole('heading',{name:'Afterparty',exact:true}).waitFor();
   assert(core.engine.snapshot().position>=80,'Only the already-sent seek may finish after leaving');
  } else {
   const failed = jobResponse(80,'failed');
   release.resolve();
   await failed;
   await page.getByRole('alert').filter({hasText:'Synthetic first seek failure'}).waitFor();
   await page.waitForTimeout(350);
   assert.deepEqual(sent,[80],'A failed command must not silently replay deferred seeking');
   assert(core.engine.snapshot().position<35,'The failed first seek must preserve the previous Core timeline');
  }
  const expected = outcome==='success' ? [['seek',80],['seek',35]] : [['seek',80]];
  assert.deepEqual(commands.map(command=>[command.action,command.seconds]),expected,'Native seeking must not send other transport commands');
  assert.deepEqual(await page.evaluate(()=>window.__videoCalls),[core.video.id],'Queued seeking must preserve the existing iframe load');
  assert.equal(core.engine.snapshot().playing,true);
  assert.deepEqual(errors,[]);
 } finally {
  release.resolve();
  try {
   if(f) {
    try { await f.page.unrouteAll({behavior:'wait'}); }
    finally { await f.browser.close(); }
   }
  } finally { await core.close(); }
 }
});

test("unified settings preserve playback across mobile and desktop fullscreen", async () => {
  const {browser, page, commands} = await fixture({playing:true});
  try {
    await page.locator('.stage-intro button').click();
    await page.waitForFunction(() => window.__fakePlayer?.state === 1);
    await page.evaluate(() => {window.__originalPlayer = window.__fakePlayer;});
    const sent = commands.length;
    await page.locator('.video-settings > summary').click();
    await page.getByLabel('Your nickname').fill('Synthetic guest');
    await page.locator('.video-settings select').selectOption('stable');
    for (const width of [360, 390, 1440]) {
      await page.setViewportSize({width,height:900});
      await page.locator('[data-fullscreen-button]').click();
      await page.locator('.stage-panel[data-immersive=true]').waitFor();
      assert.equal(await page.locator('.video-settings').count(),1);
      assert(await page.getByRole('heading',{name:'Room settings',exact:true}).isVisible());
      assert(await page.getByRole('heading',{name:'Queue settings',exact:true}).isVisible());
      assert(await page.getByRole('heading',{name:'Video settings',exact:true}).isVisible());
      assert.equal(await page.getByLabel('Your nickname').inputValue(),'Synthetic guest');
      assert.equal(await page.locator('.video-settings select').inputValue(),'stable');
      assert(await page.locator('.video-settings-body').evaluate(el => {
        const panel=el.getBoundingClientRect();
        const name=el.querySelector<HTMLInputElement>('.display-name input')!.getBoundingClientRect();
        const tv=el.querySelector('.tv-mode-button')!.getBoundingClientRect();
        const controls=Array.from(el.querySelectorAll('.party-tools > button,.party-tools > label')).map(control=>control.getBoundingClientRect());
        const controlsFit=controls.every((control,index)=>control.left>=panel.left && control.right<=panel.right &&
          controls.slice(index+1).every(other=>!(control.left<other.right && control.right>other.left && control.top<other.bottom && control.bottom>other.top)));
        return controlsFit && panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight &&
          !(name.left < tv.right && name.right > tv.left && name.top < tv.bottom && name.bottom > tv.top);
      }), 'Fullscreen settings and nickname/TV controls must fit without overlap');
      if(process.env.SCREENSHOT_DIR) {
        await page.waitForTimeout(300); // Let the native fullscreen compositor finish its fade.
        await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/settings-fullscreen-${width}.png`});
      }
      await page.locator('[data-fullscreen-close]').click();
      await page.locator('.stage-panel[data-immersive=false]').waitFor();
      assert.equal(await page.locator('#room-settings-heading').count(),1);
      assert(await page.evaluate(() => window.__fakePlayer === window.__originalPlayer));
    }
    assert.equal(commands.length,sent,'Device settings and fullscreen must not publish shared playback commands');
  } finally {await browser.close();}
});

test("room hosts can retry an empty radio queue without restarting playback", async () => {
  const {browser,page,commands} = await fixture({playing:true});
  try {
    await page.locator('.stage-intro button').click();
    await page.waitForFunction(() => window.__fakePlayer?.state === 1);
    await page.evaluate(() => {window.__originalPlayer=window.__fakePlayer;});
    await page.locator('.video-settings > summary').click();
    await page.getByRole('button',{name:'Retry radio',exact:true}).click();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.queue-options > button')?.disabled);
    assert.deepEqual(commands.filter(command => command.action === 'radio').map(command => command.enabled),[true]);
    assert.equal(commands.filter(command => ['play','pause','seek','next'].includes(command.action)).length,0);
    assert(await page.evaluate(() => window.__fakePlayer===window.__originalPlayer && window.__fakePlayer.state===1));
  } finally {await browser.close();}
});
