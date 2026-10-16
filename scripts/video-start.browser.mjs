// Run against a local preview only. Playwright can be supplied via PLAYWRIGHT_MODULE.
import { test } from "node:test";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
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
} = {}) {
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
    commands = [];
  const video = (id) => ({
    id,
    title: "Synthetic " + id,
    artist: "Synthetic artist",
    image: "",
    duration: 200,
    live: false,
    embeddable: true,
  });
  let current = video("seed1234567"),
    version = 1,
    radio = true;
  let anchor = Date.now(),
    position = 20;
  const room = () => ({
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
    isHost: host,
    expiresAt: Date.now() + 60000,
  });
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
        window.EventSource = class extends EventTarget {
          constructor(url){super();this.url=url;this.closed=false;window.__streams.push(this);queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
          close(){this.closed=true;}
        };
      }
      window.__blockAudio = blocked;
      window.__jitter = jitter;
      window.__videoCalls = [];
      window.__transportCalls = [];
      window.YT = {
        Player: class {
          constructor(_target, options) {
            this.options = options;
            this.state = 5;
            this.position = 0;
            this.volume = 77;
            this.muted = false;
            this.at = performance.now();
            window.__fakePlayer = this;
            queueMicrotask(() => options.events.onReady());
          }
          emit(state) {
            if (this.state === 1) this.position = this.getCurrentTime();
            this.state = state;
            this.at = performance.now();
            this.options.events.onStateChange({ data: state });
          }
          loadVideoById(value) {
            window.__videoCalls.push(value.videoId);
            this.position = value.startSeconds;
            this.playVideo();
          }
          cueVideoById(value) {
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
          setVolume(value) {
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
          seekTo(value) {
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
        const command = route.request().postDataJSON();
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
          if (command.action === "seek") position = command.position;
          if (command.action === "play") playing = true;
          if (command.action === "pause") playing = false;
          if (command.action === "radio") radio = command.enabled;
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
    else if (url.pathname === "/api/discord") result = { state: null };
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
    await page.locator(".stage-intro button").waitFor();
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
          JSON.parse(localStorage.getItem("afterparty-audio")),
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
    await page.locator(".room-options > summary").click();
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
    let release;
    const nextGate = new Promise((resolve) => {
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
        () => JSON.parse(localStorage.getItem("afterparty-audio")).level,
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
      Math.abs(commands.find((c) => c.action === "seek").position - 80) < 2,
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
    await page.locator('.stage-intro button').click();
    await page.waitForFunction(() => window.__fakePlayer?.state === 1);
    await page.evaluate(() => {window.__originalPlayer = window.__fakePlayer;});
    await page.waitForTimeout(1200);
    const before = commands.length;
    await page.evaluate(() => window.__fakePlayer.setVolume(23));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('afterparty-audio') ?? '{}').level === 23);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('m');
    await page.waitForFunction(() => window.__fakePlayer.muted);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('afterparty-audio')).level),23);
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
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.stage-intro button').click();
    await page.waitForFunction(() => window.__fakePlayer?.state === 1);
    await page.getByRole('button',{name:'Bokmål',exact:true}).click();
    await page.evaluate(() => {
      const source = window.__streams.find(stream => stream.url.includes('room=TESTROOM'));
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
