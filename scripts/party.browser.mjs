// Synthetic UI workflows. Run only against a local production preview.
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:8787";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const track = {
    id: "seed1234567",
    title: "Synthetic evening song",
    artist: "Test artist",
    image: "",
    duration: 180,
    live: false,
    embeddable: true,
  };
  let room = {
    code: "TESTROOM",
    name: "Synthetic evening",
    current: null,
    queue: [],
    playing: false,
    position: 0,
    version: 1,
    serverTime: Date.now(),
    viewers: 1,
    isHost: true,
    isOwner: true,
    isPublic: false,
    expiresAt: Date.now() + 86400000,
    requests: [],
    history: [],
    voteCounts: {},
  };
  const commands = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let data = {};
    const input =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : null;
    if (url.pathname === "/api/rooms" && input) {
      assert.equal(input.isPublic, false);
      data = { room, token: "a".repeat(64) };
    } else if (url.pathname === "/api/rooms")
      data = {
        rooms: [
          {
            code: room.code,
            name: room.name,
            viewers: 1,
            expiresAt: room.expiresAt,
          },
        ],
      };
    else if (url.pathname === "/api/rooms/TESTROOM") {
      if (input) {
        commands.push(input);
        assert(!input.actorHash);
        if (input.action === "add") {
          room = { ...room, current: track, version: room.version + 1 };
        }
        if (input.action === "approval")
          room = {
            ...room,
            approvalRequired: input.enabled,
            version: room.version + 1,
          };
        data = { room };
      } else data = room;
    } else if (url.pathname === "/api/search") data = { videos: [track] };
    else if (url.pathname === "/api/history") data = { videos: [] };
    else if (url.pathname === "/api/discord") data = { state: null };
    else if (url.pathname.includes("realtime")) return route.abort();
    else data = { error: "Synthetic unavailable endpoint" };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  const page = await context.newPage();
  await page.goto(base);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("heading", { name: "Afterparty", exact:true }).waitFor();
    const geometry = await page.locator(".welcome-art").evaluate(el => {
      const frame = el.getBoundingClientRect();
      const head = el.querySelector(".performer-head").getBoundingClientRect();
      const rig = el.querySelector(".stage-truss").getBoundingClientRect();
      return { contained: head.top >= frame.top && head.bottom <= frame.bottom && head.left >= frame.left && head.right <= frame.right && rig.top >= frame.top,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert(geometry.contained, "DJ head and lighting rig must remain inside the welcome scene");
    assert(!geometry.overflow, "Welcome page must fit the viewport");
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/v2-welcome-${width}.png`, fullPage: true });
  }
  await page.locator(".welcome-release").click();
  await page.getByRole("heading", { name: "Stable live playback and a quieter room" }).waitFor();
  assert(!(await page.locator("body").innerText()).includes("This build uses semantic versioning"));
  await page.goto(base);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Spel i nettlesaren" }).click();
  const dialog = page.getByRole("dialog", { name: "Start kvelden" });
  await dialog.waitFor();
  assert(
    await dialog
      .getByRole("radio", { name: "Berre dei med lenkja" })
      .isChecked(),
  );
  await dialog.getByLabel("Namn på kvelden").fill("Synthetic evening");
  await dialog.getByLabel("Første låt eller artist").fill("Synthetic");
  await dialog.getByRole("button", { name: "Opprett og finn musikk" }).click();
  const search = page.getByRole("textbox", {
    name: "Søk etter låt, artist eller YouTube-lenke",
  });
  await search.waitFor();
  await page.waitForTimeout(500);
  assert(await search.evaluate((e) => document.activeElement === e));
  assert(
    await search.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom < innerHeight;
    }),
  );
  await page
    .getByRole("button", { name: /Legg.*Synthetic evening song/ })
    .click();
  await page.getByRole("tab", { name: "Kø" }).click();
  await page.locator(".queue-options summary").click();
  await page
    .getByRole("checkbox", { name: "Godkjenn gjestene sine låtønske" })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".approval-choice input")?.checked,
  );
  assert(commands.some((c) => c.action === "approval" && c.enabled));
  await page.getByRole("tab", { name: "Kveldar", exact: true }).click();
  await page.getByRole("button", { name: "Lagre spelekøen" }).click();
  await page.getByText("Kvelden er lagra.", { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: "Favoritt Synthetic evening song",
      exact: true,
    })
    .click();
  assert(
    (await page
      .getByRole("button", {
        name: "Favoritt Synthetic evening song",
        exact: true,
      })
      .getAttribute("aria-pressed")) === "true",
  );
  await page.locator(".room-options summary").click();
  await page.getByRole("button", { name: "TV-modus", exact: true }).click();
  assert(new URL(page.url()).searchParams.get("tv") === "1");
  await page.getByAltText("QR-kode for å bli med i rommet").waitFor();
  assert(!(await page.getByRole("tab", { name: "Kø" }).isVisible()));
  await page
    .getByRole("button", { name: "Avslutt TV-modus", exact: true })
    .click();
  const previous = page.url();
  await page.getByRole("link", { name: "Åpne rom", exact: true }).click();
  await page.goBack();
  assert.equal(page.url(), previous);
  await page.getByRole("tab", { name: "Kveldar", exact: true }).click();
  assert(
    await page.getByText("Kvelden vår · 1 låtar", { exact: true }).count(),
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  if (process.env.SCREENSHOT_DIR) {
    await page.screenshot({
      path: process.env.SCREENSHOT_DIR + "/mobile-library.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("tab", { name: "Kø" }).click();
    await page.screenshot({
      path: process.env.SCREENSHOT_DIR + "/desktop-party.png",
      fullPage: true,
    });
  }
  console.log(
    "PASS private setup, first search focus, add, moderation, library, favorite, QR, TV, browser back and mobile overflow",
  );
  room = {
    ...room,
    current: null,
    queue: [],
    history: [track],
    version: room.version + 1,
  };
  await page.goto(base + "/?room=TESTROOM");
  await page.getByRole("tab", { name: "Kveldar", exact: true }).click();
  await page
    .getByRole("button", { name: "Lagre kveldshistorikken", exact: true })
    .click();
  await page.getByText("Kvelden er lagra.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("heading", { name: "Our evenings", exact: true })
    .waitFor();
  await page.goto(base + "/?room=TESTROOM&tv=1");
  await page
    .getByRole("button", { name: "Exit TV mode", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("tv"), "1");
  console.log(
    "PASS completed evening history, English workflow and TV deep link",
  );
  await context.close();
} finally {
  await browser.close();
}
