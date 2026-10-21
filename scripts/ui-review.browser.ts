// Local UI acceptance audit. Every API response and mutation is synthetic.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Locator } from "playwright";
import type { Room, Video } from "../lib/types.ts";
import { GuessGame } from "../services/core/src/guess-game.ts";
import { OperatorGuessCatalog, UnavailableGuessCatalog } from "../services/core/src/guess-catalog.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = new URL(process.env.PREVIEW_URL ?? "http://127.0.0.1:8793").origin;
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Only a local preview is allowed");
const phase = process.env.UI_REVIEW_PHASE ?? "after";
assert(["before", "after"].includes(phase));
const output = resolve(process.env.UI_REVIEW_OUTPUT ?? "outputs/ui-review", phase);
await mkdir(output, { recursive: true });
const track = (index: number): Video => ({ id: `audit${String(index).padStart(6, "0")}`, title: index === 1 ? "Synthetic Artist - A very long evening song title with extended festival recording and encore details" : `Synthetic Artist - Evening recording ${index}`, artist: "Synthetic Artist - Topic", image: "/afterparty-mark.svg", duration: 213, live: false, embeddable: true });
const settings = { playlistLimit: 50, defaultQueuePageSize: 10, defaultVolume: 60, audioBitrateKbps: 192, crossfade: 6, secondsToWaitAfterQueueEmpties: 300, leaveIfNoListeners: true, turnDownVolumeWhenPeopleSpeak: false, turnDownVolumeWhenPeopleSpeakTarget: 30, radio: true };
const catalog = new OperatorGuessCatalog(Array.from({ length: 5 }, (_, index) => ({ rightsCleared: true as const, categoryIds: ["2010s"], song: { id: `audit-${index}`, title: `Fictional Song ${index}`, artist: "Synthetic Artist", aliases: [], mediaKey: `synthetic_audit_media_${index}` }, media: { key: `synthetic_audit_media_${index}`, mimeType: "audio/wav" as const, durationSeconds: 30 } })));
const findings: { surface: string; language: string; width: number; issue: string }[] = [];
const captures: { surface: string; language: string; width: number; screenshot: string }[] = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
try {
  for (const [width, height, language] of [[1440, 1000, "en"], [390, 844, "nb"], [360, 800, "en"], [768, 1024, "nb"]] as const) {
    if (process.env.UI_REVIEW_WIDTHS && !process.env.UI_REVIEW_WIDTHS.split(",").includes(String(width))) continue;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const errors: string[] = [], commands: string[] = [], unexpected: string[] = [];
    let authenticated = false, roomList: "populated" | "empty" | "error" = "populated", sourceState: "ready" | "loading" | "unavailable" | "disabled" = "unavailable";
    let game = new GuessGame({ catalog: new UnavailableGuessCatalog() });
    let room: Room = { code: "TESTROOM", name: "Synthetic late-night listening room", current: track(1), queue: [track(2), track(3), track(4)], playing: false, position: 47, version: 1, serverTime: Date.now(), viewers: 3, isHost: true, isOwner: true, expiresAt: Date.now() + 86400000, requests: [], history: [track(5)], voteCounts: {} };
    await context.addInitScript(({ language }) => {
      localStorage.setItem("gutta-language", language);
      localStorage.setItem("afterparty-motion", "off");
      localStorage.setItem("afterparty-visitor", "a".repeat(32));
      localStorage.setItem("afterparty-host:TESTROOM", "synthetic-ui-host");
    }, { language });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const input = request.method() === "POST" ? request.postDataJSON() : undefined;
      let data: unknown = {};
      if (url.pathname === "/api/guess") {
        if (input.action === "catalog") data = { categories: sourceState === "ready" ? catalog.categories() : new UnavailableGuessCatalog().categories(), sourceState };
        else {
          const access = { scope: "room" as const, scopeId: "TESTROOM", host: true, actor: "synthetic-ui-host" };
          const fields = Object.fromEntries(Object.entries(input).filter(([key]) => !["scope", "scopeId", "token"].includes(key)));
          const value = game.apply(access, fields);
          data = { ...value, sourceState, canManage: true, canPrepare: sourceState === "unavailable", mediaAvailable: false, ...(input.action === "join" ? { token: "synthetic-ui-game-token" } : {}) };
          commands.push(`game:${input.action}`);
        }
      } else if (url.pathname === "/api/rooms/TESTROOM") {
        if (input) {
          assert.equal(input.action, "add");
          room = { ...room, queue: [...room.queue, track(9)], version: room.version + 1 };
          commands.push("room:add");
          data = { room };
        } else data = { ...room, serverTime: Date.now() };
      } else if (url.pathname === "/api/rooms") {
        if (input) {
          commands.push("room:create");
          data = { room, token: "synthetic-ui-host" };
        } else if (roomList === "error") return route.fulfill({ status: 503, json: { error: "Synthetic directory unavailable" } });
        else data = { rooms: roomList === "empty" ? [] : [{ code: room.code, name: room.name, viewers: 3, expiresAt: room.expiresAt }] };
      } else if (url.pathname === "/api/search" || url.pathname === "/api/history") data = { videos: Array.from({ length: url.pathname === "/api/search" ? 12 : 3 }, (_, index) => track(index + 1)) };
      else if (url.pathname === "/api/playlists" && input) {
        commands.push(`playlist:${input.action}`);
        data = { id: "00000000-0000-0000-0000-000000000001", token: "synthetic-import-token".padEnd(40, "a"), source: "youtube", status: input.action === "start" ? "processing" : "done", videos: input.action === "start" ? [] : [track(1), track(2)], total: 2, skipped: 0, limited: false };
      } else if (url.pathname === "/api/admin/guilds") data = { authenticated, globalAdmin: false, guilds: authenticated ? [{ id: "111111111111111", name: "Synthetic Listening Club", installed: true, roomCode: "TESTROOM" }] : [], oauthReady: true, invite: "/api/bot/install" };
      else if (url.pathname === "/api/admin/control") {
        assert.equal(request.method(), "GET", "Audit does not change admin settings");
        data = { guildId: "111111111111111", roomCode: "TESTROOM", state: { ready: true, connected: false, playing: false, current: null, queue: [], position: 0, volume: 60 }, settings, player: { loopCurrentSong: false, loopCurrentQueue: false, bitrate: 192000, radioProvider: "artist", lastfmConfigured: false }, snapshots: [], commands: [], sleepTimerEndsAt: null };
      } else if (url.pathname === "/api/discord") data = { state: null };
      else if (url.pathname === "/api/me") data = { admin: false };
      else if (url.pathname.includes("realtime") || url.pathname.includes("stream")) return route.fulfill({ status: 503, json: {} });
      else { unexpected.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 503, json: { error: "No synthetic fixture" } }); }
      return route.fulfill({ json: data });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => errors.push(error.message));
    let surface = "";
    const check = (condition: boolean, issue: string) => { if (!condition) findings.push({ surface, language, width, issue }); };
    const inspect = async (name: string, targets = "") => {
      surface = name;
      await page.evaluate(() => document.fonts.ready);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Horizontal page overflow");
      if (targets && width <= 390) {
        const small = await page.locator(targets).evaluateAll(elements => elements.filter(element => {
          const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && (box.height < 43 || box.width < 43);
        }).map(element => ({ text: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 80), width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height) })));
        check(small.length === 0, `Primary touch targets below 44px: ${JSON.stringify(small)}`);
      }
      const screenshot = resolve(output, `${name}-${language}-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: name !== "patch-notes", animations: "disabled" });
      captures.push({ surface, language, width, screenshot });
    };
    const goto = async (path: string, ready: string) => {
      const response = await page.goto(base + path, { waitUntil: "networkidle" });
      assert.equal(response?.status(), 200, `${path} returns 200`);
      await page.locator(ready).first().waitFor();
    };
    const focus = async (target: Locator) => {
      await page.keyboard.press("Tab");
      await target.focus();
      check(await target.evaluate(element => { const style = getComputedStyle(element); return document.activeElement === element && (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0 || style.boxShadow !== "none"); }), "Keyboard focus indicator is absent");
    };
    try {
      await goto("/", ".welcome-start");
      await inspect("welcome", ".welcome-start,.top-actions .button,.language-switch button");
      const start = page.locator(".welcome-start");
      await focus(start); await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog"); await dialog.waitFor();
      check(await dialog.locator("input").first().evaluate(element => element === document.activeElement), "Create dialog does not receive focus");
      check(await dialog.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1; }), "Create dialog exceeds viewport");
      await inspect("onboarding-dialog", ".room-dialog button");
      await page.keyboard.press("Escape");
      check(!await dialog.isVisible(), "Escape does not close the create dialog");
      check(await start.evaluate(element => element === document.activeElement), "Closing dialog does not restore focus");
      await goto("/?view=rooms", ".open-room-card");
      await inspect("rooms", ".room-directory button");
      await page.locator(".open-room-card button").first().click();
      await page.locator(".stage-panel").waitFor();
      await inspect("room-stage", ".mobile-party-nav button");
      await page.locator(".video-settings > summary").click();
      const settingsTabs = page.locator(".settings-tabs [role=tab]");
      await focus(settingsTabs.first()); await page.keyboard.press("End");
      assert.equal(await settingsTabs.last().getAttribute("aria-selected"), "true", "Settings tabs respond to the keyboard");
      await page.keyboard.press("Home");
      await inspect("room-settings", ".settings-tabs button,.party-tools button");
      await page.locator(".video-settings > summary").click();
      await page.locator("#queue-tab").click(); await page.locator(".afterparty-queue-track").first().waitFor();
      await inspect("room-queue");
      await page.locator("#music-tab").click();
      await page.locator(".search-suggestions button").first().waitFor();
      await inspect("search-suggestions", ".search-suggestions button,.search-form button");
      const suggestion = page.locator(".search-suggestions button").first();
      await focus(suggestion); await page.keyboard.press("Enter");
      await page.locator(".search-result-query").waitFor(); await page.locator(".music-row").nth(9).waitFor();
      await inspect("search-long-titles", ".add-track,.search-form button");
      await page.locator(".music-row .add-track").first().click();
      assert(commands.includes("room:add"), "Explicit add remains operable");
      await page.locator("#library-tab").click(); await page.locator(".concert-catalog").waitFor();
      const festival = page.locator(".concert-catalog select").first();
      const options = await festival.locator("option").count();
      if (options > 1) { await festival.selectOption({ index: 1 }); await festival.selectOption({ index: 0 }); }
      await inspect("evenings-catalog", ".concert-catalog button,.concert-catalog select,.playlist-import button");
      await page.locator(".playlist-import input[type=url]").fill("https://www.youtube.com/playlist?list=PL_SYNTHETIC_AUDIT");
      await page.locator(".playlist-import button[type=submit]").click();
      await page.locator(".playlist-import-list li").first().waitFor();
      await inspect("playlist-import", ".playlist-import button");
      assert(await page.locator(".playlist-import-list input[type=checkbox]").count() === 2, "Imported metadata stays available for explicit selection");
      if (width === 1440 || width === 390) {
        for (const state of ["empty", "error"] as const) {
          roomList = state; await goto("/?view=rooms", ".room-directory");
          await page.locator(state === "empty" ? ".directory-empty" : ".room-directory [role=alert]").waitFor();
          await inspect(`rooms-${state}`);
        }
        await goto("/admin", ".admin-login");
        await inspect("admin-sign-in", ".admin-login .button");
        assert.equal(await page.locator('a[href="/api/auth/discord"]').count(), 1);
        authenticated = true;
        await goto("/admin?guildId=111111111111111", ".guild-select select");
        await page.getByRole("button", { name: language === "en" ? "Settings" : "Innstillinger", exact: true }).click();
        await page.locator(".settings-grid input").first().waitFor();
        await inspect("admin-settings", ".settings-grid button,.guild-select select");
        for (const state of ["unavailable", "loading", "disabled", "ready"] as const) {
          sourceState = state; game = new GuessGame({ catalog: state === "ready" ? catalog : new UnavailableGuessCatalog() });
          await goto("/games?room=TESTROOM", ".guess-join");
          await page.waitForFunction(() => (document.querySelector(".guess-join input[pattern]") as HTMLInputElement)?.value === "TESTROOM");
          await inspect(`games-${state}`, ".guess-join button");
          await page.locator(".guess-join button").click(); await page.locator(".guess-stage").waitFor();
          await inspect(`games-lobby-${state}`, ".guess-settings button,.guess-settings select");
        }
        for (const name of ["patch-notes", "support", "install", "copyright", "privacy", "terms"]) {
          await goto(`/${name}`, name === "patch-notes" ? ".patch-entry" : ".service-page h1");
          await inspect(name);
          if (name === "copyright") {
            for (const [id, value] of [["name", "Synthetic Reviewer"], ["email", "reviewer@example.test"], ["works", "Synthetic example work"], ["locations", "https://example.test/synthetic-page"], ["signature", "Synthetic Reviewer"]]) await page.locator("#copyright-" + id).fill(value);
            await page.locator("#copyright-good-faith").check(); await page.locator("#copyright-accuracy").check();
            await page.getByRole("button", { name: "Prepare notice", exact: true }).click();
            await page.locator("#copyright-preview").waitFor();
            assert(await page.locator("#copyright-preview").evaluate(element => element === document.activeElement), "Prepared notice receives keyboard focus");
            await inspect("copyright-preview", ".copyright-actions button,.copyright-actions .button");
          }
        }
      }
      assert.deepEqual(errors, [], "No uncaught browser errors");
      assert.deepEqual(unexpected, [], "Every API call is explicitly controlled");
    } finally { await context.close(); }
  }
  await writeFile(resolve(output, "checks.json"), JSON.stringify({ phase, captures, findings }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, captures: captures.length, findings, output }, null, 2));
  if (phase === "after") assert.equal(findings.length, 0, "UI acceptance findings remain; see checks.json");
} finally { await browser.close(); }
