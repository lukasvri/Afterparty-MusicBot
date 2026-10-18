import {Collection} from 'discord.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DiscordBot} from '../src/discord.ts';
import {PlayerMessage,playerEmbed,playerComponents,playerMoreComponents,formatTime,progressBar} from '../src/player-message.ts';

test('konsert queues the exact video for Discord and Afterparty, then publishes as bot',async()=>{
 const calls:unknown[]=[];
 const bot={engine:{},site:'https://example.test',sameVoice:async()=>calls.push('voice'),commands:{add:async(...args:unknown[])=>calls.push(args)},playerMessage:{confirmQueue:async()=>calls.push('confirmation')},updateMessage:async(force:boolean)=>calls.push(['message',force])};
 const interaction={guildId:'guild',user:{id:'listener'},commandName:'konsert',deferred:true,deferReply:async()=>{},isButton:()=>false,options:{getString:()=> 'https://youtu.be/abcdefghijk'},deleteReply:async()=>calls.push('delete-private-reply'),editReply:async(s:string)=>calls.push(s)};
 await DiscordBot.prototype.interaction.call(bot as never,interaction as never);
 assert.deepEqual(calls,['voice',['abcdefghijk','listener',{concert:true}],'confirmation',['message',true],'delete-private-reply']);
});

test('player posts a regular bot message, serializes updates and recovers a deleted message',async()=>{
 let sent=0,edited=0,missing=false;
 const saved=new Map<string,unknown>();
 const message={id:'player',author:{id:'bot'},webhookId:null,components:[],edit:async()=>{edited++;if(missing){missing=false;throw {code:10008};}return message;}};
 const channel={isTextBased:()=>true,messages:{fetch:async()=>new Collection()},send:async()=>{sent++;return message;}};
 const state={current:{title:'Song',artist:'Artist',image:'',duration:100},playing:true,position:0,queue:[]};
 const bot={client:{isReady:()=>true,user:{id:'bot'},guilds:{cache:new Map([['guild',{channels:{cache:new Map([['music',channel]])}}]])}},guildId:'guild',musicChannelId:'music',site:'https://example.test',engine:{loading:false,snapshot:()=>state,current:state.current,queue:[],paused:false,loop:false,store:{get:(k:string)=>saved.get(k),set:(k:string,v:unknown)=>saved.set(k,v)}}};
 const player=new PlayerMessage(bot as never);
 await Promise.all([player.update(true),player.update(true)]);
 assert.equal(sent,1);assert.equal(edited,0);
 state.position=3;await player.update(true);assert.equal(edited,1);
 missing=true;state.position=6;await player.update(true);assert.equal(sent,2);assert.equal(saved.get('player-message'),'player');
});

test('play stays Discord-only and sends a visible bot confirmation before deleting the private reply',async()=>{
 const calls:unknown[]=[];
 const bot={sameVoice:async()=>{},commands:{add:async(...args:unknown[])=>{calls.push(args);return 1;}},playerMessage:{confirmQueue:async(...args:unknown[])=>calls.push(args)},updateMessage:async()=>calls.push('player')};
 const interaction={guildId:'guild',user:{id:'listener'},commandName:'play',deferred:true,deferReply:async()=>{},isButton:()=>false,options:{getString:()=> 'song',getBoolean:()=>false},deleteReply:async()=>calls.push('delete'),editReply:async(s:string)=>calls.push(s)};
 await DiscordBot.prototype.interaction.call(bot as never,interaction as never);
 assert.deepEqual(calls,[['song','listener',{next:false,immediate:false,shuffle:false}],[1,false],'player','delete']);
});

function playerFixture(){
 const saved=new Map<string,unknown>();let sequence=0,fail=false;
 const old={id:'old',author:{id:'bot'},webhookId:null,components:[],deleted:false,edit:async()=>old,delete:async()=>{old.deleted=true;}};
 const posts:{payload:{allowedMentions:{parse:unknown[]};embeds:ReturnType<typeof playerEmbed>[];components:ReturnType<typeof playerComponents>};message:typeof old}[]=[];
 const channel={isTextBased:()=>true,messages:{fetch:async(id:unknown)=>typeof id==='string'?old:new Collection()},send:async(payload:typeof posts[number]["payload"])=>{if(fail)throw Error('Forbidden');const message={...old,id:'new'+(++sequence),deleted:false};posts.push({payload,message});return message;}};
 saved.set('player-message','old');
 const state={current:{id:'abcdefghijk',title:'Song',artist:'Artist',image:'',duration:100,live:false,concert:false},playing:true,position:25,volume:70,queue:[]};
 const bot={client:{isReady:()=>true,user:{id:'bot'},guilds:{cache:new Map([['guild',{channels:{cache:new Map([['music',channel]])}}]])}},guildId:'guild',musicChannelId:'music',site:'https://example.test',engine:{loading:false,snapshot:()=>state,current:state.current,queue:[],paused:false,loop:false,store:{get:(k:string)=>saved.get(k),set:(k:string,v:unknown)=>saved.set(k,v)}}};
 return {bot,state,old,posts,saved,player:new PlayerMessage(bot as never),fail:()=>{fail=true;}};
}
test('play confirmation brings the complete player to the bottom and retires the old card',async()=>{
 const t=playerFixture();await t.player.confirmQueue(1,false);
 assert.equal(t.posts.length,1);assert.equal(t.old.deleted,true);assert.equal(t.saved.get('player-message'),'new1');
 const p=t.posts[0].payload;assert.deepEqual(p.allowedMentions,{parse:[]});assert.equal(p.embeds[0].data.title,'Now playing');assert.match(p.embeds[0].data.description!,/0:25\/1:40/);assert.equal(p.components.length,2);
 const labels=p.components.flatMap((r)=>r.components.map((b)=>("label" in b.data ? b.data.label : undefined)));
 for(const label of ['Pause','Skip','Stop','Loop','Shuffle queue','Save favorite'])assert(labels.includes(label));
 await t.player.update(true);assert.equal(t.posts.length,1);
});
test('failed replacement preserves the existing working player',async()=>{const t=playerFixture();t.fail();await assert.rejects(t.player.confirmQueue(1,false),/Forbidden/);assert.equal(t.old.deleted,false);assert.equal(t.saved.get('player-message'),'old');});
test('progress handles start, end, long tracks, buffering and live seek restrictions',()=>{
 assert.equal(formatTime(3723),'1:02:03');
 const t=playerFixture();t.bot.engine.loading=true;assert.match(playerEmbed(t.bot as never).data.title!,/Loading/);
 t.state.current.live=true;const navigation=playerMoreComponents(t.bot as never)[0];assert(navigation.components[0].data.disabled);assert(navigation.components[1].data.disabled);
});
test('now-playing restores the public interactive card',async()=>{const calls:string[]=[];const bot={engine:{},playerMessage:{update:async(force:boolean,bottom:boolean)=>{assert(force&&bottom);calls.push('player');}}};const i={commandName:'now-playing',deferred:true,deferReply:async()=>{},isButton:()=>false,options:{},deleteReply:async()=>calls.push('delete'),editReply:async()=>calls.push('private')};await DiscordBot.prototype.interaction.call(bot as never,i as never);assert.deepEqual(calls,['player','delete']);});

test('advanced immediate queues first while skip starts the new selection',async()=>{for(const choice of ['immediate','skip']){let options:{next?:boolean;immediate?:boolean}={};const bot={sameVoice:async()=>{},commands:{add:async(_q:string,_a:string,o:typeof options)=>{options=o;return 1;}},playerMessage:{confirmQueue:async()=>{}},updateMessage:async()=>{}};const i={user:{id:'user'},commandName:'play-advanced',deferReply:async()=>{},isButton:()=>false,options:{getString:()=> 'song',getBoolean:(k:string)=>k===choice},deleteReply:async()=>{},editReply:async()=>{}};await DiscordBot.prototype.interaction.call(bot as never,i as never);assert.equal(options.next,true);assert.equal(options.immediate,choice==='skip');}});

test('extra controls stay in a private menu and preserve all secondary actions',async()=>{const t=playerFixture();let payload:{components:ReturnType<typeof playerMoreComponents>}={components:[]},flags=0;const bot={...t.bot,sameVoice:async()=>{}};const i={customId:'krutt:more',isButton:()=>true,deferReply:async(o:{flags:number})=>{flags=o.flags},editReply:async(p:typeof payload)=>{payload=p}};await DiscordBot.prototype.interaction.call(bot as never,i as never);assert.equal(flags,64);assert.equal(payload.components.length,2);const ids=payload.components.flatMap((r)=>r.components.map((b)=>("custom_id" in b.data ? b.data.custom_id : undefined)));assert.deepEqual(ids,['krutt:back10','krutt:forward30','krutt:queue','krutt:loop','krutt:shuffle','krutt:favorite']);assert.equal(playerComponents(t.bot as never)[0].components.length,3);assert(!playerEmbed(t.bot as never).data.description!.includes('Volum'));});

test('Player timeline is bounded and the image sits beside the text, with the original button rows',()=>{
 const t=playerFixture();t.state.current.image='https://example.test/cover.jpg';
 const embed=playerEmbed(t.bot as never).toJSON();assert.equal(embed.thumbnail?.url,t.state.current.image);assert.equal(embed.image,undefined);
 assert.equal(progressBar(-1,100),'🔘'+'▬'.repeat(15));assert.equal(progressBar(100,100),'▬'.repeat(15)+'🔘');assert.equal(progressBar(NaN,0),'🔘'+'▬'.repeat(15));
 const rows=playerComponents(t.bot as never).map(r=>r.toJSON());assert.deepEqual(rows.map(r=>r.components.length),[3,3]);assert.equal(rows[0].components[1].style,1);assert.equal(rows[0].components[2].style,4);
 t.bot.engine.paused=true;t.state.playing=false;const resume=playerComponents(t.bot as never)[0].components[0].toJSON();assert('emoji' in resume);assert.equal(resume.emoji?.name,'▶️');
 t.state.current.concert=true;assert.equal(playerComponents(t.bot as never)[1].components.length,4);
});
