// TV layout and source-player continuity, using synthetic local data only.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Player } from "../lib/youtube-player.ts";
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:8787";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("outputs/queue-language/tv", {recursive:true});
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:["--no-sandbox"]});
try {
  for (const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:390,height:844}]) {
    const context=await browser.newContext({viewport,reducedMotion:"reduce"});
    try {
      await context.addInitScript(() => {
        localStorage.setItem("gutta-language","en");
        localStorage.setItem("afterparty-motion","off");
        const state=Object.assign(window,{tvPlayerCount:0,tvDestroyCount:0});
        class TVPlayer implements Player {
          position=30;volume=60;muted=false;state=5;
          events:{onReady:()=>void;onStateChange:(e:{data:number})=>void};
          constructor(target:HTMLElement,options:Record<string,unknown>) {
            state.tvPlayerCount++;target.dataset.tvPlayer="stable";
            target.textContent="Synthetic video fixture";
            Object.assign(target.style,{display:"grid",placeItems:"center",background:"linear-gradient(135deg,#19191f,#08080b)",color:"#93939e",fontSize:"clamp(16px,2vw,32px)"});
            this.events=options.events as typeof this.events;queueMicrotask(()=>this.events.onReady());
          }
          loadVideoById(value:{startSeconds:number}){this.position=value.startSeconds;this.state=1;}
          cueVideoById(value:{startSeconds:number}){this.position=value.startSeconds;this.state=5;}
          playVideo(){this.state=1;} pauseVideo(){this.state=2;}
          seekTo(value:number){this.position=value;} getCurrentTime(){return this.position;}
          getPlayerState(){return this.state;} setVolume(value:number){this.volume=value;}
          getVolume(){return this.volume;} mute(){this.muted=true;} unMute(){this.muted=false;}
          isMuted(){return this.muted;} setPlaybackRate(){} destroy(){state.tvDestroyCount++;}
        }
        window.YT={Player:TVPlayer};
      });
      let writes=0;
      await context.route("**/*", route => {
        const url=new URL(route.request().url());
        if(url.origin!==new URL(base).origin) return route.abort();
        if(!url.pathname.startsWith("/api/")) return route.continue();
        if(route.request().method()!=="GET"){writes++;return route.abort();}
        if(url.pathname.includes("realtime")) return route.abort();
        const room={code:"TESTROOM",name:"Afterparty TV room",current:{id:"preview0001",title:"TV continuity song",artist:"Preview artist",image:"",duration:180,live:false,embeddable:true},queue:[],playing:false,position:30,version:1,serverTime:Date.now(),viewers:2,isHost:false,isOwner:false,expiresAt:Date.now()+86400000,requests:[],history:[],voteCounts:{}};
        const data=url.pathname==="/api/rooms/TESTROOM"?room:url.pathname==="/api/discord"?{state:null}:url.pathname==="/api/history"?{videos:[]}:url.pathname==="/api/rooms"?{rooms:[]}:{};
        return route.fulfill({json:data});
      });
      const page=await context.newPage();
      const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
      await page.goto(base+"/?room=TESTROOM&tv=1",{waitUntil:"networkidle"});
      await page.getByRole("button",{name:"Exit TV mode",exact:true}).waitFor();
      await page.getByAltText("QR code to join the room").waitFor();
      await page.locator(".stage-intro .button.primary").click();
      await page.locator("[data-tv-player]").waitFor({state:"attached"});
      const player=await page.locator("[data-tv-player]").elementHandle();assert(player);
      assert.equal(await page.locator(".library-panel").isVisible(),false);
      assert.equal(await page.locator(".video-settings").isVisible(),false);
      assert.equal(await page.locator("[role=alert]").count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),viewport.width);
      await page.screenshot({path:`outputs/queue-language/tv/tv-${viewport.width}.png`,fullPage:true,animations:"disabled"});
      if(viewport.width>900) {
        const layout=await page.evaluate(()=>({height:document.documentElement.scrollHeight,viewport:innerHeight,
          boxes:[".content",".studio-grid",".stage-panel",".stage",".tv-invite"].map(selector=>{
            const el=document.querySelector(selector)!; const r=el.getBoundingClientRect();
            return {selector,y:r.y,height:r.height,display:getComputedStyle(el).display};
          })}));
        assert(layout.height<=layout.viewport+1,`TV must fit without scrolling: ${JSON.stringify(layout)}`);
      }
      const exit=await page.getByRole("button",{name:"Exit TV mode",exact:true}).boundingBox();assert(exit&&exit.height>=44);
      await page.getByRole("button",{name:"Exit TV mode",exact:true}).click();
      assert.equal(new URL(page.url()).searchParams.has("tv"),false);
      assert(await page.locator(".library-panel").isVisible());
      assert(await player.evaluate(e=>e.isConnected),"Exiting TV retains the mounted source player");
      await page.locator(".video-settings > summary").click();
      await page.getByRole("tab",{name:"Room",exact:true}).click();
      await page.getByRole("button",{name:"TV mode",exact:true}).click();
      assert.equal(new URL(page.url()).searchParams.get("tv"),"1");
      assert(await player.evaluate(e=>e.isConnected),"Re-entering TV retains the mounted source player");
      assert.deepEqual(await page.evaluate(()=>{
        const state=window as unknown as {tvPlayerCount:number;tvDestroyCount:number};return [state.tvPlayerCount,state.tvDestroyCount];
      }),[1,0]);
      assert.deepEqual(errors,[]);assert.equal(writes,0);
      await page.goto(base+"/?tv=1",{waitUntil:"networkidle"});
      assert(await page.getByRole("button",{name:"Play in the browser",exact:true}).isVisible(),
        "A TV link without a room must keep the welcome actions available");
      console.log(`PASS TV ${viewport.width}x${viewport.height}: layout, QR, exit/re-entry, missing-room fallback and source-player continuity`);
    } finally {await context.close();}
  }
} finally {await browser.close();}
