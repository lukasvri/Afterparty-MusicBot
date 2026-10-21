import assert from 'node:assert/strict';
import type { Page, Route } from 'playwright';
import type { Room, Video } from '../lib/types.ts';
import { deferred } from '../services/core/tests/deferred.ts';
type QueueState = {revision:string;queue:Video[];requests:Video[];approvalRequired:boolean;voteCounts:Record<string,number>;skipVotes:number};
type QueueAction = {guildId:string;action:string;revision:string;videoId?:string;enabled?:boolean;to?:number};
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright') as typeof import('playwright');
const base=process.env.PREVIEW_URL??'http://127.0.0.1:8787';assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const guildA='111111111111111',guildB='222222222222222';
const track=(id:string):Video=>({id,entryId:id,title:'Concert '+id,artist:'Test artist',image:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",duration:180,live:false,embeddable:true,concert:true});
const copy=<T>(value:T):T=>structuredClone(value);
const repaint=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
async function fixture(canManage=true){
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.addInitScript(()=>{localStorage.setItem('gutta-language','en');localStorage.setItem('afterparty-visitor','a'.repeat(32));});
 const states=new Map<string,QueueState>([guildA,guildB].map((guild,index)=>[guild,{revision:'1',queue:[track(index?'second00001':'queued00001')],requests:[],approvalRequired:false,voteCounts:{},skipVotes:0}]));
 const undo=new Map<string,Video[]>(),actions:QueueAction[]=[];
 const fixture={page,states,actions,canManage,activeGuild:guildA,current:track('current0001') as Video|null,
  get:(async()=>false) as (route:Route,guild:string)=>Promise<boolean>,
  post:(async()=>false) as (route:Route,input:QueueAction)=>Promise<boolean>,
 };
 const room=(guild:string):Room=>({code:guild===guildA?'DISCORD1':'DISCORD2',guildId:guild,name:'Concert',current:fixture.current,queue:states.get(guild)!.queue,history:[track('history0001')],radio:true,playing:false,position:0,version:1,serverTime:Date.now(),isHost:false,viewers:2,mode:'discord',discordOnline:true,expiresAt:Date.now()+60000,playbackKey:'core:'+guild});
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==new URL(base).origin)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();let data:unknown={};
  if(u.pathname==='/api/discord/queue'){
   if(route.request().method()==='POST'){
    const input:QueueAction=route.request().postDataJSON();actions.push(input);
    if(await fixture.post(route,input))return;
    const state=states.get(input.guildId);assert(state);assert.equal(input.revision,state.revision,'queue mutations retain the displayed server revision');
    if(input.action==='clear'){undo.set(input.guildId,state.queue);state.queue=[];}
    if(input.action==='undo')state.queue=undo.get(input.guildId)??[];
    if(input.action==='approval'){assert.equal(typeof input.enabled,'boolean');state.approvalRequired=input.enabled!;}
    if(input.action==='vote')state.voteCounts[input.videoId!]=(state.voteCounts[input.videoId!]??0)+1;
    if(input.action==='remove')state.queue=state.queue.filter(video=>(video.entryId??video.id)!==input.videoId);
    if(input.action==='move'){
     const from=state.queue.findIndex(video=>(video.entryId??video.id)===input.videoId);assert(from>=0);assert(Number.isInteger(input.to)&&input.to!>=0&&input.to!<state.queue.length);
     const [moving]=state.queue.splice(from,1);state.queue.splice(input.to!,0,moving);
    }
    if(input.action==='approve'||input.action==='reject'){
     const requested=state.requests.find(video=>(video.entryId??video.id)===input.videoId);assert(requested);
     if(input.action==='approve')state.queue.push(requested);state.requests=state.requests.filter(video=>video!==requested);
    }
    state.revision=String(Number(state.revision)+1);data={state,canManage:fixture.canManage};
   }else{
    const guild=u.searchParams.get('guildId')!;assert(states.has(guild));if(await fixture.get(route,guild))return;
    data={state:states.get(guild),canManage:fixture.canManage};
   }
  }else if(u.pathname==='/api/rooms/DISCORD1')data=room(guildA);
  else if(u.pathname==='/api/rooms/DISCORD2')data=room(guildB);
  else if(u.pathname==='/api/rooms')data={rooms:[]};
  else if(u.pathname==='/api/discord')data={state:{...room(fixture.activeGuild),ready:true,connected:true,online:true,queueRevision:states.get(fixture.activeGuild)!.revision,volume:100}};
  else if(u.pathname.includes('realtime'))return route.abort();
  else if(u.pathname==='/api/history')data={videos:[]};
  await route.fulfill({json:data});
 });
 return {...fixture,room,open:async()=>{await page.goto(base+'/?room=DISCORD1');await page.getByRole('button',{name:'Vote for Concert queued00001'}).waitFor();},
  async switchGuild(){fixture.activeGuild=guildB;await page.evaluate(()=>{history.pushState(null,'','/?room=DISCORD2');dispatchEvent(new PopStateEvent('popstate'));});},
  source:fixture,
 };
}
async function settings(page:Page){await page.locator('.video-settings > summary').click();await page.locator('.settings-tabs').getByRole('tab',{name:'Queue',exact:true}).click();}
try{
 for(const canManage of [true,false]){
  const f=await fixture(canManage),{page}=f;
  try{
   await f.open();await settings(page);
   if(canManage){
    await page.getByRole('checkbox',{name:'Approve guest track requests'}).click();await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('.approval-choice input')?.checked);
    page.on('dialog',dialog=>dialog.accept());await page.locator('.queue-options button').filter({hasText:/^Clear$/}).click();await page.waitForFunction(()=>document.querySelectorAll('.social-track').length===0);
    await page.locator('.queue-options button').filter({hasText:'Undo queue edit'}).click();await page.locator('.social-track').waitFor();assert.deepEqual(f.actions.map(action=>action.action),['approval','clear','undo']);
   }else{assert.equal(await page.locator('.queue-options input').count(),0);assert.equal(await page.locator('.queue-options button').count(),0);assert.equal(await page.getByRole('button',{name:/Move up/}).count(),0);}
   assert.equal(await page.locator('.social-track img').count(),1);await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  }finally{await page.close();}
 }
 console.log('PASS Discord queue parity, authority, clear/undo, guest controls and mobile width');
 {
  const f=await fixture(),{page}=f,entered=deferred<void>(),release=deferred<void>();
  try{
   f.states.get(guildA)!.requests=[track('request0001'),track('request0002')];
   f.source.post=async()=>{entered.resolve();await release.promise;return false;};
   await f.open();const approve=page.getByRole('button',{name:'Approve Concert request0001',exact:true});await approve.focus();await page.keyboard.press('Enter');await entered.promise;
   assert.equal(await page.locator('.social-queue').getAttribute('aria-busy'),'true');assert.equal(await page.locator('.social-queue button:not(:disabled)').count(),0);
   release.resolve();await approve.waitFor({state:'detached'});await page.getByRole('button',{name:'Reject Concert request0002',exact:true}).waitFor();
   assert.equal(await page.locator('.social-queue').getAttribute('aria-busy'),'false');
   await page.setViewportSize({width:390,height:844});const reject=page.getByRole('button',{name:'Reject Concert request0002',exact:true});const size=await reject.boundingBox();assert(size&&size.width>=44&&size.height>=44);
   await reject.focus();await page.keyboard.press('Enter');await reject.waitFor({state:'detached'});assert.deepEqual(f.actions.map(action=>action.action),['approve','reject']);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  }finally{release.resolve();await page.close();}
 }
 console.log('PASS accessible pending state, named moderation buttons, keyboard actions and mobile targets');
 {
  const f=await fixture(),{page}=f;
  try{
   f.states.get(guildA)!.queue.push(track('queued00002'));await f.open();await page.setViewportSize({width:390,height:844});
   assert(await page.getByRole('button',{name:'Move up Concert queued00001',exact:true}).isDisabled());
   assert(await page.getByRole('button',{name:'Move down Concert queued00002',exact:true}).isDisabled());
   const down=page.getByRole('button',{name:'Move down Concert queued00001',exact:true});const size=await down.boundingBox();assert(size&&size.height>=44&&size.width>=44);
   await down.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.social-track strong')?.textContent==='Concert queued00002');
   assert.deepEqual(f.actions.map(({action,videoId,to,revision})=>({action,videoId,to,revision})),[{action:'move',videoId:'queued00001',to:1,revision:'1'}]);
   assert(await down.isDisabled());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
   for(const row of await page.locator('.social-track').all()){
    const boxes=await Promise.all((await row.getByRole('button').all()).map(button=>button.boundingBox()));
    for(const box of boxes)assert(box&&box.width>=44&&box.height>=44);
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
     const a=boxes[i]!,b=boxes[j]!;assert(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'mobile controls must not overlap');
    }
   }
   if(process.env.QUEUE_SCREENSHOT_PATH)await page.screenshot({path:process.env.QUEUE_SCREENSHOT_PATH,fullPage:true});
  }finally{await page.close();}
 }
 console.log('PASS queue reordering works in both directions with keyboard and mobile controls');
 {
  const f=await fixture(),{page}=f;let failed=false;
  try{
   await f.open();f.source.get=async route=>{if(failed)return false;failed=true;await route.fulfill({status:503,json:{error:'Synthetic temporary queue failure'}});return true;};
   await page.getByRole('alert').filter({hasText:'The concert queue is unavailable.'}).waitFor();assert.equal(await page.locator('.social-track').count(),1);
   await page.getByRole('alert').filter({hasText:'The concert queue is unavailable.'}).waitFor({state:'detached',timeout:12000});
  }finally{await page.close();}
 }
 console.log('PASS polling errors recover without discarding the last queue snapshot');
 {
  const f=await fixture(),{page}=f,captured=deferred<void>(),release=deferred<void>();
  try{
   f.states.get(guildA)!.queue=[];
   f.source.get=async(route,guild)=>{if(guild!==guildA)return false;captured.resolve();await release.promise;await route.fulfill({json:{state:f.states.get(guildA),canManage:true}});return true;};
   await page.goto(base+'/?room=DISCORD1');await captured.promise;
   await page.locator('.queue-panel [role=status]').filter({hasText:'Loading queue'}).waitFor();assert.equal(await page.locator('.queue-panel .empty-queue').count(),0);
   release.resolve();await page.locator('.queue-panel .empty-queue').waitFor();assert.equal(await page.locator('.queue-panel [role=status]').filter({hasText:'Loading queue'}).count(),0);
  }finally{release.resolve();await page.close();}
 }
 console.log('PASS an unloaded Discord queue shows loading before its confirmed empty state');
 for(const staleFailure of [false,true]){
  const f=await fixture(),{page}=f,captured=deferred<Route>(),release=deferred<void>();let held=false;
  try{
   await f.open();const old=copy(f.states.get(guildA)!);
   f.source.get=async route=>{if(held)return false;held=true;captured.resolve(route);await release.promise;await route.fulfill(staleFailure?{status:503,json:{error:'Old polling failure'}}:{json:{state:old,canManage:true}});return true;};
   await captured.promise;
   if(staleFailure){await page.getByRole('button',{name:'Vote for Concert queued00001'}).click();await page.waitForFunction(()=>document.querySelector('.social-track > button')?.textContent?.includes('1'));}
   else{await page.getByRole('button',{name:'Remove Concert queued00001'}).click();await page.locator('.social-track').waitFor({state:'detached'});}
   const response=page.waitForResponse(res=>res.url().includes('/api/discord/queue?'));release.resolve();await response;await repaint(page);
   assert.equal(await page.getByRole('alert').filter({hasText:'The concert queue is unavailable.'}).count(),0);
   if(staleFailure)assert.match(await page.locator('.social-track > button').first().innerText(),/1/);else assert.equal(await page.locator('.social-track').count(),0);
  }finally{release.resolve();await page.close();}
 }
 console.log('PASS delayed GET successes and failures cannot replace a newer mutation response');
 for(const delayedMethod of ['GET','POST']){
  const f=await fixture(),{page}=f,captured=deferred<void>(),release=deferred<void>();
  try{
   if(delayedMethod==='GET')f.source.get=async(route,guild)=>{if(guild!==guildA)return false;captured.resolve();await release.promise;await route.fulfill({json:{state:copy(f.states.get(guildA)!),canManage:true}}).catch(()=>{});return true;};
   await page.goto(base+'/?room=DISCORD1');
   if(delayedMethod==='POST'){
    await page.getByRole('button',{name:'Vote for Concert queued00001'}).waitFor();
    f.source.post=async(route,input)=>{if(input.guildId!==guildA)return false;captured.resolve();await release.promise;await route.fulfill({status:409,json:{error:'Old server action failed'}}).catch(()=>{});return true;};
    await page.getByRole('button',{name:'Vote for Concert queued00001'}).click();
   }
   await captured.promise;await f.switchGuild();const second=page.getByRole('button',{name:'Vote for Concert second00001'});await second.waitFor();
   await page.waitForFunction(()=>document.querySelector('.social-queue')?.getAttribute('aria-busy')==='false');assert(await second.isEnabled());
   await second.click();await page.waitForFunction(()=>document.querySelector('.social-track > button')?.textContent?.includes('1'));
   release.resolve();await repaint(page);assert.equal(await page.getByRole('button',{name:'Vote for Concert queued00001'}).count(),0);assert(await second.isEnabled());
   assert.equal(await page.getByRole('alert').filter({hasText:'Old server action failed'}).count(),0);assert.equal(f.actions.at(-1)?.guildId,guildB);assert.equal(f.actions.at(-1)?.revision,'1');
  }finally{release.resolve();await page.close();}
 }
 console.log('PASS switching servers cancels delayed reads/actions and releases controls for the new server');
 {
  const f=await fixture(),{page}=f;f.source.current=null;
  try{await f.open();assert.equal(await page.locator('.social-queue .radio-retry').count(),0);}finally{await page.close();}
 }
 console.log('PASS Discord queue does not offer room-only radio retries');
}finally{await browser.close();}
