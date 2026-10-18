// Local UI preferences only. Synthetic APIs, no accounts or external requests.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:8787";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"]});
try {
  for (const width of [390, 1440]) {
    for (const saved of [null, "nb", "en", "invalid", "blocked"] as const) {
      const context = await browser.newContext({viewport: {width, height: 900}, locale: "nb-NO", reducedMotion: "reduce"});
      try {
        await context.addInitScript(({saved}) => {
          if (saved === "blocked") {
            Object.defineProperty(window, "localStorage", {get() {throw new DOMException("Blocked", "SecurityError");}});
          } else if (saved !== null && !sessionStorage.getItem("language-fixture-ready")) {
            localStorage.setItem("gutta-language", saved);
            sessionStorage.setItem("language-fixture-ready", "1");
          }
        }, {saved});
        let writes = 0;
        await context.route("**/*", route => {
          const url = new URL(route.request().url());
          if (url.origin !== new URL(base).origin) return route.abort();
          if (!url.pathname.startsWith("/api/")) return route.continue();
          if (route.request().method() !== "GET") {writes++; return route.abort();}
          if (url.pathname.includes("realtime")) return route.abort();
          const data = url.pathname === "/api/discord" ? {state: null}
            : url.pathname === "/api/history" ? {videos: []}
            : url.pathname === "/api/rooms" ? {rooms: []}
            : url.pathname === "/api/me" ? {admin: false}
            : {authenticated: false, guilds: [], oauthReady: true};
          return route.fulfill({json: data});
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        const response = await page.goto(base, {waitUntil: "networkidle"});
        assert(response);
        assert.equal(/<html[^>]*lang="en"/.test(await response.text()), true, "Server-rendered document starts in English");
        const language = saved === "nb" ? "nb" : "en";
        await page.getByRole("button", {name: language === "nb" ? "Spel i nettlesaren" : "Play in the browser", exact: true}).waitFor();
        assert.equal(await page.locator("html").getAttribute("lang"), language);
        assert.equal(await page.getByRole("button", {name: language === "nb" ? "Bokmål" : "English", exact: true}).getAttribute("aria-pressed"), "true");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        const next = language === "nb" ? "en" : "nb";
        await page.getByRole("button", {name: next === "nb" ? "Bokmål" : "English", exact: true}).click();
        await page.getByRole("button", {name: next === "nb" ? "Spel i nettlesaren" : "Play in the browser", exact: true}).waitFor();
        assert.equal(await page.locator("html").getAttribute("lang"), next);
        if (saved !== "blocked") {
          await page.reload({waitUntil: "networkidle"});
          await page.getByRole("button", {name: next === "nb" ? "Spel i nettlesaren" : "Play in the browser", exact: true}).waitFor();
          assert.equal(await page.locator("html").getAttribute("lang"), next, "Explicit choice survives reload");
        }
        assert.deepEqual(errors, []);
        assert.equal(writes, 0);
        console.log(`PASS language ${width}px saved=${saved}: English default, explicit choice and document language`);
      } finally {await context.close();}
    }
  }
} finally {await browser.close();}
