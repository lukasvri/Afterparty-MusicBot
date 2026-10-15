// Run against a local preview only. Playwright can be supplied via PLAYWRIGHT_MODULE.
import {test} from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.PREVIEW_URL??'http://127.0.0.1:5173';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Synthetic browser checks require a local preview');

async function fixture({playing=false,blocked=false,host=true}={}){
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),commands=[];
 const video=id=>({id,title:'Synthetic '+id,artist:'Synthetic artist',image:'',duration:200,live:false,embeddable:true});
 let current=video('seed1234567'),version=1,radio=true;
 const room=()=>({code:'TESTROOM',name:'Synthetic own room',current,queue:[],playing,radio,position:20,version,serverTime:Date.now(),viewers:1,isHost:host,expiresAt:Date.now()+60000});
 await page.addInitScript(({blocked})=>{
  localStorage.setItem('gutta-language','en');localStorage.setItem('muse-audio',JSON.stringify({level:77,muted:false,lastAudible:77}));
  window.__blockAudio=blocked;window.__videoCalls=[];
  window.YT={Player:class{
   constructor(_target,options){this.options=options;this.state=5;this.position=0;this.volume=77;this.muted=false;this.at=performance.now();window.__fakePlayer=this;queueMicrotask(()=>options.events.onReady());}
   emit(state){if(this.state===1)this.position=this.getCurrentTime();this.state=state;this.at=performance.now();this.options.events.onStateChange({data:state});}
   loadVideoById(value){window.__videoCalls.push(value.videoId);this.position=value.startSeconds;this.playVideo();}
   cueVideoById(value){window.__videoCalls.push(value.videoId);this.position=value.startSeconds;this.emit(5);}
   playVideo(){if(window.__blockAudio&&!this.muted){this.options.events.onAutoplayBlocked();return;}if(this.state!==1)this.emit(1);}
   pauseVideo(){if(this.state!==2)this.emit(2);}
   getCurrentTime(){return this.position+(this.state===1?(performance.now()-this.at)/1000:0);}
   getPlayerState(){return this.state;}
   setVolume(value){this.volume=value;}getVolume(){return this.volume;}
   mute(){this.muted=true;}unMute(){this.muted=false;}isMuted(){return this.muted;}
   seekTo(value){this.position=value;this.at=performance.now();}setPlaybackRate(){}destroy(){}
  }};
 },{blocked});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==new URL(base).origin)return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  let result;
  if(url.pathname==='/api/rooms/TESTROOM'){
   if(route.request().method()==='POST'){
    const command=route.request().postDataJSON();commands.push(command);
    if(command.action==='played')result={ok:true};
    else{
     assert.equal(command.version,version);
     if(command.action==='play')playing=true;
     if(command.action==='pause')playing=false;
     if(command.action==='radio')radio=command.enabled;
     if(command.action==='next'){current=radio?video('next1234567'):null;playing=Boolean(current);}
     version++;result={room:room()};
    }
   }else result=room();
  }else if(url.pathname==='/api/realtime')result={url:null};
  else if(url.pathname==='/api/discord')result={state:null};
  else if(url.pathname==='/api/history')result={videos:[]};
  else return route.fulfill({status:404,contentType:'application/json',body:'{}'});
  return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto(base+'/?room=TESTROOM',{waitUntil:'networkidle'});
 await page.locator('.stage-intro button').waitFor();
 return {browser,page,commands};
}
test('one centre play click starts a paused own room and its local video',async()=>{
 const {browser,page,commands}=await fixture();try{
  await page.locator('.stage-intro button').click();
  await page.waitForFunction(()=>window.__fakePlayer?.state===1,{},{timeout:4000});
  assert.equal(commands.filter(command=>command.action==='play').length,1);
  assert.deepEqual(await page.evaluate(()=>window.__videoCalls),['seed1234567']);
 }finally{await browser.close();}
});
test('the transport play click loads a locally unopened video without pausing the room',async()=>{
 const {browser,page,commands}=await fixture({playing:true});try{
  await page.locator('.now-playing .shared-play').click();
  await page.waitForFunction(()=>window.__fakePlayer?.state===1,{},{timeout:4000});
  assert.equal(commands.filter(command=>['play','pause'].includes(command.action)).length,0);
 }finally{await browser.close();}
});
test('blocked audible startup falls back to muted video without changing saved audio',async()=>{
 const {browser,page}=await fixture({playing:true,blocked:true});try{
  await page.locator('.stage-intro button').click();
  await page.waitForFunction(()=>window.__fakePlayer?.state===1,{},{timeout:4000});
  assert.equal(await page.evaluate(()=>window.__fakePlayer.muted),true);
  await page.clock.install();await page.clock.fastForward(1500);
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('muse-audio')))).muted,false);
  await page.evaluate(()=>{window.__blockAudio=false;});await page.getByRole('button',{name:'Enable sound',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__fakePlayer.muted),false);
  assert.equal(await page.evaluate(()=>window.__fakePlayer.volume),77);
 }finally{await browser.close();}
});
test('a guest can open the local video without resuming a paused room',async()=>{
 const {browser,page,commands}=await fixture({host:false});try{
  await page.locator('.stage-intro button').click();await page.waitForFunction(()=>window.__videoCalls.includes('seed1234567'));
  assert.equal(await page.evaluate(()=>window.__fakePlayer.state),5);
  assert.equal(commands.length,0);assert.equal(await page.locator('.shared-play').count(),0);
 }finally{await browser.close();}
});
test('own-room radio advances from the ended event without another play click',async()=>{
 const {browser,page,commands}=await fixture({playing:true});try{
  await page.locator('.stage-intro button').click();await page.waitForFunction(()=>window.__fakePlayer?.state===1);
  await page.evaluate(()=>window.__fakePlayer.emit(0));
  await page.waitForFunction(()=>window.__videoCalls.includes('next1234567')&&window.__fakePlayer.state===1);
  assert.equal(commands.filter(command=>command.action==='next').length,1);
  await page.getByRole('button',{name:'Radio on',exact:true}).click();
  await page.getByRole('button',{name:'Radio off',exact:true}).waitFor();
  assert.equal(commands.find(command=>command.action==='radio')?.enabled,false);
 }finally{await browser.close();}
});
