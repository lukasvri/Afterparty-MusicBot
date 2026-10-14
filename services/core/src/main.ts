import {join} from 'node:path';
import {Client,Events,GatewayIntentBits,ActivityType} from 'discord.js';
import {UserError} from './types.ts';
import {Store} from './store.ts';import {Providers} from './providers.ts';import {DiscordSink} from './audio.ts';import {Engine} from './engine.ts';import {Commands} from './commands.ts';import {DiscordBot} from './discord.ts';import {createServers} from './server.ts';import {Publisher} from './publisher.ts';import {Guilds} from './guilds.ts';import {DiscordOAuth} from './oauth.ts';import {Metrics} from './metrics.ts';
const env=process.env,shadow=env.CORE_MODE==='shadow',root=env.DATA_DIR??'./data',defaultId=env.DISCORD_GUILD_ID??'';
const key=env.PUBLIC_SITE_ADMIN_KEY??'',site=env.PUBLIC_SITE_URL??'';
if(!key||!site||!defaultId)throw new Error('Brokobling og eksisterende Discord-server må være konfigurert lokalt.');
const store=new Store(join(root,'core.sqlite'));if(env.LEGACY_DATA_DIR)store.importMuse(env.LEGACY_DATA_DIR,defaultId);
const sink=new DiscordSink(),engine=new Engine(store,new Providers(store),sink),commands=new Commands(engine);
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]}),metrics=new Metrics(),guilds=new Guilds(defaultId,store.get<Record<string,string>>('guild-room-codes',{}),codes=>store.set('guild-room-codes',codes));
const publishers=new Map<string,Publisher>(),starting=new Map<string,Promise<void>>();let closing=false;
async function ensure(id:string){if(guilds.sessions.has(id))return;if(starting.has(id))return starting.get(id);const job=(async()=>{
 const guild=await client.guilds.fetch(id);const own=id===defaultId;const data=own?store:new Store(join(root,'guilds',id,'core.sqlite'));const player=own?engine:new Engine(data,new Providers(data),new DiscordSink());const controls=own?commands:new Commands(player);
 const bot=new DiscordBot(player,controls,player.sink as DiscordSink,{...env,DISCORD_GUILD_ID:id,DISCORD_ROOM_CODE:guilds.roomCode(id),MUSIC_TEXT_CHANNEL_ID:own?env.MUSIC_TEXT_CHANNEL_ID:''},client,metrics);
 bot.musicChannelId=data.get('music-channel',bot.musicChannelId);
 bot.admitVoice=()=>{const active=[...guilds.sessions.values()].filter(s=>(s.engine.connected||s.bot.joining)&&s.id!==id).length;if(active>=Number(env.MAX_ACTIVE_VOICE_SESSIONS??8))throw new UserError('Serveren er opptatt. Prøv igjen om litt.');};
 guilds.register({id,name:guild.name,roomCode:guilds.roomCode(id),engine:player,commands:controls,bot});
 try{await bot.start('');publishers.set(id,new Publisher(player,controls,site,key,{guildId:id,roomCode:guilds.roomCode(id),guildName:guild.name}));}catch(error){guilds.remove(id);await bot.close();controls.close();player.close();if(!own)data.close();throw error;}
 })().finally(()=>starting.delete(id));starting.set(id,job);return job;
}
client.on(Events.InteractionCreate,i=>{const s=i.guildId?guilds.sessions.get(i.guildId):null;if(s)s.bot.handleInteraction(i);});
client.on(Events.VoiceStateUpdate,(before,after)=>guilds.sessions.get(after.guild.id)?.bot.voiceState(before,after));
client.on(Events.GuildCreate,g=>{void ensure(g.id).catch(()=>console.warn('En Discord-server kunne ikke startes.'));});
client.on(Events.GuildDelete,g=>{const s=guilds.remove(g.id);if(!s)return;publishers.get(g.id)?.close();publishers.delete(g.id);void s.bot.close();s.commands.close();if(g.id===defaultId){s.engine.stop();s.engine.ready=false;}else{s.engine.close();s.engine.store.close();}});
const ready=(value:boolean)=>{engine.ready=value;for(const s of guilds.sessions.values()){s.engine.ready=value;s.engine.changed();}};
client.on(Events.ShardDisconnect,()=>ready(false));client.on(Events.ShardResume,()=>ready(true));
if(!shadow){await client.login(env.DISCORD_TOKEN??'');if(!client.isReady())await new Promise<void>(r=>client.once(Events.ClientReady,()=>r()));ready(true);for(const id of client.guilds.cache.keys())await ensure(id);}
const oauth=new DiscordOAuth(key,client.user?.id??env.DISCORD_CLIENT_ID??'',env.DISCORD_CLIENT_SECRET??'',new URL(site).origin);
const servers=await createServers(engine,commands,{key,origin:new URL(site).origin,passwordHash:'',hosts:[],publicPort:Number(env.CORE_PORT??3990),adminPort:false,isReady:()=>client.isReady(),guilds,oauth,applicationId:()=>client.user?.id??'',privateState:()=>guilds.get().bot.privateState(),onRequest:ms=>metrics.request(ms)});
const presence=setInterval(()=>client.user?.setActivity(`${[...guilds.sessions.values()].filter(s=>s.engine.snapshot().playing).length} servere spiller · Afterparty`,{type:ActivityType.Listening}),15000);
console.log('Gutta Krutt er klar for flere servere. Administrasjon finnes på nettsiden.');
const close=async()=>{if(closing)return;closing=true;clearInterval(presence);for(const p of publishers.values())p.close();for(const s of guilds.sessions.values()){s.engine.checkpoint();await s.bot.close();s.commands.close();s.engine.close();if(s.id!==defaultId)s.engine.store.close();}if(!guilds.sessions.has(defaultId)){commands.close();engine.close();}await client.destroy();metrics.close();await servers.close();store.close();process.exit(0);};process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
