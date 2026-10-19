// TV layout and source-player continuity, using synthetic local data only.
import assert from "node:assert/strict";
import { mkdir,writeFile } from "node:fs/promises";
import type { Player } from "../lib/youtube-player.ts";
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright") as typeof import("playwright");
const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:8787";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const phase=process.env.UI_PHASE??"after";
assert(["before","after"].includes(phase));
const output=`outputs/unified-ui/${phase}`;
await mkdir(output, {recursive:true});
const observations:{viewport:unknown;checks:unknown[];failures:string[]}[]=[];
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:["--no-sandbox"]});
try {
  for (const viewport of [{width:2560,height:1440},{width:2560,height:1080},{width:1920,height:1080},{width:1280,height:720},{width:390,height:844}]) {
    const observation={viewport,checks:[] as unknown[],failures:[] as string[]};observations.push(observation);
    const check=(valid:boolean,message:string)=>{if(!valid)observation.failures.push(message);};
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
            state.tvPlayerCount++;
            // Match YouTube's replacement seam, not a styled div that hides iframe sizing.
            const frame=document.createElement("iframe");frame.dataset.tvPlayer="stable";
            frame.width=String(options.width);frame.height=String(options.height);frame.title="Synthetic local video surface";
            frame.srcdoc=`<style>html,body{margin:0;width:100%;height:100%;background:#050505}svg{display:block;width:100%;height:100%}</style><svg viewBox="0 0 1600 900" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="#202026"/><stop offset="1" stop-color="#0b0b0e"/></linearGradient></defs><path fill="url(#g)" d="M0 0H1600V900H0Z"/><path fill="none" stroke="#55555d" stroke-width="3" d="M2 2H1598V898H2ZM0 450H1600M800 0V900"/><circle cx="800" cy="450" r="160" fill="none" stroke="#ff263e" stroke-width="3"/><text x="800" y="455" text-anchor="middle" fill="white" font-family="Arial" font-size="32">Synthetic 16:9 video surface</text><rect x="0" y="844" width="1600" height="56" fill="#18181c"/><text x="35" y="880" fill="white" font-family="Arial" font-size="24">Local iframe control area</text></svg>`;
            target.replaceWith(frame);
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
      let writes=0,sceneOnly=false;
      await context.route("**/*", route => {
        const url=new URL(route.request().url());
        if(url.origin!==new URL(base).origin) return route.abort();
        if(!url.pathname.startsWith("/api/")) return route.continue();
        if(route.request().method()!=="GET"){writes++;return route.abort();}
        if(url.pathname.includes("realtime")) return route.abort();
        const room={code:"TESTROOM",name:"Afterparty TV room",current:sceneOnly?null:{id:"preview0001",title:"TV continuity song",artist:"Preview artist",image:"",duration:180,live:false,embeddable:true},queue:[],playing:false,position:30,version:1,serverTime:Date.now(),viewers:2,isHost:false,isOwner:false,expiresAt:Date.now()+86400000,requests:[],history:[],voteCounts:{}};
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
      const tvGeometry=await page.locator(".stage").evaluate(stage=>{
        const box=(el:Element)=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
        const frame=stage.querySelector("iframe")!,card=document.querySelector(".tv-invite")!,qr=card.querySelector("img")!;
        return {stage:box(stage),panel:box(stage.closest('.stage-panel')!),frame:box(frame),parent:box(frame.parentElement!),card:box(card),qr:box(qr)};
      });observation.checks.push(tvGeometry);
      check(Math.abs(tvGeometry.frame.width-tvGeometry.parent.width)<2&&Math.abs(tvGeometry.frame.height-tvGeometry.parent.height)<2,"The real iframe must fill its player parent");
      check(Math.abs(tvGeometry.frame.width-tvGeometry.stage.width)<2&&Math.abs(tvGeometry.frame.height-tvGeometry.stage.height)<2,"The iframe must fill the actual stage slot");
      check(Math.abs(tvGeometry.frame.width-(tvGeometry.panel.width-2))<2,"The video and its enclosing panel must have equal content widths without an unused side strip");
      check(Math.abs(tvGeometry.stage.width/tvGeometry.stage.height-16/9)<.01,"TV keeps a 16:9 slot when viewport height constrains video width");
      if(viewport.width>900)check(tvGeometry.card.height<=Math.min(800,viewport.height*.9),"QR invitation remains a proportionate card rather than a stretched empty rail");
      if(viewport.width>=2560)check(tvGeometry.qr.width>=220,"Large-display QR remains legible");
      await page.screenshot({path:`${output}/tv-${viewport.width}x${viewport.height}.png`,fullPage:true,animations:"disabled"});
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
      const settingsGeometry=await page.locator(".party-tools").evaluate(el=>{
        const input=el.querySelector(".display-name input")!,button=el.querySelector(".tv-mode-button")!;
        const a=input.getBoundingClientRect(),b=button.getBoundingClientRect();
        return {inputWidth:a.width,inputTop:a.top,inputBottom:a.bottom,buttonTop:b.top,buttonBottom:b.bottom,buttonHeight:b.height,fontSize:parseFloat(getComputedStyle(button).fontSize),overflow:document.documentElement.scrollWidth>innerWidth};
      });observation.checks.push(settingsGeometry);
      check(settingsGeometry.inputWidth<=420,"Nickname input uses a bounded reading width");
      check(settingsGeometry.buttonHeight>=44&&settingsGeometry.fontSize>=13,"Settings actions share readable 44px controls");
      if(viewport.width>600)check(Math.abs(settingsGeometry.inputBottom-settingsGeometry.buttonBottom)<3,"TV action aligns with the nickname input rather than its help text");
      check(!settingsGeometry.overflow,"Room settings fit the viewport");
      await page.screenshot({path:`${output}/settings-${viewport.width}x${viewport.height}.png`,fullPage:true,animations:"disabled"});
      await page.getByRole("button",{name:"Fullscreen",exact:true}).click();
      await page.locator('.stage-panel[data-immersive=true]').waitFor();
      await page.locator('.cinema-toolbar .video-settings[open]').waitFor();
      const fullscreenGeometry=await page.locator('.cinema-toolbar').evaluate(el=>{
        const r=el.getBoundingClientRect(),panel=el.querySelector('.video-settings-body')!.getBoundingClientRect();
        return {bottom:r.bottom,viewport:innerHeight,panelLeft:panel.left,panelRight:panel.right,panelTop:panel.top};
      });observation.checks.push(fullscreenGeometry);
      check(fullscreenGeometry.bottom<=fullscreenGeometry.viewport-64,"Fullscreen toolbar leaves the native iframe control area clear");
      check(fullscreenGeometry.panelLeft>=0&&fullscreenGeometry.panelRight<=viewport.width&&fullscreenGeometry.panelTop>=0,"Fullscreen settings fit within the display");
      await page.screenshot({path:`${output}/fullscreen-${viewport.width}x${viewport.height}.png`,fullPage:false,animations:"disabled"});
      await page.getByRole("button",{name:"Exit fullscreen",exact:true}).click();
      await page.locator('.stage-panel:not([data-immersive=true])').waitFor();
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
      for (const composition of ["welcome","room"] as const) {
        if(composition==="room") {
          sceneOnly=true;
          await page.goto(base+"/?room=TESTROOM",{waitUntil:"networkidle"});
        }
        const scene=page.locator(`.concert-scenery[data-composition=${composition}]`);
        await scene.waitFor();
        const geometry=await scene.evaluate(el=>{
          const box=(selector:string)=>{const r=el.querySelector(selector)!.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
          const screen=box('[data-led-screen]'),halo=box('[data-led-halo]'),mark=box('.stage-backdrop image'),head=box('.performer-head');
          const clipReference=el.querySelector('.stage-backdrop image')!.parentElement?.getAttribute('clip-path');
          const clipId=clipReference?.match(/^url\(#(.+)\)$/)?.[1];
          const clip=Array.from(el.querySelectorAll('clipPath')).find(item=>item.id===clipId)?.querySelector('rect');
          const clipBounds=clip?.getBBox();
          const screenBounds=(el.querySelector('[data-led-screen]') as SVGGraphicsElement).getBBox();
          const emblemClipped=!!clipBounds && clipBounds.x>=screenBounds.x && clipBounds.y>=screenBounds.y
            && clipBounds.x+clipBounds.width<=screenBounds.x+screenBounds.width
            && clipBounds.y+clipBounds.height<=screenBounds.y+screenBounds.height
            && clipBounds.width>screenBounds.width*.95 && clipBounds.height>screenBounds.height*.95;
          const intersects=(a:DOMRect,b:DOMRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
          const copy=Array.from(el.closest('.stage')?.querySelectorAll('.stage-intro h2,.stage-intro p,.stage-intro button')??[]);
          const subjects=[el.querySelector('.performer-head')!].map(subject=>subject.getBoundingClientRect());
          const copyClear=copy.every(item=>subjects.every(subject=>!intersects(item.getBoundingClientRect(),subject)));
          const stage=el.closest('.stage')?.getBoundingClientRect();
          const copyContained=copy.every(item=>{
            const r=item.getBoundingClientRect();
            return !stage||(r.left>=stage.left&&r.right<=stage.right&&r.top>=stage.top&&r.bottom<=stage.bottom);
          });
          const copyTextVisible=copy.filter(item=>item.tagName==='H2').every(item=>{
            const natural=item.cloneNode(true) as HTMLElement;
            Object.assign(natural.style,{display:'block',position:'absolute',visibility:'hidden',width:`${item.getBoundingClientRect().width}px`,height:'auto',webkitLineClamp:'unset'});
            item.parentElement!.appendChild(natural);
            const height=natural.getBoundingClientRect().height;
            natural.remove();
            return height<=item.getBoundingClientRect().height+.5;
          });
          const cabinets=Array.from(el.querySelectorAll('[data-pa-array]')).map(array=>Array.from(array.querySelectorAll('[data-pa-cabinet]')).map(cabinet=>{
            const r=cabinet.getBoundingClientRect();return {top:r.top,bottom:r.bottom};
          }));
          return {composition:el.getAttribute('data-composition'),screen,halo,mark,head,
            copyClear,copyContained,copyTextVisible,
            emblemBehindHead: mark.top < head.top && mark.bottom > head.bottom,
            markScale: (mark.right - mark.left) / (screen.right - screen.left),
            emblemClipped,
            performerInFront: !!(el.querySelector(".stage-backdrop")!.compareDocumentPosition(el.querySelector(".stage-dj")!) & Node.DOCUMENT_POSITION_FOLLOWING),
            consoleInFront: !!(el.querySelector(".stage-backdrop")!.compareDocumentPosition(el.querySelector(".dj-booth")!) & Node.DOCUMENT_POSITION_FOLLOWING),
            pageFits: document.documentElement.scrollWidth <= innerWidth,
            cabinetCounts:cabinets.map(array=>array.length),
            cabinetSeams:cabinets.every(array=>array.slice(1).every((cabinet,index)=>cabinet.top>=array[index].bottom-.5))};
        });
        observation.checks.push(geometry);
        check(geometry.copyClear,`${composition}: empty-room copy must not overlap the performer`);
        check(geometry.copyTextVisible,`${composition}: the complete empty-room heading must stay readable`);
        check(geometry.copyContained,`${composition}: empty-room text and its action must fit inside the stage`);
        check(geometry.emblemClipped,`${composition}: the oversized emblem is cropped by the LED-screen clip`);
        check(geometry.markScale > 1.4,`${composition}: the canonical padded mark fills the LED screen`);
        check(geometry.consoleInFront && geometry.pageFits,`${composition}: controls remain in front and the page has no horizontal overflow`);
        check(geometry.emblemBehindHead,`${composition}: the lowered emblem sits behind the DJ head`);
        check(geometry.performerInFront,`${composition}: the DJ paints in front of the backdrop emblem`);
        check(geometry.cabinetCounts.every(count=>count===7)&&geometry.cabinetSeams,`${composition}: both PA stacks retain seven aligned cabinets without overlapping seams`);
        const surface=composition==="room"?page.locator('.stage'):scene;
        await surface.screenshot({path:`${output}/scene-${composition}-${viewport.width}x${viewport.height}.png`,animations:"disabled"});
      }
      console.log(`${phase}: ${viewport.width}x${viewport.height}: ${observation.failures.length ? observation.failures.join('; ') : 'PASS slot geometry, settings, QR, controls, stable iframe and stage geometry'}`);
    } finally {await context.close();}
  }
  await writeFile(`${output}/checks.json`,JSON.stringify(observations,null,2));
  if(phase==="after")assert.deepEqual(observations.flatMap(o=>o.failures),[]);
} finally {await browser.close();}
