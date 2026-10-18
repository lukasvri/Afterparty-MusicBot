// Isolated local design review. Synthetic API data, no external accounts or media.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import releases from "../lib/releases.json" with { type: "json" };
import type { Room } from "../lib/types.ts";
import type { Player } from "../lib/youtube-player.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:8787";
assert.equal(base, "http://127.0.0.1:8787", "Only the approved local preview is allowed");
const phase = process.env.DESIGN_PHASE ?? "after";
assert(["before", "after"].includes(phase));
const subset = process.env.DESIGN_PAGES?.split(",");
const pages = [
  ["home", "/", ".welcome-art"],
  ["concert", "/?room=TESTROOM", ".stage-panel"],
  ["rooms", "/?view=rooms", ".open-room-card"],
  ["admin", "/admin", ".admin-login"],
  ["help", "/support", ".service-page h1"],
  ["patch-notes", "/patch-notes", ".patch-entry"],
  ["install", "/install", ".service-page h1"],
  ["privacy", "/privacy", ".service-page h1"],
  ["terms", "/terms", ".service-page h1"],
].filter(([name]) => !subset || subset.includes(name));
assert(pages.length && (!subset || pages.length === subset.length), "Select known, distinct design surfaces");
const output = resolve("outputs/website-design", phase);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const checks: unknown[] = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    for (const language of ["nb", "en"] as const) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
      try {
        await context.addInitScript(({ language }) => {
          localStorage.setItem("gutta-language", language);
          localStorage.setItem("afterparty-motion", "off");
          const state = Object.assign(window, { designPlayerCount: 0, designDestroyCount: 0 });
          class PreviewPlayer implements Player {
            position = 0; volume = 60; muted = false; state = 5;
            events: { onReady: () => void; onStateChange: (event: { data: number }) => void };
            constructor(target: HTMLElement, options: Record<string, unknown>) {
              state.designPlayerCount++;
              target.dataset.previewPlayer = "stable";
              this.events = options.events as typeof this.events;
              queueMicrotask(() => this.events.onReady());
            }
            loadVideoById(value: { startSeconds: number }) { this.position = value.startSeconds; this.state = 1; }
            cueVideoById(value: { startSeconds: number }) { this.position = value.startSeconds; this.state = 5; }
            playVideo() { this.state = 1; }
            pauseVideo() { this.state = 2; }
            seekTo(value: number) { this.position = value; }
            getCurrentTime() { return this.position; }
            getPlayerState() { return this.state; }
            setVolume(value: number) { this.volume = value; }
            getVolume() { return this.volume; }
            mute() { this.muted = true; }
            unMute() { this.muted = false; }
            isMuted() { return this.muted; }
            setPlaybackRate() {}
            destroy() { state.designDestroyCount++; }
          }
          window.YT = { Player: PreviewPlayer };
        }, { language });
        let writes = 0;
        let withCurrent = false;
        await context.route("**/*", async route => {
          const url = new URL(route.request().url());
          if (url.origin !== base) return route.abort();
          if (!url.pathname.startsWith("/api/")) return route.continue();
          if (route.request().method() !== "GET") { writes++; return route.abort(); }
          const room: Room = { code: "TESTROOM", name: "Preview music room", current: null, queue: [], playing: false,
            position: 0, version: 1, serverTime: Date.now(), viewers: 2, isHost: false, isOwner: false,
            expiresAt: Date.now() + 86400000, requests: [], history: [], voteCounts: {} };
          if (withCurrent) room.current = { id: "preview0001", title: "Synthetic paused song", artist: "Preview artist",
            image: "/afterparty-mark.svg", duration: 180, live: false, embeddable: true };
          const data = url.pathname === "/api/rooms/TESTROOM" ? room
            : url.pathname === "/api/rooms" ? { rooms: [{ code: room.code, name: room.name, viewers: 2, expiresAt: room.expiresAt }] }
            : url.pathname === "/api/discord" ? { state: null }
            : url.pathname === "/api/history" ? { videos: [] }
            : url.pathname === "/api/me" ? { admin: false }
            : url.pathname === "/api/admin/guilds" ? { authenticated: false, globalAdmin: false, guilds: [], invite: "/api/bot/install" }
            : null;
          if (url.pathname.includes("realtime")) return route.abort();
          return route.fulfill({ status: data === null ? 503 : 200, json: data ?? { error: "Isolated preview" } });
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        for (const [name, path, ready] of pages) {
          await page.goto(base + path, { waitUntil: "networkidle" });
          await page.locator(ready).first().waitFor();
          await page.evaluate(() => document.fonts.ready);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width, `${name}/${language} horizontal overflow`);
          const screenshot = resolve(output, `${name}-${language}-${viewport.width}.png`);
          await page.screenshot({ path: screenshot, fullPage: name !== "patch-notes", animations: "disabled" });
          if (name === "home") {
            await page.locator(".welcome-art").screenshot({ path: resolve(output, `dj-${language}-${viewport.width}.png`), animations: "disabled" });
            assert.equal(await page.locator(".welcome-release").getAttribute("href"), "/patch-notes");
            if (phase === "after") {
              const decks = await page.locator(".welcome-art [data-dj-deck]").evaluateAll(elements => elements.map(element => {
                const box = element.getBoundingClientRect(); return { width: box.width, height: box.height };
              }));
              assert.equal(decks.length, 2);
              assert(Math.abs(decks[0].width - decks[1].width) < .1 && Math.abs(decks[0].height - decks[1].height) < .1,
                "The two decks must have identical projected dimensions");
            }
            const start = page.locator(".welcome-start");
            await start.focus();
            const focus = await start.evaluate(element => {
              const style = getComputedStyle(element); return { width: style.outlineWidth, style: style.outlineStyle };
            });
            assert(focus.width !== "0px" && focus.style !== "none", "Keyboard focus stays visible");
            await start.click();
            const dialog = page.getByRole("dialog");
            await dialog.waitFor();
            assert(await dialog.locator("input").first().evaluate(element => document.activeElement === element), "Create dialog receives focus");
            await page.keyboard.press("Escape");
            assert.equal(await dialog.isVisible(), false);
            assert(await start.evaluate(element => document.activeElement === element), "Closing returns focus to the action");
          }
          if (name === "concert") {
            assert(await page.locator(".stage-panel").isVisible());
            assert(await page.locator(".library-panel").isVisible());
          }
          if (name === "patch-notes") {
            assert.equal(await page.locator(".patch-entry h2").first().innerText(), releases[0].title);
          }
          if (phase === "after") {
            assert((await page.locator("body").evaluate(element => getComputedStyle(element).fontFamily)).includes("Afterparty"));
            const animated = await page.locator(".deck-ring,.performer-arm,.performer-head").evaluateAll(elements =>
              elements.some(element => getComputedStyle(element).animationName !== "none"));
            assert.equal(animated, false, "Reduced motion keeps the performer and decks still");
            const nav = await page.locator(".sidebar .nav-link").evaluateAll(elements => elements.map(element => {
              const box = element.getBoundingClientRect(); return { y: box.y, height: box.height };
            }));
            if (nav.length && viewport.width === 390) {
              assert(nav.every(item => item.height <= 48 && item.height >= 44), "Mobile navigation stays on one line with usable targets");
              assert(Math.max(...nav.map(item => item.y)) - Math.min(...nav.map(item => item.y)) < 1);
            }
            if (name === "home" && viewport.width === 390) {
              const controls = page.locator(".top-actions .button,.language-switch button,.welcome-start");
              for (const height of await controls.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height)))
                assert(height >= 44, "Primary mobile actions and language buttons remain at least 44px tall");
            }
          }
          const appearance = await page.evaluate(() => {
            const card = document.querySelector(".admin-login,.open-room-card");
            const style = card ? getComputedStyle(card) : null;
            return { bodyFont: getComputedStyle(document.body).fontFamily,
              card: style ? { background: style.backgroundColor, border: style.borderColor, radius: style.borderRadius } : null };
          });
          checks.push({ name, language, viewport, screenshot, appearance });
        }
        if (phase === "after" && pages.some(([name]) => name === "concert")) {
          withCurrent = true;
          await page.goto(base + "/?room=TESTROOM", { waitUntil: "networkidle" });
          await page.locator(".stage-intro .button.primary").click();
          await page.locator("[data-preview-player]").waitFor({ state: "attached" });
          const player = await page.locator("[data-preview-player]").elementHandle();
          assert(player);
          for (const id of ["music-tab", "library-tab", "queue-tab"]) {
            await page.locator("#" + id).click();
            assert.equal(await page.locator("#" + id).getAttribute("aria-selected"), "true");
            assert(await player.evaluate(element => element.isConnected), "Discovery tabs keep the same source player mounted");
          }
          await page.locator(".video-settings > summary").click();
          const settingsTabs = page.locator(".settings-tabs [role=tab]");
          await settingsTabs.first().focus();
          await page.keyboard.press("End");
          assert.equal(await settingsTabs.last().getAttribute("aria-selected"), "true");
          assert(await player.evaluate(element => element.isConnected));
          assert.deepEqual(await page.evaluate(() => {
            const state = window as unknown as { designPlayerCount: number; designDestroyCount: number };
            return [state.designPlayerCount, state.designDestroyCount];
          }), [1, 0], "UI navigation must not recreate or destroy the source player");
        }
        assert.deepEqual(errors, [], "No uncaught browser errors");
        assert.equal(writes, 0, "The design audit must never write to an API");
      } finally { await context.close(); }
    }
  }
  await writeFile(resolve(output, subset ? `checks-${subset.join("-")}.json` : "checks.json"), JSON.stringify({ phase, checks }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, status: "passed", pages: checks.length, output }, null, 2));
} finally { await browser.close(); }
