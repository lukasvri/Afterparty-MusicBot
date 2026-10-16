import assert from 'node:assert/strict';
import type { Room, Video } from '../lib/types.ts';
type QueueState = {revision:string;queue:Video[];requests:Video[];approvalRequired:boolean;voteCounts:Record<string,number>;skipVotes:number};
type QueueAction = {guildId:string;action:string;enabled?:boolean};
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright') as typeof import('playwright');
const base=process.env.PREVIEW_URL??'http://127.0.0.1:8787';assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const track=(id:string):Video=>({id,entryId:id,title:'Concert '+id,artist:'Test artist',image:'',duration:180,live:false,embeddable:true,concert:true});
try{for(const canManage of [true,false]){
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.addInitScript(()=>{localStorage.setItem('gutta-language','en');localStorage.setItem('afterparty-visitor','a'.repeat(32));});
 const current=track('current0001'),queued=track('queued00001');let state:QueueState={revision:'1',queue:[queued],requests:[],approvalRequired:false,voteCounts:{},skipVotes:0};let undo:Video[]=[];const actions:QueueAction[]=[];
 const room=():Room=>({code:'DISCORD1',guildId:'111111111111111',name:'Concert',current,queue:state.queue,playing:false,position:0,version:1,serverTime:Date.now(),isHost:false,viewers:2,mode:'discord',discordOnline:true,expiresAt:Date.now()+60000,playbackKey:'core:current'});
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==base)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();let data:unknown={};
 if(u.pathname==='/api/discord/queue'){if(route.request().method()==='POST'){const input:QueueAction=route.request().postDataJSON();actions.push(input);assert.equal(input.guildId,'111111111111111');if(input.action==='clear'){undo=state.queue;state.queue=[];}if(input.action==='undo')state.queue=undo;if(input.action==='approval'){assert.equal(typeof input.enabled,'boolean');state.approvalRequired=input.enabled!;}state={...state,revision:String(Number(state.revision)+1)};}data={state,canManage};}
 else if(u.pathname==='/api/rooms/DISCORD1')data=room();else if(u.pathname==='/api/rooms')data={rooms:[]};else if(u.pathname==='/api/discord')data={state:{...room(),ready:true,connected:true,online:true,queueRevision:'1',volume:100}};else if(u.pathname.includes('realtime'))return route.abort();else if(u.pathname==='/api/history')data={videos:[]};
 return route.fulfill({json:data});});
 await page.goto(base+'/?room=DISCORD1');await page.locator('.social-track').waitFor();await page.locator('.room-options > summary').click();await page.locator('.queue-options summary').click();
 if(canManage){await page.getByRole('checkbox',{name:'Approve guest track requests'}).click();await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('.approval-choice input')?.checked);page.on('dialog',d=>d.accept());await page.locator('.queue-options button').filter({hasText:/^Clear$/}).click();await page.waitForFunction(()=>document.querySelectorAll('.social-track').length===0);await page.locator('.queue-options button').filter({hasText:'Undo queue edit'}).click();await page.locator('.social-track').waitFor();assert.deepEqual(actions.map(a=>a.action),['approval','clear','undo']);}
 else{assert.equal(await page.locator('.queue-options input').count(),0);assert.equal(await page.locator('.queue-options button').count(),0);assert.equal(await page.getByRole('button',{name:/Move up/}).count(),0);}
 assert.equal(await page.locator('.social-track img').count(),1);await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);await page.close();
}console.log('PASS Discord queue parity, settings, moderation, clear/undo, guest controls and mobile width');}finally{await browser.close();}
