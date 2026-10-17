// Exercise the rendered hooks with isolated transport events and local API fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page, Route } from "playwright";
import { liveRoom, type LiveState } from "../lib/live-room.ts";
import type { Room, Video } from "../lib/types.ts";
import type { Player } from "../lib/youtube-player.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = new URL(process.env.PREVIEW_URL ?? "http://127.0.0.1:8787").origin;
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Synthetic checks require a local preview");
const guildA = "111111111111111111", guildB = "222222222222222222";

type SyntheticSource = {
  url: string;
  readyState: number;
  closeCalls: number;
  send: (payload: unknown) => void;
  fail: (terminal: boolean) => void;
};

declare global {
  interface Window {
    afterpartySyncStreams: SyntheticSource[];
    afterpartySyncPlayer?: Player & { scrub: (seconds: number) => void };
  }
}

function video(title: string): Video {
  return { id: "seed1234567", title, artist: "Synthetic artist", image: "", duration: 200, live: false, embeddable: true };
}
function discordState(guildId = guildA, title = "Initial concert", time = Date.now()): LiveState {
  return {
    engine: "gutta-krutt-core", epoch: "synthetic-core", sequence: 1, serverTime: time,
    buffering: false, playbackKey: "synthetic-playback", guildId,
    roomCode: guildId === guildA ? "DISCORD1" : "D0BBBBBB",
    ready: true, online: true, connected: true, playing: false, position: 20,
    volume: 60, current: video(title), queue: [], queueRevision: "synthetic-revision", lastSeen: time,
  };
}
function browserRoom(time = Date.now()): Room {
  return {
    code: "TESTROOM", name: "Synthetic sync room", current: video("Initial room video"),
    queue: [], playing: false, position: 20, version: 1, serverTime: time,
    viewers: 1, isHost: true, expiresAt: time + 86400000,
  };
}

type Gate = { started: Promise<void>; wait: Promise<void>; seen: () => void; release: () => void; snapshot?: Room };
function gate(): Gate {
  let seen = () => {}, release = () => {};
  const started = new Promise<void>((resolve) => { seen = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { started, wait, seen, release };
}

async function fixture(kind: "room" | "discord", failDiscovery = false, manager = false) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem("gutta-language", "en");
    const streams: SyntheticSource[] = [];
    class Source extends EventTarget {
      static CLOSED = 2;
      static CONNECTING = 0;
      static OPEN = 1;
      url: string;
      readyState = 0;
      closeCalls = 0;
      constructor(url: string) {
        super();
        this.url = url;
        streams.push(this);
        queueMicrotask(() => {
          if (this.readyState !== 2) {
            this.readyState = 1;
            this.dispatchEvent(new Event("open"));
          }
        });
      }
      close() { this.readyState = 2; this.closeCalls++; }
      send(payload: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) })); }
      fail(terminal: boolean) { this.readyState = terminal ? 2 : 0; this.dispatchEvent(new Event("error")); }
    }
    Object.assign(window, { EventSource: Source, afterpartySyncStreams: streams });
    class VideoPlayer implements Player {
      position = 0;
      state = 5;
      at = performance.now();
      volume = 77;
      muted = false;
      events: { onReady: () => void; onStateChange: (event: { data: number }) => void };
      constructor(_target: HTMLElement, options: Record<string, unknown>) {
        this.events = options.events as typeof this.events;
        window.afterpartySyncPlayer = this;
        queueMicrotask(() => this.events.onReady());
      }
      emit(state: number) {
        if (this.state === 1) this.position = this.getCurrentTime();
        this.state = state;
        this.at = performance.now();
        this.events.onStateChange({ data: state });
      }
      loadVideoById(value: { startSeconds: number }) { this.position = value.startSeconds; this.at = performance.now(); this.emit(1); }
      cueVideoById(value: { startSeconds: number }) { this.position = value.startSeconds; this.at = performance.now(); this.emit(5); }
      playVideo() { if (this.state !== 1) this.emit(1); }
      pauseVideo() { if (this.state !== 2) this.emit(2); }
      seekTo(value: number) { this.position = value; this.at = performance.now(); }
      getCurrentTime() { return this.position + (this.state === 1 ? (performance.now() - this.at) / 1000 : 0); }
      getPlayerState() { return this.state; }
      setVolume(value: number) { this.volume = value; }
      getVolume() { return this.volume; }
      mute() { this.muted = true; }
      unMute() { this.muted = false; }
      isMuted() { return this.muted; }
      setPlaybackRate() {}
      destroy() {}
      scrub(seconds: number) { this.emit(3); this.position = seconds; this.at = performance.now(); this.emit(1); }
    }
    window.YT = { Player: VideoPlayer };
  });
  const commands: string[] = [], errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let discoveryCalls = 0, roomCalls = 0, closed = false, discoveryUnavailable = failDiscovery;
  const roomGates = new Map<string, Gate>(), discordGates = new Map<string, Gate>(), allGates: Gate[] = [];
  const hold = (map: Map<string, Gate>, key: string) => {
    const value = gate();
    map.set(key, value);
    allGates.push(value);
    return value;
  };
  const deliver = async (route: Route, data: unknown, status = 200) => {
    try {
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    } catch (error) {
      if (!closed && !route.request().failure()) throw error;
    }
  };
  const close = async () => {
    for (const pending of allGates) pending.release();
    try {
      // Route callbacks sample the page clock, so finish them before closing it.
      await page.unrouteAll({ behavior: "wait" });
    } finally {
      closed = true;
      await browser.close();
    }
  };
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() !== "GET") {
      commands.push(url.pathname);
      if (manager && url.pathname === "/api/admin/control") {
        const input: { guildId: string; operation: string; commandId: string; command: { action: string; queueRevision: string } } = request.postDataJSON();
        assert.equal(input.guildId, guildA);
        assert.equal(input.operation, "command");
        assert.equal(input.command.action, "seek");
        assert.equal(input.command.queueRevision, "synthetic-revision");
        return deliver(route, { id: input.commandId, status: "done" });
      }
      return deliver(route, { error: "Commands are not part of this fixture" }, 400);
    }
    if (url.pathname === "/api/realtime") {
      discoveryCalls++;
      return discoveryUnavailable
        ? deliver(route, { error: "Synthetic temporary discovery failure" }, 503)
        : deliver(route, { url: "wss://core.invalid/live" });
    }
    const now = await page.evaluate(() => Date.now());
    if (url.pathname === "/api/realtime/clock") return deliver(route, { serverTime: now });
    if (url.pathname.startsWith("/api/rooms/")) {
      const code = url.pathname.split("/").at(-1)!;
      roomCalls++;
      let snapshot = code === "TESTROOM" ? browserRoom(now) : liveRoom(discordState(code === "DISCORD1" ? guildA : guildB, "Initial concert", now));
      const pending = roomGates.get(code);
      if (pending) {
        roomGates.delete(code);
        if (pending.snapshot) snapshot = pending.snapshot;
        pending.seen();
        await pending.wait;
      }
      return deliver(route, snapshot);
    }
    if (url.pathname === "/api/discord") {
      const guild = url.searchParams.get("guildId") ?? "default";
      const state = discordState(guild === "default" ? guildA : guild, "Fallback concert", now);
      const pending = discordGates.get(guild);
      if (pending) {
        discordGates.delete(guild);
        state.ready = false;
        state.online = false;
        pending.seen();
        await pending.wait;
      }
      return deliver(route, { state });
    }
    if (url.pathname === "/api/discord/queue")
      return deliver(route, { state: { queue: [], requests: [], revision: "synthetic-queue", voteCounts: {}, skipVotes: 0 }, canManage: manager });
    if (url.pathname === "/api/history") return deliver(route, { videos: [] });
    if (url.pathname === "/api/rooms") return deliver(route, { rooms: [] });
    return deliver(route, {});
  });
  try {
    await page.goto(base + "/?room=" + (kind === "room" ? "TESTROOM" : "DISCORD1"));
    await page.getByRole("heading", { name: kind === "room" ? "Initial room video" : "Initial concert", exact: true }).first().waitFor();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    page, commands, errors,
    discoveryCalls: () => discoveryCalls,
    allowDiscovery: () => { discoveryUnavailable = false; },
    roomCalls: () => roomCalls,
    holdRoom: (code: string, snapshot?: Room) => {
      const pending = hold(roomGates, code);
      pending.snapshot = snapshot;
      return pending;
    },
    holdDiscord: (guild: string) => hold(discordGates, guild),
    close,
  };
}

async function sourceIndex(page: Page, match: string) {
  await page.waitForFunction((value) => window.afterpartySyncStreams.some((source) => source.url.includes(value) && source.readyState !== 2), match);
  return page.evaluate((value) => window.afterpartySyncStreams.findLastIndex((source) => source.url.includes(value) && source.readyState !== 2), match);
}
async function send(page: Page, index: number, payload: unknown) {
  await page.evaluate(({ index, payload }) => window.afterpartySyncStreams[index].send(payload), { index, payload });
}
async function titleVisible(page: Page, title: string) {
  await page.getByRole("heading", { name: title, exact: true }).first().waitFor();
}
async function navigate(page: Page, room: string | null) {
  await page.evaluate((room) => {
    history.pushState(null, "", room ? "/?room=" + room : "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, room);
}

test("room hooks reject delayed fallback, stale revisions and duplicate lease renewal", async () => {
  const f = await fixture("room");
  try {
    const source = await sourceIndex(f.page, "room=TESTROOM"), pending = f.holdRoom("TESTROOM");
    await f.page.clock.runFor(1100);
    await pending.started;
    const time = await f.page.evaluate(() => Date.now());
    const live: Room = { ...browserRoom(time), current: video("Live room video"), version: 8, position: 70, syncSource: "live", syncEpoch: "room-core", syncValidForMs: 5000, isHost: false };
    await send(f.page, source, { type: "room", room: live });
    await titleVisible(f.page, "Live room video");
    pending.release();
    await f.page.clock.runFor(150);
    await titleVisible(f.page, "Live room video");
    await send(f.page, source, { type: "room", room: { ...live, version: 7, serverTime: time + 100, current: video("Stale room video") } });
    await f.page.clock.runFor(100);
    await titleVisible(f.page, "Live room video");
    await f.page.clock.runFor(3500);
    await send(f.page, source, { type: "room", room: live });
    await f.page.clock.runFor(2500);
    await f.page.waitForSelector('[data-live-state="connecting:room"]');
    assert(f.roomCalls() >= 3, "Expired live state must resume room polling");
    assert.deepEqual(f.commands, [], "Transport failures must never pause or seek playback");
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("Discord discovery and terminal streams recover, and retired guild sources cannot update the new room", async () => {
  const f = await fixture("discord", true);
  try {
    await f.page.waitForSelector('[data-live-state="polling"]');
    f.allowDiscovery();
    await f.page.clock.runFor(10200);
    const first = await sourceIndex(f.page, "guildId=" + guildA);
    assert(f.discoveryCalls() >= 2, "A temporary discovery failure must be retried");
    await send(f.page, first, { type: "state", state: { ...discordState(guildA, "Guild A live", await f.page.evaluate(() => Date.now())), sequence: 8 } });
    await titleVisible(f.page, "Guild A live");
    await f.page.evaluate((index) => window.afterpartySyncStreams[index].fail(true), first);
    await f.page.clock.runFor(10200);
    const recovered = await sourceIndex(f.page, "guildId=" + guildA);
    assert(recovered > first, "A terminal EventSource must be replaced");
    await send(f.page, recovered, { type: "state", state: { ...discordState(guildA, "Recovered A", await f.page.evaluate(() => Date.now())), sequence: 9 } });
    await titleVisible(f.page, "Recovered A");
    await navigate(f.page, "D0BBBBBB");
    const next = await sourceIndex(f.page, "guildId=" + guildB);
    assert(await f.page.evaluate((index) => window.afterpartySyncStreams[index].closeCalls > 0, recovered));
    const liveB = { ...discordState(guildB, "Guild B live", await f.page.evaluate(() => Date.now())), sequence: 8 };
    await send(f.page, next, { type: "state", state: liveB });
    await titleVisible(f.page, "Guild B live");
    const wrongGuild = { ...discordState(guildA, "Wrong guild video", liveB.serverTime + 1000), sequence: 100 };
    await send(f.page, recovered, { type: "state", state: wrongGuild });
    await send(f.page, next, { type: "state", state: wrongGuild });
    await f.page.clock.runFor(100);
    await titleVisible(f.page, "Guild B live");
    const liveRoomSource = f.holdRoom("TESTROOM");
    await navigate(f.page, "TESTROOM");
    await liveRoomSource.started;
    await navigate(f.page, null);
    liveRoomSource.release();
    await f.page.clock.runFor(100);
    assert.equal(new URL(f.page.url()).searchParams.get("room"), null);
    assert.equal(await f.page.getByRole("heading", { name: "Initial room video", exact: true }).count(), 0, "A retired navigation must not reopen the room");
    assert.deepEqual(f.commands, []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("a failed in-flight Discord poll cannot mark recovered live playback offline", async () => {
  const f = await fixture("discord");
  try {
    const index = await sourceIndex(f.page, "guildId=" + guildA), pending = f.holdDiscord(guildA);
    await f.page.clock.runFor(3100);
    await pending.started;
    await send(f.page, index, { type: "state", state: { ...discordState(guildA, "Recovered concert", await f.page.evaluate(() => Date.now())), sequence: 7 } });
    await titleVisible(f.page, "Recovered concert");
    pending.release();
    await f.page.clock.runFor(100);
    const label = await f.page.locator(".studio-foot .live-label").textContent();
    assert(label?.includes("Live sync"), "The new live frame must keep Discord online");
    assert.deepEqual(f.commands, []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("confirmed Discord seeking retains a newer live timeline when its follow-up read falls back to an older bridge", async () => {
  const f = await fixture("discord", false, true);
  try {
    const index = await sourceIndex(f.page, "guildId=" + guildA);
    const active = { ...discordState(guildA, "Seeking concert", await f.page.evaluate(() => Date.now())), sequence: 8, playing: true };
    await send(f.page, index, { type: "state", state: active });
    await titleVisible(f.page, "Seeking concert");
    await f.page.locator(".stage-intro button").click();
    await f.page.waitForFunction(() => window.afterpartySyncPlayer?.getPlayerState() === 1);
    await f.page.clock.runFor(1600);
    const bridge = { ...liveRoom(active), syncSource: "bridge" as const, syncEpoch: "old-bridge", version: 999, position: 20 };
    const pending = f.holdRoom("DISCORD1", bridge);
    await f.page.evaluate(() => window.afterpartySyncPlayer!.scrub(80));
    await f.page.clock.runFor(1100);
    await pending.started;
    await send(f.page, index, { type: "state", state: { ...active, sequence: 9, position: 80, serverTime: await f.page.evaluate(() => Date.now()) } });
    pending.release();
    await f.page.clock.runFor(1400);
    const position = await f.page.evaluate(() => window.afterpartySyncPlayer!.getCurrentTime());
    assert(position >= 79 && position < 85, "The old bridge position must not undo the confirmed seek");
    assert.deepEqual(f.commands, ["/api/admin/control"]);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
