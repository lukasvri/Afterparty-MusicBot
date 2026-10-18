// Synthetic server-selection and settings checks against an isolated local preview.
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as typeof import('playwright');
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:8787';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page = await browser.newPage();
 const errors: string[] = [];
 page.on('pageerror', e => errors.push(e.message));
 await page.addInitScript(() => localStorage.setItem('gutta-language','en'));
 const guilds = [{id:'111111111111111',name:'Synthetic A',installed:true,roomCode:'ROOMAAAA'},{id:'222222222222222',name:'Synthetic B',installed:true,roomCode:'ROOMBBBB'}];
 const settings = new Map(guilds.map(g => [g.id, {playlistLimit:50,defaultQueuePageSize:10,defaultVolume:g.id===guilds[0].id?60:80,audioBitrateKbps:192,crossfade:6,secondsToWaitAfterQueueEmpties:300,leaveIfNoListeners:true,queueAddResponseEphemeral:true,autoAnnounceNextSong:false,turnDownVolumeWhenPeopleSpeak:false,turnDownVolumeWhenPeopleSpeakTarget:30,radio:true}]));
 type Settings = NonNullable<ReturnType<typeof settings.get>>;
 let polls = 0, roomReads = 0, delayA = false;
 let releaseA: (() => void) | undefined;
 await page.route('**/*', async route => {
   const url = new URL(route.request().url());
   if(url.origin !== base) return route.abort();
   if(!url.pathname.startsWith('/api/')) return route.continue();
   let data: unknown = {};
   if(url.pathname === '/api/admin/guilds') data = {authenticated:true,globalAdmin:true,guilds,invite:'https://example.test/install'};
   else if(url.pathname === '/api/admin/rooms') {roomReads++; data = {rooms:[]};}
   else if(url.pathname === '/api/admin/control') {
     if(route.request().method() === 'POST') {
       const input: { guildId: string; operation: string; settings: Settings } = route.request().postDataJSON();
       assert(guilds.some(g => g.id === input.guildId));
       if(input.operation === 'settings') {
         settings.set(input.guildId,input.settings);
         data = {settings:settings.get(input.guildId)};
       } else data = {status:'done'};
     } else {
       const guildId = url.searchParams.get('guildId');
       assert(guildId);
       if(delayA && guildId === guilds[0].id) await new Promise<void>(resolve => {releaseA = resolve;});
       polls++;
       data = {guildId,roomCode:guilds.find(g=>g.id===guildId)!.roomCode,state:{ready:true,connected:false,playing:false,current:null,queue:[],position:0,volume:60},settings:settings.get(guildId),player:{loopCurrentSong:false,loopCurrentQueue:false,bitrate:192000,radioProvider:'artist',lastfmConfigured:false},snapshots:[],commands:[],sleepTimerEndsAt:null};
     }
   }
   return route.fulfill({json:data});
 });
 await page.goto(base+'/admin');
 await page.locator('.admin-tabs button').nth(1).click();
 const volume = page.locator('.settings-grid label').filter({hasText:'Default volume'}).locator('input');
 await volume.waitFor();
 assert.equal(await volume.inputValue(),'60');
 await volume.fill('37');
 const before = polls;
 await page.waitForFunction(() => true);
 await new Promise(resolve => setTimeout(resolve,5500));
 assert(polls > before, 'Background refresh must run while editing');
 assert.equal(await volume.inputValue(),'37','Polling must preserve unsaved settings');
 await page.locator('.guild-select select').selectOption(guilds[1].id);
 await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('.settings-grid input')].some(input=>input.value==='80'));
 assert.equal(await volume.inputValue(),'80','Server selection must discard another server draft');
 await volume.fill('44');
 await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/control' && response.request().method() === 'POST'),page.locator('.settings-grid button').click()]);
 await page.getByRole('status').filter({hasText:'Settings saved'}).waitFor();
 assert.equal(settings.get(guilds[1].id)!.defaultVolume,44);
 assert.equal(settings.get(guilds[0].id)!.defaultVolume,60);
 // An in-flight A response must not reappear after switching back to B.
 delayA = true;
 await page.locator('.guild-select select').selectOption(guilds[0].id);
 for(let attempt=0; !releaseA && attempt<500; attempt++) await new Promise(resolve=>setTimeout(resolve,20));
 assert(releaseA, "A request must start before switching servers");
 await page.locator('.guild-select select').selectOption(guilds[1].id);
 releaseA();
 await new Promise(resolve=>setTimeout(resolve,5500));
 assert.equal(await volume.inputValue(),'44');
 await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/rooms'), page.locator('.admin-tabs button').last().click()]);
 assert(roomReads > 0);
 assert.deepEqual(errors,[]);
 console.log('PASS admin drafts survive polling, server switches reset drafts, saves stay isolated, and stale responses are discarded');
} finally { await browser.close(); }
