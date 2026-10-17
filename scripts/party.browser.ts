// Synthetic UI workflows. Run only against a local production preview.
import assert from "node:assert/strict";
import type { Room, Video } from "../lib/types.ts";
type RoomRequest = { action?: string; enabled?: boolean; actorHash?: string; isPublic?: boolean };
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
) as typeof import("playwright");
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
  const track: Video = {
    id: "seed1234567",
    title: "Synthetic evening song",
    artist: "Test artist",
    image: "",
    duration: 180,
    live: false,
    embeddable: true,
  };
  let room: Room = {
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
  const commands: RoomRequest[] = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let data: unknown = {};
    const input: RoomRequest | null =
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
          room = room.current ? { ...room, queue: [...room.queue, {...track, id: "next1234567", title: "Second queued song"}], version: room.version + 1 } : { ...room, current: track, version: room.version + 1 };
        }
        if (input.action === "radio") room = {...room, radio:input.enabled, version:room.version+1};
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
  for (const width of [360, 390, 768, 1440, 2560]) {
    await page.setViewportSize({ width, height: width === 2560 ? 1440 : 900 });
    await page.getByRole("heading", { name: "Afterparty", exact:true }).waitFor();
    const geometry = await page.locator(".welcome-art").evaluate(el => {
      const frame = el.getBoundingClientRect();
      const head = el.querySelector(".performer-head")!.getBoundingClientRect();
      const rig = el.querySelector(".stage-truss")!.getBoundingClientRect();
      const booth = el.querySelector(".dj-booth")!.getBoundingClientRect();
      const speakers = el.querySelector(".speaker-stacks")!.getBoundingClientRect();
      return { contained: head.top >= frame.top && head.bottom <= frame.bottom && head.left >= frame.left && head.right <= frame.right && rig.top >= frame.top,
        stageContained: booth.bottom <= frame.bottom && speakers.left >= frame.left && speakers.right <= frame.right,
        centred: Math.abs((booth.left + booth.right) / 2 - (frame.left + frame.right) / 2) < frame.width * .01,
        headScale: head.height / frame.height,
        artworkCentred: Math.abs((frame.left + frame.right) / 2 - innerWidth / 2) < 2,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert(geometry.contained, "DJ head and lighting rig must remain inside the welcome scene");
    assert(geometry.stageContained, "The console and both speakers must fit the welcome scene");
    assert(geometry.centred, "The DJ console must be centred within the welcome artwork");
    assert(geometry.headScale > .12, "The DJ must remain legible in the responsive welcome artwork");
    if (width <= 950) assert(geometry.artworkCentred, "Tablet and mobile artwork must be centred on the page");
    assert(!geometry.overflow, "Welcome page must fit the viewport");
    if(width===2560){
      const content=await page.locator('.content').boundingBox();
      assert(content, 'The welcome content must be visible');
      assert(content.width>2300,'1440p welcome should use the available screen width');
      assert(content.height>1200,'1440p welcome should occupy the viewport height');
    }
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/v2-welcome-${width}.png`, fullPage: true });
  }
  const sceneAnimations = () => page.locator(".welcome-art").evaluate(el =>
    el.getAnimations({subtree: true}).filter(animation => animation.playState === "running").length,
  );
  await page.emulateMedia({reducedMotion: "reduce"});
  assert.equal(await sceneAnimations(), 0, "The complete stage must respect reduced motion");
  await page.emulateMedia({reducedMotion: "no-preference"});
  assert((await sceneAnimations()) > 0, "Stage animation must resume when reduced motion is off");
  await page.locator(".motion-toggle").click();
  assert.equal(await sceneAnimations(), 0, "The site's motion control must stop all stage animation");
  await page.locator(".motion-toggle").click();
  assert((await sceneAnimations()) > 0, "The site's motion control must restore stage animation");
  await page.locator(".welcome-release").click();
  await page.getByRole("heading", { name: "Unified settings and radio recovery" }).waitFor();
  assert(!(await page.locator("body").innerText()).includes("This build uses semantic versioning"));
  await page.goto(base);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Spel i nettlesaren" }).click();
  const dialog = page.getByRole("dialog", { name: "Start kvelden" });
  await dialog.waitFor();
  assert(await dialog.getByLabel("Namn på kvelden").evaluate(el => {
    const frame = el.getBoundingClientRect();
    return document.elementFromPoint(frame.left + frame.width / 2, frame.top + frame.height / 2) === el;
  }), "The room dialog must receive input above decorative scene layers");
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
  assert.equal(await page.locator(".video-settings").count(), 1, "Empty rooms need the same settings panel");
  await page.locator(".video-settings > summary").click();
  assert(await page.getByRole("heading", {name:"Rominnstillingar", exact:true}).isVisible());
  assert(await page.getByRole("heading", {name:"Køinnstillingar", exact:true}).isVisible());
  assert(await page.getByRole("heading", {name:"Videoinnstillinger", exact:true}).isVisible());
  assert(await page.getByRole("button", {name:"Synk nå", exact:true}).isDisabled(), "Empty rooms cannot resync a missing player");
  await page.locator(".video-settings > summary").click();
  await page
    .getByRole("button", { name: /Legg.*Synthetic evening song/ })
    .click();
  await page.getByRole("button", { name: /Legg.*Synthetic evening song/ }).click();
  await page.getByRole("tab", { name: "Kø" }).click();
  await page.getByText("Second queued song", {exact:true}).waitFor();
  const queued = page.locator(".social-track").filter({hasText:"Second queued song"});
  assert(await queued.isVisible(), "Manually queued track must be visible");
  assert.equal(await page.locator("#queue-tab .tab-count").innerText(), "1");

  await page.locator(".video-settings > summary").click();
  assert.equal(await page.locator(".video-settings").count(), 1, "Room, queue and video share one panel");
  assert.equal(await page.locator(".video-settings details").count(), 0, "Settings sections must not require nested disclosure controls");
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({width, height:900});
    const geometry = await page.locator(".party-tools").evaluate(el => {
      const name = el.querySelector<HTMLInputElement>(".display-name input")!.getBoundingClientRect();
      const tv = el.querySelector(".tv-mode-button")!.getBoundingClientRect();
      const panel = el.closest(".video-settings")!.getBoundingClientRect();
      return { overlap: name.left < tv.right && name.right > tv.left && name.top < tv.bottom && name.bottom > tv.top,
        contained: name.left >= panel.left && name.right <= panel.right && tv.left >= panel.left && tv.right <= panel.right,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert(!geometry.overlap, "The nickname field and TV button must not overlap");
    assert(geometry.contained, "Settings controls must fit inside their panel");
    assert(!geometry.overflow, "Open settings must fit the viewport");
    if (process.env.SCREENSHOT_DIR) await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/settings-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  const radio = page.getByRole("button", {name:"Radio på",exact:true});
  assert(await radio.isVisible(), "Radio must be available in room settings");
  await radio.click();
  await page.getByRole("button", {name:"Radio av",exact:true}).waitFor();
  assert(commands.some(c => c.action === "radio" && c.enabled === false));
  assert(await page.locator(".queue-current").isVisible());
  assert.equal(await page.locator(".queue-current img").count(),1);
  assert.equal(await queued.locator("img").count(),1);
  for (const width of [390,1794,2560]) {
    await page.setViewportSize({width,height:1440});
    assert(await queued.isVisible());
    const visible = await queued.evaluate(el => {
      const r=el.getBoundingClientRect(), p=el.closest(".queue-content")!.getBoundingClientRect();
      return r.width>0 && r.height>0 && r.top>=p.top && r.bottom<=p.bottom;
    });
    assert(visible,"Queued track must be inside the visible queue area");
  }
  await page.setViewportSize({width:390,height:844});
  await page
    .getByRole("checkbox", { name: "Godkjenn gjestene sine låtønske" })
    .click();
  await page.waitForFunction(
    () => document.querySelector<HTMLInputElement>(".approval-choice input")?.checked,
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
    await page.getByText("Kvelden vår · 2 låtar", { exact: true }).count(),
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
