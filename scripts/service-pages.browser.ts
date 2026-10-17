import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:8787";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Use an isolated local preview");
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const clientErrors: string[] = [];
  page.on("pageerror", error => clientErrors.push(error.message));
  page.on("console", message => { if(message.type() === "error" && message.text().includes("[vinext]")) clientErrors.push(message.text()); });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const data = url.pathname === "/api/admin/guilds" ? { authenticated: false, guilds: [], oauthReady: true }
      : url.pathname === "/api/realtime" ? { url: null }
      : url.pathname === "/api/discord" ? { state: null }
      : { videos: [], rooms: [] };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await mkdir("outputs", { recursive: true });
  for (const pathname of ["/", "/admin", "/install", "/support", "/privacy", "/terms", "/patch-notes"]) {
    const response = await page.goto(base + pathname);
    assert(response, pathname + " returns a navigation response");
    assert.equal(response.status(), 200, pathname + " loads");
    await page.locator("h1:visible").first().waitFor();
    if (pathname === "/admin") await page.locator('a[href="/api/auth/discord"]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const text = await page.locator("body").innerText();
    assert(!/OpenAI|ChatGPT/i.test(text), pathname + " has no platform presentation");
    assert.equal(await page.locator('a[href*="signin-with-"],a[href*="signout-with-"]').count(), 0, pathname + " has no platform login links");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, pathname + " fits desktop");
    if (pathname === "/" || pathname === "/admin") await page.screenshot({ path: `outputs/release-${pathname === "/" ? "home" : "admin"}.png`, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, pathname + " fits mobile");
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.goto(base + '/support');
  await page.getByRole('navigation',{name:'Service information'}).getByRole('link',{name:'Terms of Service',exact:true}).click();
  await page.getByRole('heading',{name:'Terms of Service',exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/terms');
  await page.getByRole('navigation',{name:'Service information'}).getByRole('link',{name:'Music room',exact:true}).click();
  await page.getByRole('heading',{name:'Afterparty',exact:true}).waitFor();
  assert.deepEqual(clientErrors,[], 'Navigation and prefetch must not report client errors');
  console.log("PASS home, admin, install, support, privacy, terms and release notes: no platform presentation, intact Discord sign-in and desktop/mobile layout");
} finally { await browser.close(); }
