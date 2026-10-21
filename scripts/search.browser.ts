// Rendered search uses only local synthetic API responses, never real providers or media.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Route } from "playwright";
import type { Room, Video } from "../lib/types.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = new URL(process.env.PREVIEW_URL ?? "http://127.0.0.1:8787").origin;
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const track = (id: string, title: string, artist = "Synthetic Artist - Topic"): Video => ({
  id, title, artist, image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
  duration: 180, live: false, embeddable: true,
});
function gate() {
  let entered = () => {}, release = () => {};
  return { started: new Promise<void>(resolve => { entered = resolve; }),
    wait: new Promise<void>(resolve => { release = resolve; }), entered: () => entered(), release: () => release() };
}
async function fixture(width: number, language = "en") {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.clock.install();
  await page.addInitScript(language => {
    localStorage.setItem("gutta-language", language); localStorage.setItem("afterparty-visitor", "a".repeat(32));
  }, language);
  const errors: string[] = [], searches: string[] = [], writes: string[] = [];
  const holds = new Map<string, ReturnType<typeof gate>>(), allHolds: ReturnType<typeof gate>[] = [];
  const results = Array.from({ length: 30 }, (_, index) => track("found" + String(index + 1).padStart(6, "0"), "Search Result " + (index + 1)));
  let queue: Video[] = [], revision = 1;
  const room = (): Room => ({ code: "TESTROOM", name: "Synthetic search room", current: track("current0001", "Current Artist - Current Song", "Current Artist - Topic"),
    queue, playing: false, position: 0, version: revision, serverTime: Date.now(), viewers: 1, isHost: true, expiresAt: Date.now() + 3600000 });
  page.on("pageerror", error => errors.push(error.message));
  const deliver = async (route: Route, data: unknown, status = 200) => {
    try { await route.fulfill({ status, json: data }); }
    catch (error) { if (!route.request().failure()) throw error; }
  };
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() !== "GET") {
      assert.equal(url.pathname, "/api/rooms/TESTROOM");
      const input = request.postDataJSON(); assert.equal(input.action, "add");
      const selected = results.find(video => video.id === input.videoId); assert(selected);
      writes.push(selected.id); queue = [...queue, selected]; revision++;
      return deliver(route, { room: room() });
    }
    if (url.pathname === "/api/rooms/TESTROOM") return deliver(route, room());
    if (url.pathname === "/api/search") {
      const query = url.searchParams.get("q")!; searches.push(query);
      const held = holds.get(query);
      if (held) { held.entered(); await held.wait; }
      return query.startsWith("Slow") ? deliver(route, { error: "Retired search failed" }, 503) : deliver(route, { videos: results });
    }
    if (url.pathname === "/api/history") return deliver(route, { videos: [
      { ...track("history0000", "Machine Artist - Fabricated Song", "Machine Artist - Topic"), aiGenerated: true },
      track("history0005", "Generator Artist - Prompted Song (AI generated)", "Generator Artist - Topic"),
      track("history0001", "History Artist - Earlier Song", "History Artist - Topic"),
      track("history0002", "History Artist - Another Song", "History Artist - Topic"),
      track("history0003", "Single Song", "Trap Nation"),
      track("history0004", "Other Song", "Unverified Uploader"),
    ] });
    if (url.pathname === "/api/discord") return deliver(route, { state: null });
    if (url.pathname === "/api/rooms") return deliver(route, { rooms: [] });
    if (url.pathname.includes("realtime")) return deliver(route, {}, 503);
    return deliver(route, {});
  });
  await page.goto(base + "/?room=TESTROOM");
  await page.locator("#music-tab").click();
  await page.getByRole("button", { name: language === "en" ? "Search for Current Artist" : "Søk etter Current Artist", exact: true }).waitFor();
  await page.locator(".music-row").filter({ hasText: "History Artist - Earlier Song" }).waitFor();
  return { page, errors, searches, writes, results,
    hold(query: string) { const held = gate(); holds.set(query, held); allHolds.push(held); return held; },
    async close() { for (const held of allHolds) held.release(); await page.unrouteAll({ behavior: "wait" }); await browser.close(); },
  };
}

for (const [width, language] of [[1440, "en"], [390, "en"], [390, "nb"]] as const) {
  test(`${width}px ${language}: local suggestions and thirty results retain keyboard access and bounded requests`, async () => {
    const f = await fixture(width, language);
    try {
      const { page } = f, suggestion = page.getByRole("button", { name: language === "en" ? "Search for Current Artist" : "Søk etter Current Artist", exact: true });
      assert.equal(f.searches.length, 0, "showing suggestions cannot start provider searches");
      assert(await page.locator(".search-suggestions button").count() <= 4);
      assert.equal(await page.locator(".search-suggestions").getByText("Trap Nation", { exact: true }).count(), 0);
      assert.equal(await page.locator(".search-suggestions").getByText("Unverified Uploader", { exact: true }).count(), 0, "bare uploaders are not guessed to be artists");
      assert.equal(await page.locator(".search-suggestions").getByText("Machine Artist", { exact: true }).count(), 0, "explicitly marked AI history is not suggested");
      assert.equal(await page.locator(".search-suggestions").getByText("Generator Artist", { exact: true }).count(), 0, "explicit AI title labels are respected without a flag");
      await page.screenshot({ path: `/tmp/afterparty-search-suggestions-${width}-${language}.png`, fullPage: true });
      await suggestion.focus(); await page.keyboard.press("Enter");
      await page.locator(".search-result-query").getByText(language === "en" ? "Results for Current Artist" : "Resultater for Current Artist", { exact: true }).waitFor();
      await page.locator(".music-row").nth(9).waitFor();
      assert.equal(await page.locator(".music-row").count(), 10);
      assert.deepEqual(f.searches, ["Current Artist"]);
      const more = page.getByRole("button", { name: language === "en" ? "Show 10 more" : "Vis 10 flere", exact: true });
      await more.focus(); await page.keyboard.press("Enter");
      await page.locator(".music-row").nth(19).waitFor(); assert.equal(await page.locator(".music-row").count(), 20);
      assert(await more.evaluate(button => button === document.activeElement), "pagination retains keyboard focus");
      await page.keyboard.press("Space"); await page.locator(".music-row").nth(29).waitFor();
      assert.equal(await page.locator(".music-row").count(), 30);
      const complete = page.getByRole("button", { name: language === "en" ? "All results shown" : "Alle resultater vises", exact: true });
      assert.equal(await complete.getAttribute("aria-disabled"), "true");
      assert(await complete.evaluate(button => button === document.activeElement));
      await page.keyboard.press("Enter"); assert.deepEqual(f.searches, ["Current Artist"], "more results never call the server");
      const bounds = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert(bounds.scroll <= bounds.width + 1, JSON.stringify(bounds));
      await page.screenshot({ path: `/tmp/afterparty-search-${width}-${language}.png`, fullPage: true });
      const added = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/rooms/TESTROOM");
      await page.locator(".music-row").nth(29).locator(".add-track").click(); await added;
      assert.deepEqual(f.writes, [f.results[29].id], "the thirtieth result uses the existing explicit add boundary");
      const input = page.locator(".search-form input"); await input.fill("History");
      assert.equal(await page.locator(".search-result-query").count(), 0);
      await page.getByRole("button", { name: language === "en" ? "Search for History Artist" : "Søk etter History Artist", exact: true }).click();
      await page.locator(".music-row").filter({ hasText: "Search Result 10" }).waitFor();
      assert.equal(await page.locator(".music-row").count(), 10, "a different query resets local pagination");
      assert.deepEqual(f.searches, ["Current Artist", "History Artist"]);
      await input.fill("Current Artist"); await page.locator(".search-form button").click();
      await page.locator(".music-row").filter({ hasText: "Search Result 10" }).waitFor();
      assert.equal(await page.locator(".music-row").count(), 10, "repeating an earlier expanded query starts with ten results again");
      assert.deepEqual(f.searches, ["Current Artist", "History Artist", "Current Artist"]);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}

test("editing a pending query and returning to history retire old responses and errors", async () => {
  const f = await fixture(1440);
  try {
    const { page } = f, input = page.locator(".search-form input"), slow = f.hold("Slow first");
    await input.fill("Slow first"); await page.locator(".search-form button").click(); await slow.started;
    const canceled = page.waitForEvent("requestfailed", request => new URL(request.url()).pathname === "/api/search" && new URL(request.url()).searchParams.get("q") === "Slow first");
    await input.fill("Fresh query"); await canceled;
    assert.equal(await page.locator(".search-result-query").count(), 0, "edited input cannot label a pending old search");
    await page.locator(".search-form button").click();
    await page.getByText("Results for Fresh query", { exact: true }).waitFor(); await page.locator(".music-row").nth(9).waitFor();
    slow.release(); await page.clock.runFor(100);
    assert.equal(await input.inputValue(), "Fresh query"); assert.equal(await page.getByText("Retired search failed", { exact: true }).count(), 0);
    assert.equal(await page.locator(".music-row").count(), 10);
    const history = f.hold("Slow history");
    await input.fill("Slow history"); await page.locator(".search-form button").click(); await history.started;
    const canceledHistory = page.waitForEvent("requestfailed", request => new URL(request.url()).pathname === "/api/search" && new URL(request.url()).searchParams.get("q") === "Slow history");
    await page.getByRole("button", { name: "History", exact: true }).click(); await canceledHistory;
    history.release(); await page.clock.runFor(100);
    assert.equal(await input.inputValue(), ""); assert.equal(await page.locator(".search-result-query").count(), 0);
    await page.locator(".music-row").filter({ hasText: "History Artist - Earlier Song" }).waitFor();
    assert.equal(await page.getByText("Retired search failed", { exact: true }).count(), 0);
    assert.deepEqual(f.searches, ["Slow first", "Fresh query", "Slow history"]); assert.deepEqual(f.writes, []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
