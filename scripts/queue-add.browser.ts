// Real search/add/render call sites, with synthetic local API data and no media.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Room, Video } from "../lib/types.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = new URL(process.env.PREVIEW_URL ?? "http://127.0.0.1:8787").origin;
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const guildId = "111111111111111111";
const track = (id: string, title: string): Video => ({
  id, entryId: id, title, artist: "Synthetic artist", duration: 180,
  image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
  live: false, embeddable: true, concert: true,
});

for (const mode of ["browser", "discord-immediate", "discord-polled", "discord-refresh-failure", "discord-switch", "discord-action-race", "discord-management-first", "discord-management-first-failure"] as const) {
  test(`${mode}: confirmed additions refresh the visible queue or report a read failure without retrying the command`, async () => {
    const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH, args:["--no-sandbox"]});
    let releaseLateRead = () => {};
    let releaseManagement = () => {};
    try {
      const page = await browser.newPage({viewport:{width:1440,height:1000}});
      await page.clock.install();
      await page.addInitScript(() => {
        localStorage.setItem("gutta-language", "en");
        localStorage.setItem("afterparty-visitor", "a".repeat(32));
      });
      const added = track("queued00001", "Newly requested song");
      const discord = mode !== "browser";
      let queue: Video[] = [], writes = 0, queueReads = 0, commandReads = 0, approvalRequired = false;
      let startedLateRead = () => {};
      const lateReadStarted = new Promise<void>(resolve => { startedLateRead = resolve; });
      const lateReadGate = new Promise<void>(resolve => { releaseLateRead = resolve; });
      let startedManagement = () => {};
      const managementStarted = new Promise<void>(resolve => { startedManagement = resolve; });
      const managementGate = new Promise<void>(resolve => { releaseManagement = resolve; });
      const queueState = () => ({revision:String(1+writes),queue,requests:[],approvalRequired,voteCounts:{},skipVotes:0});
      const room = (): Room => ({
        code:"TESTROOM", name:"Synthetic queue", current:track("current0001", "Current song"),
        queue, playing:false, position:0, version:1+writes, serverTime:Date.now(),
        isHost:!discord, viewers:1, expiresAt:Date.now()+60000,
        ...(discord ? {mode:"discord",guildId,discordOnline:true,playbackKey:"core:current"} : {}),
      });
      const otherRoom = (): Room => ({...room(),code:"OTHERROOM",name:"Another guild",guildId:"222222222222222222",current:track("other000001","Other guild current"),queue:[],isHost:false});
      const state = () => ({...room(),guildId,ready:true,connected:true,online:true,volume:60,queueRevision:String(1+writes),lastSeen:Date.now()});
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if(url.origin !== base) return route.abort();
        if(!url.pathname.startsWith("/api/")) return route.continue();
        const input = route.request().method() === "POST" ? route.request().postDataJSON() : null;
        let data: unknown = {};
        if(url.pathname === "/api/rooms/OTHERROOM") data=otherRoom();
        else if(url.pathname === "/api/rooms/TESTROOM") {
          if(input) { assert.equal(input.action,"add"); assert.equal(input.videoId,added.id); queue=[added]; writes++; data={room:room()}; }
          else data=room();
        } else if(url.pathname === "/api/discord/queue") {
          if(input) {
            assert.equal(input.action,"approval");
            assert.equal(input.guildId,guildId);
            if(mode === "discord-management-first" || mode === "discord-management-first-failure") {
              startedManagement(); await managementGate;
              if(mode === "discord-management-first-failure")
                return route.fulfill({status:409,json:{error:"Pending moderation revision failed"}});
              approvalRequired=true;
              return route.fulfill({json:{state:queueState(),canManage:true}});
            }
            assert.equal(mode,"discord-action-race");
            return route.fulfill({status:409,json:{error:"Newer moderation revision failed"}});
          }
          if(url.searchParams.get("guildId") === "222222222222222222")
            return route.fulfill({json:{state:{revision:"other",queue:[],requests:[],approvalRequired:false,voteCounts:{},skipVotes:0},canManage:false}});
          assert.equal(url.searchParams.get("guildId"),guildId);
          assert.equal(input,null,"Adding must retain the Discord command boundary");
          queueReads++;
          if(mode === "discord-refresh-failure" && queueReads === 2)
            return route.fulfill({status:503,json:{error:"Synthetic queue read failure"}});
          if((mode === "discord-switch" || mode === "discord-action-race") && queueReads === 2) { startedLateRead(); await lateReadGate; }
          data={state:queueState(),canManage:true};
        } else if(url.pathname === "/api/discord") {
          if(input) {
            assert.equal(input.action,"enqueue"); assert.equal(input.videoId,added.id); assert.equal(input.guildId,guildId);
            queue=[added]; writes++;
            data={id:"synthetic-command",status:mode === "discord-polled" ? "processing" : "done"};
          } else if(url.searchParams.has("command")) { commandReads++; data={state:state(),command:{status:"done",result:""}}; }
          else data={state:discord ? (url.searchParams.get("guildId") === "222222222222222222" ? {...state(),...otherRoom()} : state()) : null};
        } else if(url.pathname === "/api/search") data={videos:[added]};
        else if(url.pathname === "/api/history") data={videos:[]};
        else if(url.pathname === "/api/rooms") data={rooms:[]};
        else if(url.pathname.includes("realtime")) return route.abort();
        return route.fulfill({json:data});
      });
      await page.goto(base+"/?room=TESTROOM");
      await page.locator("#music-tab").waitFor();
      if(discord) await page.waitForFunction(() => !document.querySelector(".queue-panel [role=alert]"));
      await page.locator("#music-tab").click();
      const search=page.locator(".search-form input");
      await search.fill("Synthetic song");
      await page.locator(".search-form button").click();
      const add=page.locator(".add-track");
      await add.waitFor();
      // Freeze periodic timers only after initial room, queue and search have loaded.
      // A successful command must refresh its rendered queue without a later poll.
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now())+100));
      if(discord) assert.equal(queueReads,1);
      if(mode === "discord-management-first" || mode === "discord-management-first-failure") {
        await page.locator(".video-settings > summary").click();
        await page.locator(".settings-tabs").getByRole("tab",{name:"Queue",exact:true}).click();
        await page.getByRole("checkbox",{name:"Approve guest track requests"}).click();
        await managementStarted;
        await page.locator(".video-settings > summary").click();
        const confirmationRefresh=page.waitForResponse(response => new URL(response.url()).pathname === "/api/rooms/TESTROOM");
        await add.click();
        await (await confirmationRefresh).finished();
        await page.clock.runFor(100);
        releaseManagement();
        await page.locator(".video-settings > summary").click();
        if(mode === "discord-management-first")
          await page.waitForFunction(() => document.querySelector<HTMLInputElement>(".approval-choice input")?.checked,{},{timeout:1500});
        else {
          await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>(".add-track")?.disabled && !document.querySelector<HTMLInputElement>(".approval-choice input")?.disabled);
          await page.locator(".video-settings > summary").click();
          await page.locator("#queue-tab").click();
          await page.locator(".queue-panel [role=alert]").waitFor({timeout:1500});
          assert.equal(await page.locator(".queue-panel [role=alert]").innerText(),"Pending moderation revision failed");
        }
        assert.equal(writes,1);
        assert.equal(queueReads,mode === "discord-management-first-failure" ? 3 : 2);
        return;
      }
      await add.click();
      if(mode === "discord-action-race") {
        await lateReadStarted;
        await page.locator(".video-settings > summary").click();
        await page.locator(".settings-tabs").getByRole("tab",{name:"Queue",exact:true}).click();
        await page.getByRole("checkbox",{name:"Approve guest track requests"}).click();
        await page.locator(".video-settings > summary").click();
        await page.locator("#queue-tab").click();
        const alert=page.locator(".queue-panel [role=alert]");
        await alert.waitFor();
        assert.equal(await alert.innerText(),"Newer moderation revision failed");
        const lateResponse=page.waitForResponse(response => new URL(response.url()).pathname === "/api/discord/queue");
        releaseLateRead();
        await (await lateResponse).finished();
        await page.clock.runFor(100);
        assert.equal(await alert.innerText(),"Newer moderation revision failed","An older confirmed-add reload must not clear a newer action error");
        assert.equal(queueReads,3);
        assert.equal(writes,1);
        return;
      }
      if(mode === "discord-switch") {
        await lateReadStarted;
        await page.evaluate(() => {
          history.pushState(null,"","/?room=OTHERROOM");
          dispatchEvent(new PopStateEvent("popstate"));
        });
        await page.locator("#queue-tab").click();
        await page.locator(".queue-current strong").filter({hasText:"Other guild current"}).waitFor();
        const lateResponse=page.waitForResponse(response => new URL(response.url()).pathname === "/api/discord/queue" && new URL(response.url()).searchParams.get("guildId") === guildId);
        releaseLateRead();
        await (await lateResponse).finished();
        await page.clock.runFor(100);
        assert.equal(await page.locator(".social-track").count(),0,"An old guild's confirmed-add refresh must not populate the new guild queue");
        assert.equal(await page.locator("#queue-tab .tab-count").innerText(),"0");
        assert.equal(await page.locator(".queue-panel [role=alert]").count(),0);
        assert.equal(writes,1);
        return;
      }
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>(".add-track")?.disabled);
      await page.locator("#queue-tab").click();
      if(mode === "discord-refresh-failure") {
        await page.locator(".queue-panel [role=alert]").waitFor({timeout:1500});
        assert.match(await page.locator(".toast").innerText(),/added.*queue/i);
        assert.equal(await page.locator(".notice.error").count(),0,"A failed read must not report the confirmed command as failed");
      } else {
        await page.locator(".social-track").filter({hasText:added.title}).waitFor({timeout:1500});
        assert.equal(await page.locator("#queue-tab .tab-count").innerText(),"1");
        assert.equal(await page.locator(".empty-queue").count(),0);
      }
      assert.equal(writes,1,"One click must issue exactly one command");
      if(discord) assert.equal(queueReads,2,"Command confirmation refreshes the authoritative social queue once");
      assert.equal(commandReads,mode === "discord-polled" ? 1 : 0);
    } finally { releaseLateRead(); releaseManagement(); await browser.close(); }
  });
}
