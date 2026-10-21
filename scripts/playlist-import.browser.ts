// Synthetic metadata and local room fixtures only. No provider media or live accounts.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Room, Video } from "../lib/types.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = new URL(process.env.PREVIEW_URL ?? "http://127.0.0.1:8787").origin;
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const youtube = "https://www.youtube.com/playlist?list=PL_SYNTHETIC_FESTIVAL_2026";
const spotify = "https://open.spotify.com/playlist/1234567890ABCDEFGHIJKL";
const track = (n: number): Video => ({ id: `set${String(n).padStart(8, "0")}`, title: `Synthetic festival set ${n}`, artist: "Synthetic artist", image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", duration: 3600, live: false, embeddable: true });
const saved = JSON.stringify({ version: 1, favorites: [track(999)], evenings: [] });
type Input = { action: string; id?: string; token?: string; url?: string; videoId?: string; version?: number };
async function fixture(width = 390, language = "en", full = false) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.addInitScript(({ language, saved }) => {
    localStorage.setItem("gutta-language", language); localStorage.setItem("afterparty-visitor", "a".repeat(32));
    localStorage.setItem("afterparty-host:TESTROOM", "synthetic-host"); localStorage.setItem("afterparty-library-v1", saved);
  }, { language, saved });
  let room: Room = { code: "TESTROOM", name: "Playlist test room", current: track(998), queue: full ? Array.from({ length: 50 }, (_, i) => track(i + 200)) : [],
    playing: false, position: 77, version: 1, serverTime: Date.now(), viewers: 1, isHost: true, isOwner: true, expiresAt: Date.now() + 3600000, requests: [] };
  const imports: Input[] = [], writes: Input[] = [], external: string[] = [], errors: string[] = [];
  const jobs = new Map<string, { source: string; token: string; index: number }>();
  let sequence = 0, releaseRead: (() => void) | undefined, readStarted: (() => void) | undefined, hold = false;
  let heldRead: Promise<void> = Promise.resolve();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) { external.push(request.url()); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const input: Input | undefined = request.method() === "POST" ? request.postDataJSON() : undefined;
    if (url.pathname === "/api/playlists" && input) {
      imports.push(input); assert.equal(url.search, "", "capabilities never appear in a URL");
      if (input.action === "start") {
        if (input.url?.includes("invalid.example")) return route.fulfill({ status: 400, json: { error: "Paste a YouTube or Spotify playlist link." } });
        const id = `00000000-0000-0000-0000-${String(++sequence).padStart(12, "0")}`, token = "synthetic-token-".padEnd(40, "a") + sequence;
        const source = input.url?.includes("spotify") ? "spotify" : "youtube";
        jobs.set(id, { source, token, index: sequence });
        return route.fulfill({ json: { id, token, source, status: "processing", videos: [], skipped: 0, limited: false } });
      }
      const job = jobs.get(input.id!); assert(job); assert.equal(input.token, job.token);
      if (input.action === "cancel") return route.fulfill({ json: { id: input.id, source: job.source, status: "cancelled", videos: [], skipped: 0, limited: false } });
      assert.equal(input.action, "read");
      if (hold) { hold = false; readStarted?.(); await heldRead; }
      const isSpotify = job.source === "spotify";
      try { return await route.fulfill({ json: { id: input.id, source: job.source, status: "done", videos: Array.from({ length: isSpotify ? 3 : 134 }, (_, i) => track(i + (isSpotify ? 500 : 1))), total: isSpotify ? 5 : 134, skipped: isSpotify ? 2 : 0, limited: isSpotify } }); }
      catch { /* Deliberately released after client cancellation. */ return; }
    }
    if (url.pathname === "/api/rooms/TESTROOM") {
      if (input) {
        assert.equal(input.action, "add"); assert.equal(input.version, room.version); assert.equal(request.headers().authorization, "Bearer synthetic-host");
        assert(room.queue.length < 50, "existing queue cap is preserved");
        const next = Array.from({ length: 134 }, (_, i) => track(i + 1)).find(v => v.id === input.videoId); assert(next);
        writes.push(input); room = { ...room, queue: [...room.queue, next], version: room.version + 1 };
        return route.fulfill({ json: { room } });
      }
      return route.fulfill({ json: { ...room, serverTime: Date.now() } });
    }
    if (url.pathname === "/api/discord") return route.fulfill({ json: { state: null } });
    if (url.pathname === "/api/rooms") return route.fulfill({ json: { rooms: [] } });
    if (url.pathname === "/api/history" || url.pathname === "/api/search") return route.fulfill({ json: { videos: [] } });
    if (url.pathname.includes("realtime")) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: {} });
  });
  try {
    await page.goto(base + "/?room=TESTROOM");
    await page.getByRole("heading", { name: "Playlist test room", exact: true }).first().waitFor();
    await page.locator("#library-tab").click(); await page.locator(".playlist-import").waitFor();
  } catch (error) { await browser.close(); throw error; }
  const section = page.locator(".playlist-import"), input = section.locator("input[type=url]");
  const load = async (url: string) => { await input.fill(url); await section.getByRole("button", { name: language === "en" ? "Load playlist" : "Last inn spilleliste", exact: true }).click(); };
  return { page, section, input, load, imports, writes, external, errors, room: () => room,
    holdRead() { hold = true; heldRead = new Promise(resolve => { releaseRead = resolve; }); return new Promise<void>(resolve => { readStarted = resolve; }); },
    release() { releaseRead?.(); },
    async close() { releaseRead?.(); await page.unrouteAll({ behavior: "wait" }); await browser.close(); },
  };
}
for (const [width, language] of [[390, "en"], [1440, "en"], [390, "nb"], [1440, "nb"]] as const) test(`${width}px ${language}: full 134-track preview, explicit bounded queue selection`, async () => {
  const f = await fixture(width, language);
  try {
    const { page, section } = f;
    await f.input.fill(youtube); assert.equal(f.imports.length, 0, "pasting alone never loads a playlist");
    await f.load(youtube);
    await section.getByText(language === "en" ? "134 available tracks" : "134 tilgjengelige spor", { exact: false }).waitFor();
    assert.equal(f.writes.length, 0); assert.equal(await section.locator(".playlist-import-list>li").count(), 20);
    assert.equal(await section.getByRole("link").getAttribute("href"), youtube);
    const next = section.getByRole("button", { name: language === "en" ? "Next page" : "Neste side", exact: true });
    await next.click(); await section.getByText("Synthetic festival set 21", { exact: true }).waitFor();
    await next.click(); await section.getByText("Synthetic festival set 41", { exact: true }).waitFor();
    await section.getByRole("button", { name: language === "en" ? "Select first 50" : "Velg de første 50", exact: true }).click();
    assert.equal(await section.locator("input[type=checkbox]:checked").count(), 10);
    assert.equal(await section.locator("input[type=checkbox]:disabled").count(), 10, "a 51st selection is disabled");
    assert.equal(f.writes.length, 0);
    await section.getByRole("button", { name: language === "en" ? "Clear selection" : "Tøm utvalget", exact: true }).click();
    await section.getByRole("checkbox", { name: /Synthetic festival set 41 Synthetic artist/ }).check();
    await section.getByRole("checkbox", { name: /Synthetic festival set 42 Synthetic artist/ }).check();
    const styles = await section.evaluate(el => {
      const controls = [...el.querySelectorAll<HTMLElement>("button,input,a")];
      return { overflow: document.documentElement.scrollWidth > innerWidth,
        targets: controls.every(control => control.getBoundingClientRect().height >= 44),
        colors: [...el.querySelectorAll("button")].map(button => { const style = getComputedStyle(button); return [style.backgroundColor, style.borderTopColor]; }) };
    });
    assert(!styles.overflow); assert(styles.targets, "playlist controls maintain 44px tap targets");
    for (const colors of styles.colors) for (const color of colors) { const rgb = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? []; assert(rgb.length === 3 && Math.max(...rgb) - Math.min(...rgb) < 12, `neutral surface: ${color}`); }
    await section.getByRole("button", { name: language === "en" ? "Add 2 selected to queue" : "Legg 2 valgte i køen", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".playlist-import input[type=checkbox]:checked").length === 0);
    await page.waitForFunction(() => document.querySelector(".playlist-import")?.textContent?.includes("134"));
    await page.getByRole("button", { name: language === "en" ? "Select first 48" : "Velg de første 48", exact: true }).waitFor();
    assert.deepEqual(f.writes.map(write => write.videoId), [track(41).id, track(42).id]);
    for (let i = 0; i < 4; i++) await next.click();
    await section.getByText("Synthetic festival set 134", { exact: true }).waitFor();
    assert.equal(await section.locator(".playlist-import-list>li").count(), 14);
    assert(await next.isDisabled(), "the final fourteen entries remain available on page seven");
    assert.equal(f.room().position, 77); assert.equal(f.room().playing, false); assert.equal(f.room().current?.id, track(998).id);
    assert.equal(await page.evaluate(() => localStorage.getItem("afterparty-library-v1")), saved);
    assert(!(await page.evaluate(() => JSON.stringify(localStorage))).includes("synthetic-token"));
    assert.equal(new URL(page.url()).searchParams.has("token"), false); assert.deepEqual(f.errors, []); assert.deepEqual(f.external, []);
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/playlist-import-${width}-${language}.png`, fullPage: true });
  } finally { await f.close(); }
});
test("Spotify metadata, import-limit disclosure and server validation", async () => {
  const f = await fixture();
  try {
    await f.load(spotify); await f.section.getByText("3 available tracks", { exact: false }).waitFor();
    assert.equal(await f.section.locator(".playlist-import-list>li").count(), 3);
    await f.section.getByText("2 unavailable or unmatched entries were skipped.", { exact: true }).waitFor();
    await f.section.getByText("This is a partial preview. The source or import limit may exclude some entries.", { exact: true }).waitFor();
    await f.section.getByText("Spotify track information is matched to available playback sources. Spotify audio is not streamed.", { exact: true }).waitFor();
    await f.load("https://invalid.example/playlist"); await f.section.getByRole("alert").waitFor();
    assert.equal(await f.section.getByRole("alert").innerText(), "Paste a YouTube or Spotify playlist link.");
    assert.equal(f.writes.length, 0); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
test("cancel and query edits ignore a late old read; replacement loads independently", async () => {
  const f = await fixture();
  try {
    const started = f.holdRead(); await f.load(youtube); await started;
    await f.section.getByRole("button", { name: "Cancel loading", exact: true }).click();
    await f.section.getByText("Playlist loading cancelled.", { exact: true }).waitFor();
    await f.page.waitForFunction(() => !document.querySelector(".playlist-import-list"));
    await f.load(spotify); f.release(); await f.section.getByText("3 available tracks", { exact: false }).waitFor();
    assert.equal(await f.section.locator(".playlist-import-list>li").count(), 3);
    assert(f.imports.some(input => input.action === "cancel" && input.id === "00000000-0000-0000-0000-000000000001"));
    const another = f.holdRead(); await f.load(youtube); await another;
    await f.input.fill(spotify); f.release();
    await f.page.waitForFunction(() => document.querySelector(".playlist-import")?.getAttribute("aria-busy") === "false");
    assert.equal(await f.section.locator(".playlist-import-list>li").count(), 0);
    assert.equal(f.writes.length, 0); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
test("full queue retains all preview results and disables enqueue", async () => {
  const f = await fixture(390, "en", true);
  try {
    await f.load(youtube); await f.section.getByText("134 available tracks", { exact: false }).waitFor();
    await f.section.getByText("The queue is full. Make room before adding tracks.", { exact: true }).waitFor();
    assert(await f.section.getByRole("button", { name: "Select first 0", exact: true }).isDisabled());
    assert(await f.section.getByRole("button", { name: "Add 0 selected to queue", exact: true }).isDisabled());
    assert.equal(await f.section.locator("input[type=checkbox]:disabled").count(), 20); assert.equal(f.writes.length, 0);
  } finally { await f.close(); }
});
test("ordinary search hands a playlist to the explicit import form", async () => {
  const f = await fixture();
  try {
    await f.page.locator("#music-tab").click();
    await f.page.locator(".search-form input").fill(youtube);
    await f.page.locator(".search-form button[type=submit], .search-form button:not([type])").first().click();
    await f.section.waitFor(); assert.equal(await f.input.inputValue(), youtube); assert.equal(f.imports.length, 0); assert.equal(f.writes.length, 0);
  } finally { await f.close(); }
});
test("polling pauses while hidden and resumes when visible", async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
    await f.load(youtube);
    await f.section.getByText("Loading playlist…", { exact: true }).waitFor();
    await f.page.waitForTimeout(1800);
    assert.equal(f.imports.filter(input => input.action === "start").length, 1);
    assert.equal(f.imports.filter(input => input.action === "read").length, 0);
    await f.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
    await f.section.getByText("134 available tracks", { exact: false }).waitFor();
    assert.equal(f.imports.filter(input => input.action === "read").length, 1); assert.equal(f.writes.length, 0);
  } finally { await f.close(); }
});
