// Curated references are rendered with isolated local API responses. No actual videos or providers are loaded.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Room, Video } from "../lib/types.ts";
import { CONCERT_CATALOG } from "../lib/concert-catalog.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = new URL(process.env.PREVIEW_URL ?? "http://127.0.0.1:8787").origin;
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
assert(CONCERT_CATALOG.length > 0, "the acceptance test needs the actual curated catalog");
const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
const video = (id: string, title: string): Video => ({ id, title, artist: "Synthetic Artist", image, duration: 7200, live: false, embeddable: true });
const saved = JSON.stringify({ version: 1, favorites: [video("local000001", "Local favorite")],
  evenings: [{ id: "local-evening", name: "Local keepsake", tracks: [video("local000001", "Local favorite")], savedAt: 1 }] });
const events = [...new Set(CONCERT_CATALOG.map(entry => entry.eventId))];
const years = (eventId: string) => [...new Set(CONCERT_CATALOG.filter(entry => entry.eventId === eventId).map(entry => entry.year))].sort((a, b) => b - a);
const sets = (eventId: string, year: number) => CONCERT_CATALOG.filter(entry => entry.eventId === eventId && entry.year === year)
  .filter((entry, index, entries) => entries.findIndex(candidate => candidate.videoId === entry.videoId) === index);
const multi = CONCERT_CATALOG.find(entry => sets(entry.eventId, entry.year).length >= 2);
assert(multi, "a multi-set year is required to exercise sequential appends");
const batch = sets(multi.eventId, multi.year);

function gate() {
  let enter = () => {}, release = () => {}, finish = () => {};
  return { started: new Promise<void>(resolve => { enter = resolve; }), wait: new Promise<void>(resolve => { release = resolve; }),
    finished: new Promise<void>(resolve => { finish = resolve; }), enter: () => enter(), release: () => release(), finish: () => finish() };
}
async function fixture(width: number, language = "en", discord = false) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width, height: 1000 } }); await page.clock.install();
  await page.addInitScript(({ language, saved }) => {
    localStorage.setItem("gutta-language", language); localStorage.setItem("afterparty-visitor", "a".repeat(32));
    localStorage.setItem("afterparty-library-v1", saved);
    for (const code of ["TESTROOM", "OTHERROM", "DISCORD1"]) localStorage.setItem("afterparty-host:" + code, "synthetic-host-" + code);
  }, { language, saved });
  const initialCode = discord ? "DISCORD1" : "TESTROOM", guildId = "111111111111111111";
  const state = new Map([initialCode, "OTHERROM"].map(code => [code, { version: 1, queue: [video("queued00001", "Previously queued music")] }]));
  const room = (code: string): Room => ({ code, name: code === "OTHERROM" ? "Other room" : "Festival test room",
    current: video("current0001", "Existing paused music"), queue: state.get(code)!.queue, playing: false, position: 77,
    version: state.get(code)!.version, serverTime: Date.now(), viewers: 1, isHost: !discord, expiresAt: Date.now() + 3600000,
    ...(discord ? { mode: "discord", guildId, discordOnline: true, playbackKey: "synthetic-current" } : {}) });
  const discordState = () => ({ ...room(initialCode), roomCode: initialCode, guildId, ready: true, online: true,
    connected: true, volume: 60, queueRevision: String(state.get(initialCode)!.version), lastSeen: Date.now() });
  const writes: { code: string; id: string }[] = [], external: string[] = [], errors: string[] = [], revisions: string[] = [];
  let held: ReturnType<typeof gate> | undefined;
  const gates: ReturnType<typeof gate>[] = [];
  const close = async () => { for (const pending of gates) pending.release(); await page.unrouteAll({ behavior: "wait" }); await browser.close(); };
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) { external.push(request.url()); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const post = request.method() === "POST", input = post ? request.postDataJSON() : null;
    if (post) {
      const code = discord ? initialCode : url.pathname.split("/").at(-1)!;
      assert.equal(url.pathname, discord ? "/api/discord" : "/api/rooms/" + code);
      assert(state.has(code)); const current = state.get(code)!;
      assert.equal(input.action, discord ? "enqueue" : "add");
      if (discord) {
        assert.equal(input.guildId, guildId); revisions.push(input.queueRevision);
        if (input.queueRevision !== String(current.version)) return route.fulfill({ status: 409, json: { error: "Synthetic stale queue revision" } });
      }
      else { assert.equal(request.headers().authorization, "Bearer synthetic-host-" + code); assert.equal(input.version, current.version); }
      const entry = CONCERT_CATALOG.find(entry => entry.videoId === input.videoId); assert(entry, "only explicitly chosen curated IDs are added");
      assert(!current.queue.some(track => track.id === entry.videoId), "already queued recordings must not be submitted again");
      current.queue = [...current.queue, video(entry.videoId, entry.title)]; current.version++;
      writes.push({ code, id: entry.videoId });
      const pending = held; held = undefined;
      if (pending) { pending.enter(); await pending.wait; }
      try { return await route.fulfill({ json: discord ? { id: "synthetic-command-" + writes.length, status: "done" } : { room: room(code) } }); }
      finally { pending?.finish(); }
    }
    if (url.pathname.startsWith("/api/rooms/")) return route.fulfill({ json: room(url.pathname.split("/").at(-1)!) });
    if (url.pathname === "/api/discord") return route.fulfill({ json: { state: discord ? discordState() : null } });
    if (url.pathname === "/api/discord/queue") return route.fulfill({ json: { state: { queue: state.get(initialCode)!.queue,
      requests: [], revision: String(state.get(initialCode)!.version), voteCounts: {}, skipVotes: 0 }, canManage: true } });
    if (url.pathname === "/api/history") return route.fulfill({ json: { videos: [] } });
    if (url.pathname === "/api/rooms") return route.fulfill({ json: { rooms: [] } });
    if (url.pathname.includes("realtime")) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: {} });
  });
  try {
    await page.goto(base + "/?room=" + initialCode);
    await page.getByRole("heading", { name: discord ? "Existing paused music" : "Festival test room", exact: true }).first().waitFor();
    if (discord) await page.waitForFunction(() => document.querySelector(".social-queue")?.getAttribute("aria-busy") === "false");
    await page.locator("#library-tab").click();
    await page.locator(".concert-catalog").waitFor();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));
  } catch (error) { await close(); throw error; }
  return { page, writes, external, errors, revisions, state, room, initialCode,
    holdNext() { assert(!held); held = gate(); gates.push(held); return held; },
    close,
  };
}
async function idle(page: Awaited<ReturnType<typeof fixture>>["page"]) {
  await page.waitForFunction(() => document.querySelector(".concert-catalog")?.getAttribute("aria-busy") === "false");
}

for (const [width, language] of [[1440, "en"], [1440, "nb"], [390, "en"], [390, "nb"]] as const) test(`${width}px ${language}: curated event/year sets append explicitly and preserve the local library`, async () => {
  const f = await fixture(width, language);
  try {
    const { page } = f, section = page.locator(".concert-catalog"), initial = f.room(f.initialCode);
    const event = section.getByLabel("Festival", { exact: true }), year = section.getByLabel(language === "en" ? "Year" : "År", { exact: true });
    assert.equal(await event.inputValue(), events[0]); assert.equal(await year.inputValue(), String(years(events[0])[0]));
    assert.equal(await section.locator(".concert-catalog-list>li").count(), sets(events[0], years(events[0])[0]).length);
    const older = years(events[0]).at(-1)!; await year.selectOption(String(older));
    assert.equal(await section.locator(".concert-catalog-list>li").count(), sets(events[0], older).length);
    const otherEvent = events.find(value => value !== events[0]); assert(otherEvent);
    await event.selectOption(otherEvent);
    assert.equal(await year.inputValue(), String(years(otherEvent)[0]), "changing festival selects a valid latest year for that festival");
    assert.equal(await section.locator(".concert-catalog-list>li").count(), sets(otherEvent, years(otherEvent)[0]).length);
    await event.selectOption(multi.eventId); await year.selectOption(String(multi.year));
    assert.equal(await section.locator(".concert-catalog-list>li").count(), batch.length);
    for (const entry of batch) {
      const row = section.locator("li").filter({ has: page.getByText(entry.title, { exact: true }) });
      assert((await row.locator(".concert-set-source").innerText()).includes(entry.uploaderName));
      const source = row.getByRole("link", { name: language === "en" ? "Official video" : "Offisiell video", exact: true });
      assert.equal(await source.getAttribute("href"), "https://www.youtube.com/watch?v=" + entry.videoId);
      assert.equal(await source.getAttribute("target"), "_blank"); assert((await source.getAttribute("rel"))?.includes("noreferrer"));
    }
    assert.deepEqual(f.writes, []); assert.deepEqual(f.external, [], "opening/filtering the catalog cannot fetch external metadata, images or videos");
    const addFirst = section.locator("li").first().getByRole("button");
    const size = await addFirst.boundingBox(); assert(size && size.height >= 44);
    await addFirst.click(); await idle(page);
    assert.deepEqual(f.writes, [{ code: f.initialCode, id: batch[0].videoId }]);
    const addYear = section.getByRole("button", { name: language === "en" ? "Add selected year to queue" : "Legg valgt år i køen", exact: true });
    await addYear.click(); await idle(page);
    assert.deepEqual(f.writes, batch.map(entry => ({ code: f.initialCode, id: entry.videoId })), "the year action skips the already queued first set and preserves catalog order");
    await addYear.click(); await idle(page); assert.equal(f.writes.length, batch.length, "adding the same year again cannot duplicate recordings");
    assert.equal(f.room(f.initialCode).current!.id, initial.current!.id); assert.equal(f.room(f.initialCode).playing, false); assert.equal(f.room(f.initialCode).position, 77);
    assert.equal(await page.locator("iframe").count(), 0, "adding a full live set does not start a browser player");
    assert.equal(await page.evaluate(() => localStorage.getItem("afterparty-library-v1")), saved);
    await page.locator(".evening-library summary").filter({ hasText: "Local keepsake" }).waitFor();
    assert.deepEqual(f.external, []); assert.deepEqual(f.errors, []);
    const bounds = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(bounds.scroll <= bounds.width + 1, JSON.stringify(bounds));
    await page.screenshot({ path: `/tmp/afterparty-concert-catalog-${width}-${language}.png`, fullPage: true });
  } finally { await f.close(); }
});

test("Discord festival sets retain guild scope and fresh revisions across sequential appends", async () => {
  const f = await fixture(1440, "en", true);
  try {
    const section = f.page.locator(".concert-catalog");
    await section.getByLabel("Festival", { exact: true }).selectOption(multi.eventId);
    await section.getByLabel("Year", { exact: true }).selectOption(String(multi.year));
    await section.getByRole("button", { name: "Add selected year to queue", exact: true }).click(); await idle(f.page);
    assert.deepEqual(f.writes, batch.map(entry => ({ code: "DISCORD1", id: entry.videoId })));
    assert.deepEqual(f.revisions, batch.map((_, index) => String(index + 1)), "every append uses the fresh authoritative queue revision");
    assert.equal(f.room(f.initialCode).playing, false); assert.equal(f.room(f.initialCode).position, 77);
    assert.equal(await f.page.evaluate(() => localStorage.getItem("afterparty-library-v1")), saved);
    assert.deepEqual(f.external, []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("leaving a room during a delayed first append cannot reopen it or send the rest of its festival year", async () => {
  const f = await fixture(1440), held = f.holdNext();
  try {
    const section = f.page.locator(".concert-catalog");
    await section.getByLabel("Festival", { exact: true }).selectOption(multi.eventId);
    await section.getByLabel("Year", { exact: true }).selectOption(String(multi.year));
    await section.getByRole("button", { name: "Add selected year to queue", exact: true }).click(); await held.started;
    await f.page.evaluate(() => { history.pushState(null, "", "/?room=OTHERROM"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await f.page.getByRole("heading", { name: "Other room", exact: true }).waitFor();
    held.release(); await held.finished; await f.page.clock.runFor(200);
    await f.page.getByRole("heading", { name: "Other room", exact: true }).waitFor();
    assert.equal(new URL(f.page.url()).searchParams.get("room"), "OTHERROM");
    assert.deepEqual(f.writes, [{ code: "TESTROOM", id: batch[0].videoId }]);
    assert.deepEqual(f.state.get("OTHERROM")!.queue.map(video => video.id), ["queued00001"]);
    assert.equal(await f.page.evaluate(() => localStorage.getItem("afterparty-library-v1")), saved);
    assert.deepEqual(f.external, []); assert.deepEqual(f.errors, []);
  } finally { held.release(); await f.close(); }
});
