// Exercises the real SDK with synthetic RPC messages in Playwright, never a real Discord account.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Room } from "../lib/types.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:8787";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox"] });
const guildId = "111111111111111111", userId = "222222222222222222", clientId = "333333333333333333";
const url = `${base}/activity?frame_id=synthetic-frame&instance_id=synthetic-instance&platform=desktop&guild_id=${guildId}&room=EVILROOM`;
const output = process.env.SCREENSHOT_DIR ?? "/tmp/afterparty-activity-screenshots";
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await context.addInitScript(({ userId, clientId }) => {
    localStorage.setItem("gutta-language", "en");
    localStorage.setItem("afterparty-host:ACTIVITY", "synthetic-standalone-capability");
    const state = window as unknown as { activityRpc: string[]; activityScopes: string[]; activityState: string; pauseActivityReady: boolean; rejectActivityAuth: boolean; mismatchActivityUser: boolean };
    state.activityRpc = []; state.activityScopes = []; state.activityState = "";
    state.pauseActivityReady = false; state.rejectActivityAuth = false; state.mismatchActivityUser = false;
    const post = window.postMessage.bind(window);
    const respond = (data: unknown) => setTimeout(() => window.dispatchEvent(new MessageEvent("message", { data: [1, data], origin: location.origin, source: window })), 0);
    window.postMessage = ((tuple: unknown, ...rest: unknown[]) => {
      if (!Array.isArray(tuple)) return Reflect.apply(post, window, [tuple, ...rest]);
      const [opcode, payload] = tuple;
      if (opcode === 0) {
        if (!state.pauseActivityReady) respond({ cmd: "DISPATCH", evt: "READY", nonce: null, data: { v: 1, config: { api_endpoint: "//discord.com/api", environment: "production" }, user: { id: userId, username: "Synthetic", discriminator: "0" } } });
        return;
      }
      if (opcode === 2) { state.activityRpc.push("CLOSE"); return; }
      if (opcode !== 1) return;
      state.activityRpc.push(payload.cmd);
      if (payload.cmd === "AUTHORIZE") {
        state.activityScopes = payload.args.scope; state.activityState = payload.args.state;
        respond(state.rejectActivityAuth ? { cmd: payload.cmd, evt: "ERROR", nonce: payload.nonce, data: { code: 4001, message: "Synthetic cancellation" } } : { cmd: payload.cmd, evt: null, nonce: payload.nonce, data: { code: "synthetic-auth-code" } });
      } else if (payload.cmd === "AUTHENTICATE") {
        if (payload.args.access_token !== "synthetic-activity-token") throw new Error("Unexpected synthetic token");
        respond({ cmd: payload.cmd, evt: null, nonce: payload.nonce, data: { access_token: "synthetic-activity-token", user: { id: state.mismatchActivityUser ? "999999999999999999" : userId, username: "Synthetic", discriminator: "0", public_flags: 0 }, scopes: ["identify", "guilds"], expires: new Date(Date.now() + 1800000).toISOString(), application: { id: clientId, description: "Synthetic fixture", name: "Afterparty" } } });
      }
    }) as typeof window.postMessage;
  }, { userId, clientId });
  let enabled = true, authStatus = 200, authRequests = 0, bridgeRequests = 0, logoutRequests = 0;
  const ordinaryPaths: string[] = [];
  const playbackPosts: string[] = [];
  const room: Room = { code: "ACTIVITY", guildId, mode: "discord", name: "Synthetic server concert", current: { id: "seed1234567", title: "A shared concert", artist: "Synthetic artist", image: "/afterparty-mark.svg", duration: 3600, live: false, embeddable: true, concert: true }, queue: [], playing: true, position: 120, version: 4, serverTime: Date.now(), viewers: 4, isHost: false, expiresAt: Date.now() + 86400000, playbackKey: "synthetic-playback", discordOnline: true };
  await context.route("**/*", async route => {
    const target = new URL(route.request().url());
    assert(!target.href.includes("synthetic-activity-token") && !target.href.includes("synthetic-auth-code"));
    if (target.origin !== base) return route.abort();
    if (!target.pathname.startsWith("/api/")) return route.continue();
    if (target.pathname === "/api/activity") return route.fulfill({ json: enabled ? { enabled: true, clientId, state: "synthetic-one-use-state-123456" } : { enabled: false } });
    if (target.pathname === "/api/activity/logout") { logoutRequests++; return route.fulfill({ json: { ok: true } }); }
    if (target.pathname === "/api/activity/auth") {
      authRequests++;
      assert.deepEqual(route.request().postDataJSON(), { code: "synthetic-auth-code", guildId, state: "synthetic-one-use-state-123456" });
      return route.fulfill({ status: authStatus, json: authStatus === 200 ? { accessToken: "synthetic-activity-token", guildId, userId, roomCode: "ACTIVITY", expiresAt: Date.now() + 1800000 } : { error: "Synthetic denial" } });
    }
    if (target.pathname === "/api/activity/bridge") {
      bridgeRequests++;
      assert.equal(route.request().headers().authorization, undefined);
      assert.equal(route.request().headers()["x-afterparty-visitor"], undefined);
      const path = target.searchParams.get("path")!;
      if (route.request().method() === "POST" && (path.startsWith("/api/discord") || path.startsWith("/api/rooms"))) playbackPosts.push(path);
      assert(!path.includes("EVILROOM"), "The Activity must ignore a caller-supplied room");
      if (path === "/api/rooms/ACTIVITY") return route.fulfill({ json: room });
      if (path.startsWith("/api/discord/queue")) return route.fulfill({ json: { state: { queue: [], requests: [], revision: "q1" }, canManage: false } });
      if (path.startsWith("/api/discord")) { assert(path.includes(guildId)); return route.fulfill({ json: { state: { guildId, ready: true, connected: true, playing: true, position: 120, volume: 100, current: room.current, queue: [], queueRevision: "q1", lastSeen: Date.now(), online: true } } }); }
      return route.fulfill({ json: { videos: [], state: null } });
    }
    ordinaryPaths.push(target.pathname);
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  const logs: string[] = [];
  page.on("console", message => logs.push(message.text()));
  await page.goto(url);
  assert.equal(bridgeRequests, 0);
  assert.equal(authRequests, 0);
  await page.screenshot({ path: `${output}/activity-entry.png`, fullPage: true });
  await page.getByRole("button", { name: "Connect with Discord" }).click();
  await page.locator(".studio-heading h1").waitFor().catch(async error => { console.error("Activity phase:", await page.locator(".activity-root").getAttribute("data-activity-phase"), "RPC:", await page.evaluate(() => (window as unknown as { activityRpc: string[] }).activityRpc)); await page.screenshot({ path: `${output}/activity-failure.png`, fullPage: true }); throw error; });
  assert.equal(await page.getByRole("button", { name: "Create room", exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Admin", exact: true }).count(), 0);
  assert.equal(ordinaryPaths.length, 0);
  assert.deepEqual(await page.evaluate(() => (window as unknown as { activityScopes: string[] }).activityScopes), ["identify", "guilds"]);
  assert.equal(await page.evaluate(() => (window as unknown as { activityState: string }).activityState), "synthetic-one-use-state-123456");
  assert(bridgeRequests > 0);
  assert.equal(playbackPosts.length, 0, "Signing in must not send any playback command");
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes("synthetic-activity-token")), false);
  assert(!logs.some(text => text.includes("synthetic-activity-token") || text.includes("synthetic-auth-code")));
  await page.screenshot({ path: `${output}/activity-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/activity-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: "Try connecting again" }).waitFor();
  assert.equal(logoutRequests, 1, "Explicit disconnect must clear the separate server session");
  await page.evaluate(() => fetch("/api/search?q=transport-restored"));
  assert(ordinaryPaths.includes("/api/search"), "Disconnect must restore standalone fetch");
  const beforeDisabled = authRequests;
  enabled = false;
  await page.getByRole("button", { name: "Try connecting again" }).click();
  await page.getByText("This Activity is not available with the current configuration.").waitFor();
  assert.equal(authRequests, beforeDisabled);
  enabled = true; authStatus = 403;
  await page.getByRole("button", { name: "Try connecting again" }).click();
  await page.getByText("This Discord server is not eligible for the private Activity test, or your membership could not be verified.").waitFor();
  assert.equal(await page.locator(".studio-heading h1").count(), 0);
  authStatus = 200;
  await page.evaluate(() => { (window as unknown as { mismatchActivityUser: boolean }).mismatchActivityUser = true; });
  await page.getByRole("button", { name: "Try connecting again" }).click();
  await page.getByText("Discord account verification did not match. Connect again to retry.").waitFor();
  await page.evaluate(() => { (window as unknown as { mismatchActivityUser: boolean; pauseActivityReady: boolean }).mismatchActivityUser = false; (window as unknown as { pauseActivityReady: boolean }).pauseActivityReady = true; });
  await page.getByRole("button", { name: "Try connecting again" }).click();
  await page.getByText("Connecting to Discord…", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel connection" }).click();
  await page.getByRole("button", { name: "Try connecting again" }).waitFor();
  assert.equal(await page.locator(".studio-heading h1").count(), 0);
  await page.clock.install();
  const beforeTimeout = authRequests;
  await page.getByRole("button", { name: "Try connecting again" }).click();
  await page.getByText("Connecting to Discord…", { exact: true }).waitFor();
  await page.clock.fastForward("01:01");
  await page.getByText("Connection cancelled or timed out. Try connecting again.").waitFor();
  assert.equal(authRequests, beforeTimeout, "A timed out SDK handshake must not exchange a code");
  await page.evaluate(() => { (window as unknown as { pauseActivityReady: boolean }).pauseActivityReady = false; });
  await page.getByRole("button", { name: "Try connecting again" }).click();
  await page.locator(".studio-heading h1").waitFor();
  await page.clock.fastForward("30:01");
  await page.getByText("Your Activity session expired. Connect again to continue.").waitFor();
  assert.equal(await page.locator(".studio-heading h1").count(), 0);
  console.log("Activity browser mock workflows passed using real SDK RPC; no live Discord connection.");
  await context.close();
} finally { await browser.close(); }
