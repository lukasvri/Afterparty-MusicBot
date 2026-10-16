// Exercise the real admin slider with synthetic API state and a monotonic clock.
// Run against a local preview with PLAYWRIGHT_MODULE and CHROMIUM_PATH if needed.
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:8787';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page = await browser.newPage();
 const errors = [], commands = [];
 page.on('pageerror', e => errors.push(e.message));
 await page.addInitScript(() => {
  localStorage.setItem('gutta-language','en');
  const original = performance.now.bind(performance);
  window.seekClockOffset = 0;
  performance.now = () => original() + window.seekClockOffset;
 });
 const guild = {id:'111111111111111',name:'Synthetic seek test',installed:true,roomCode:'ROOMAAAA'};
 const state = {ready:true,connected:true,playing:false,current:{id:'synthetic01',title:'Synthetic track',artist:'Fixture',duration:300,live:false,image:''},queue:[],position:30,volume:60,queueRevision:7};
 await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if(url.origin !== base) return route.abort();
  if(!url.pathname.startsWith('/api/')) return route.continue();
  let data = {};
  if(url.pathname === '/api/admin/guilds') data = {authenticated:true,globalAdmin:true,guilds:[guild]};
  else if(url.pathname === '/api/admin/control') {
   if(route.request().method() === 'POST') {
    const input = route.request().postDataJSON();
    assert.equal(input.guildId,guild.id);
    assert.equal(input.operation,'command');
    assert.equal(input.command.queueRevision,7);
    commands.push(input.command);
    if(input.command.action === 'resume') state.playing = true;
    if(input.command.action === 'pause') state.playing = false;
    data = {status:'done'};
   } else data = {guildId:guild.id,roomCode:guild.roomCode,state,settings:{radio:false},player:{loopCurrentSong:false,loopCurrentQueue:false,bitrate:192000},snapshots:[],commands:[],sleepTimerEndsAt:null};
  }
  return route.fulfill({json:data});
 });
 await page.goto(base+'/admin');
 const slider = page.locator('.admin-seek input');
 await slider.waitFor();
 for(let cycle=0;cycle<2;cycle++) {
  await page.evaluate(() => {window.seekClockOffset += 60000;});
  await page.waitForTimeout(600);
  assert.equal(Number(await slider.inputValue()),30,'Paused time cannot move the slider');
  await page.getByRole('button',{name:'Resume',exact:true}).click();
  await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
  await page.waitForTimeout(600);
  const resumed = Number(await slider.inputValue());
  assert(resumed >= 30 && resumed < 33,`Resume must exclude paused time, got ${resumed}`);
  assert.equal(commands.filter(c=>c.action==='seek').length,cycle,'Clock updates must not publish seeks');
  await slider.focus();
  await slider.press('ArrowRight');
  await page.waitForFunction(() => !document.querySelector('.admin-seek input').disabled);
  const seeks = commands.filter(c=>c.action==='seek');
  assert.equal(seeks.length,cycle+1);
  assert(seeks.at(-1).seconds >= 31 && seeks.at(-1).seconds < 35,'Keyboard seek uses the fresh playback sample');
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.getByRole('button',{name:'Resume',exact:true}).waitFor();
 }
 // Polling a playback transition must not overwrite an unfinished pointer edit.
 await slider.dispatchEvent('pointerdown');
 await slider.fill('75');
 state.playing = true;
 await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
 await page.waitForTimeout(600);
 assert.equal(Number(await slider.inputValue()),75);
 await slider.dispatchEvent('pointerup');
 await page.waitForFunction(() => !document.querySelector('.admin-seek input').disabled);
 assert.equal(commands.filter(c=>c.action==='seek').at(-1).seconds,75);
 state.position = 100;
 await page.waitForFunction(() => {
  const value = Number(document.querySelector('.admin-seek input').value);
  return value >= 100 && value < 104;
 });
 // Replacing the track must discard an unfinished edit even at the same position.
 await slider.dispatchEvent('pointerdown');
 await slider.fill('75');
 state.current = {...state.current,id:'synthetic02',title:'Replacement fixture'};
 await page.waitForFunction(() => {
  const value = Number(document.querySelector('.admin-seek input').value);
  return value >= 100 && value < 104;
 });
 await slider.dispatchEvent('pointerup');
 assert.equal(commands.filter(c=>c.action==='seek').length,3,'Track replacement discards the old edit');
 assert.deepEqual(errors,[]);
 console.log('PASS admin slider excludes paused time over repeated resumes, sends accurate keyboard seeks, preserves pointer edits, and resets on position/track changes');
} finally {await browser.close();}
