import {playerAction} from './player-compatibility.ts';
import { Client, GatewayIntentBits, Events, MessageFlags, PermissionFlagsBits, ActivityType, ChannelType, type Interaction, type AutocompleteInteraction, type VoiceState, type ChatInputCommandInteraction, type ButtonInteraction, type VoiceBasedChannel, type Guild } from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, type VoiceConnection } from '@discordjs/voice';
import { readFile } from 'node:fs/promises';
import { PlayerMessage, playerEmbed, playerComponents, playerMoreComponents, formatTime } from './player-message.ts';
import { youtubeId } from './providers.ts';
import { Engine } from './engine.ts';
import { Metrics } from './metrics.ts';
import { Commands } from './commands.ts';
import { DiscordSink } from './audio.ts';
import { UserError, type Track, type SavedQueue } from './types.ts';
function adminLink(site: string, guildId?: string) {
    try {
        const url = new URL('/admin', site);
        if (!['http:', 'https:'].includes(url.protocol)) return '';
        if (guildId && /^\d{14,22}$/.test(guildId)) url.searchParams.set('guildId', guildId);
        return url.href;
    } catch { return ''; }
}
export class DiscordBot {
    metrics:Metrics;
    ownsClient:boolean;
    ownsMetrics:boolean;
    roomCode:string;
    stateListener:(()=>void)|null=null;
    joining=false;
    private voiceJoin:{channelId:string;task:Promise<void>}|null=null;
    client: Client;
    engine: Engine;
    commands: Commands;
    sink: DiscordSink;
    guildId: string;
    musicChannelId: string;
    site: string;
    connection: VoiceConnection | null = null;
    playerMessage: PlayerMessage;
    messageTimer: ReturnType<typeof setInterval> | null = null;
    lastActivity = '';
    votes = new Set<string>();
    voteEntry = '';
    talking = new Set<string>();
    idleSince = Date.now();
    autocompleteAt=new Map<string,number>();
    testing = false;
    admitVoice:(()=>void)|null=null;
    constructor(engine: Engine, commands: Commands, sink: DiscordSink, env = process.env, sharedClient?:Client, sharedMetrics?:Metrics) {
        this.engine = engine;
        this.commands = commands;
        this.sink = sink;
        this.guildId = env.DISCORD_GUILD_ID ?? '';
        this.musicChannelId = env.MUSIC_TEXT_CHANNEL_ID ?? '';
        this.site = env.PUBLIC_SITE_URL ?? '';
        this.ownsClient=!sharedClient;this.ownsMetrics=!sharedMetrics;this.metrics=sharedMetrics??new Metrics();this.roomCode=env.DISCORD_ROOM_CODE??'DISCORD1';
        this.client = sharedClient??new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
        engine.ready=this.client.isReady();
        this.playerMessage = new PlayerMessage(this);
        commands.disconnect = () => this.disconnect();
        commands.diagnostic = () => this.diagnostic();
        if(this.ownsClient){
            this.client.on(Events.InteractionCreate,i=>this.handleInteraction(i));
            this.client.on(Events.ClientReady,()=>{engine.ready=true;engine.changed();});
            this.client.on(Events.ShardDisconnect,()=>{engine.ready=false;engine.changed();});
            this.client.on(Events.ShardResume,()=>{engine.ready=true;engine.changed();});
            this.client.on(Events.VoiceStateUpdate,(before,after)=>this.voiceState(before,after));
        }
        engine.on('state', this.stateListener=() => { if (engine.current?.entryId !== this.voteEntry) {
            this.votes.clear();
            this.voteEntry = engine.current?.entryId ?? '';
        } void this.updateMessage(); });
    }
    handleInteraction(interaction:Interaction){
        if(interaction.guildId!==this.guildId)return;
        if(interaction.isAutocomplete()){
            void this.autocomplete(interaction);return;
        }
        if(interaction.isChatInputCommand()||interaction.isButton())void this.interaction(interaction);
    }
    async autocomplete(interaction:AutocompleteInteraction){
        let timeout:ReturnType<typeof setTimeout>|undefined;
        try{
            const focused=interaction.options.getFocused(true),query=String(focused.value).trim();
            if(interaction.commandName==='favorites'&&focused.name==='name'){
                const matching=this.engine.store.favorites(interaction.user.id)
                    .filter(f=>f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
                    .slice(0,25).map(f=>({name:f.name,value:f.name}));
                await interaction.respond(matching);return;
            }
            if(!['play','play-next','play-advanced'].includes(interaction.commandName)||focused.name!=='query'){
                await interaction.respond([]);return;
            }
            const now=Date.now(),last=this.autocompleteAt.get(interaction.user.id)??0;
            if(query.length<3||now-last<1000){await interaction.respond([]);return;}
            if(this.autocompleteAt.size>1000)this.autocompleteAt.clear();
            this.autocompleteAt.set(interaction.user.id,now);
            const tracks=await Promise.race([
                this.engine.providers.search(query,5),
                new Promise<Track[]>(resolve=>{timeout=setTimeout(()=>resolve([]),2000);}),
            ]);
            await interaction.respond(tracks.map(t=>({name:(t.artist+' · '+t.title).slice(0,100),value:'https://www.youtube.com/watch?v='+t.id})));
        }catch{
            if(!interaction.responded)await interaction.respond([]).catch(()=>{});
        }finally{
            if(timeout)clearTimeout(timeout);
        }
    }
    voiceState(before:VoiceState,after:VoiceState){
        if(after.guild.id!==this.guildId||!this.connection)return;
        const channelId=this.connection.joinConfig.channelId;
        if(after.id===this.client.user?.id&&!after.channelId){this.disconnect();return;}
        const channel=channelId?after.guild.channels.cache.get(channelId):undefined;
        if(!this.testing&&channel?.isVoiceBased()&&this.engine.settings.leaveIfNoListeners&&channel.members.filter(m=>!m.user.bot).size===0)this.disconnect();
    }
    async start(token:string){
        if(this.ownsClient){await this.client.login(token);if(!this.client.isReady())await new Promise<void>(resolve=>this.client.once(Events.ClientReady,()=>resolve()));}
        const guild=await this.client.guilds.fetch(this.guildId),definitions=JSON.parse(await readFile(new URL('./afterparty-commands.json',import.meta.url),'utf8'));
        await guild.commands.set(definitions);
        this.messageTimer=setInterval(()=>{
            void this.updateMessage();if(this.ownsClient)this.activity();
            if(!this.engine.current&&this.engine.connected){if(this.engine.settings.secondsToWaitAfterQueueEmpties>0&&Date.now()-this.idleSince>this.engine.settings.secondsToWaitAfterQueueEmpties*1000)this.disconnect();}else this.idleSince=Date.now();
        },3000);
        await this.restore(guild);if(this.engine.current)await this.playerMessage.update(true,true).catch(()=>console.warn('The player message could not be moved.'));
    }
    async restore(guild: Guild) { const id = this.engine.store.get<string | null>('voice-channel', null), recovery = this.engine.store.get<{
        paused: boolean;
    } | null>('recovery', null); if (!id || !this.engine.queue.length)
        return; const channel = await guild.channels.fetch(id).catch(() => null); if (!channel?.isVoiceBased() || !channel.members.some(m => !m.user.bot))
        return;
        try {
            await this.join(channel);
        } catch (error) {
            if (!(error instanceof UserError)) throw error;
            this.engine.lastError = 'Could not restore the voice connection. Use /play to try again.';
            this.engine.changed();
            return;
        }
        await this.engine.startNext(); if (recovery?.paused && this.engine.current)
        this.engine.pause(); }
    async diagnostic() { if (this.engine.current || this.engine.queue.length || this.engine.connected)
        throw new UserError('The test requires an idle bot with an empty queue.'); const guild = await this.client.guilds.fetch(this.guildId); const channels = await guild.channels.fetch(); const channel = channels.find(c => c?.type === ChannelType.GuildVoice && !c.members.some(m => !m.user.bot) && c.permissionsFor(guild.members.me!).has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])); if (!channel?.isVoiceBased())
        throw new UserError('No empty voice channel is available for the test.'); this.testing = true; const settings = this.engine.settings; try {
        this.engine.setSettings({ radio: false, crossfade: 0 });
        await this.join(channel);
        await this.commands.add('K4DyBUG242c', 'diagnostic');
        const deadline = Date.now() + 45000;
        while (this.engine.snapshot().position < 5 && Date.now() < deadline) {
            if (!this.engine.current && !this.engine.loading)
                throw new UserError(this.engine.lastError || 'The test audio stopped.');
            await new Promise(r => setTimeout(r, 100));
        }
        const before = this.engine.snapshot();
        if (!before.playing || before.position < 5)
            throw new UserError('Discord did not receive enough audio packets.');
        this.engine.pause();
        const paused = this.engine.snapshot().position;
        await new Promise(r => setTimeout(r, 300));
        if (Math.abs(this.engine.snapshot().position - paused) > .04)
            throw new UserError('The audio clock did not stop when paused.');
        this.engine.resume();
        await new Promise(r => setTimeout(r, 500));
        if (this.engine.snapshot().position < paused + .3)
            throw new UserError('The audio clock did not resume.');
        return JSON.stringify({ voiceReady: true, audioSeconds: before.position, pauseClockFrozen: true, resumeClockAdvanced: true, engine: 'gutta-krutt-core' });
    }
    finally {
        this.engine.stop();
        this.disconnect();
        this.engine.setSettings(settings);
        this.testing = false;
    } }
    async join(channel:VoiceBasedChannel){
        if(this.voiceJoin){
            if(this.voiceJoin.channelId!==channel.id)throw new UserError('The bot is already joining another voice channel. Try again.');
            return this.voiceJoin.task;
        }
        if(this.connection?.joinConfig.channelId===channel.id&&this.engine.connected)return;
        this.admitVoice?.();this.joining=true;
        const task=this.connectVoice(channel).finally(()=>{
            if(this.voiceJoin?.task===task){this.voiceJoin=null;this.joining=false;}
        });
        this.voiceJoin={channelId:channel.id,task};
        return task;
    }
    async connectVoice(channel: VoiceBasedChannel) { if (this.connection?.joinConfig.channelId === channel.id && this.engine.connected)
        return; const me = channel.guild.members.me; if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]))
        throw new UserError('The bot needs permission to connect and speak in this voice channel.'); this.connection?.destroy(); this.connection = joinVoiceChannel({ guildId: this.guildId, channelId: channel.id, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: !this.engine.settings.turnDownVolumeWhenPeopleSpeak }); const connection = this.connection; this.watchVoiceErrors(connection); try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    }
    catch {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
        if (this.connection === connection) this.connection = null;
        throw new UserError('Could not connect to the voice channel. Try again.');
    }
    if (this.connection !== connection) throw new UserError('The voice connection was interrupted. Try again.');
    this.engine.store.set('voice-channel', channel.id); this.connection.subscribe(this.sink.player); this.engine.channelBitrate = channel.bitrate; this.engine.setConnection(true); this.watchVoiceRecovery(connection); this.connection.receiver.speaking.on('start', id => { if (id === this.client.user?.id)
        return; this.talking.add(id); this.engine.ducking = this.engine.settings.turnDownVolumeWhenPeopleSpeak && this.talking.size > 0; }); this.connection.receiver.speaking.on('end', id => { this.talking.delete(id); this.engine.ducking = this.engine.settings.turnDownVolumeWhenPeopleSpeak && this.talking.size > 0; }); }
    watchVoiceRecovery(connection: VoiceConnection) {
        let deadline: ReturnType<typeof setTimeout> | null = null;
        let disconnectedAt: number | null = null;
        const clearDeadline = () => {
            if (deadline !== null) clearTimeout(deadline);
            deadline = null;
        };
        connection.on('stateChange', (_before, after) => {
            if (after.status === VoiceConnectionStatus.Destroyed) {
                clearDeadline();
                return;
            }
            if (this.connection !== connection) return;
            if (after.status === VoiceConnectionStatus.Ready) {
                clearDeadline();
                if (disconnectedAt !== null) {
                    this.engine.diagnostics.note('voice-reconnected', performance.now() - disconnectedAt);
                    disconnectedAt = null;
                }
                return;
            }
            // Ordinary WebSocket reconnects go straight from Ready to Signalling.
            // Bound the entire recovery, rather than only waiting to leave Disconnected.
            if (deadline !== null) return;
            disconnectedAt = performance.now();
            this.engine.diagnostics.note('voice-disconnected');
            deadline = setTimeout(() => {
                deadline = null;
                if (this.connection !== connection || connection.state.status === VoiceConnectionStatus.Ready || connection.state.status === VoiceConnectionStatus.Destroyed) return;
                this.engine.lastError = 'Could not restore the Discord voice connection. Use /play to try again.';
                this.engine.diagnostics.note('voice-error');
                this.disconnect();
            }, 20000);
            deadline.unref();
        });
    }
    watchVoiceErrors(connection: VoiceConnection) {
        // The library forwards WebSocket errors here, including during startup.
        // Keep its reconnect state machine alive without an unhandled error event.
        connection.on('error', () => {
            if (this.connection !== connection) return;
            this.engine.lastError = 'The Discord voice connection was interrupted. Waiting to reconnect.';
            this.engine.diagnostics.note('voice-error');
            this.engine.changed();
        });
    }
    disconnect() { const connection=this.connection;this.connection=null;this.voiceJoin=null;this.joining=false;if(connection&&connection.state.status!==VoiceConnectionStatus.Destroyed)connection.destroy();this.talking.clear();this.engine.ducking=false;this.engine.setConnection(false); }
    async sameVoice(interaction: ChatInputCommandInteraction | ButtonInteraction, join = false) { const member = await interaction.guild!.members.fetch(interaction.user.id), channel = member.voice.channel; if (!channel)
        throw new UserError('Join a voice channel first.'); if (this.connection && channel.id !== this.connection.joinConfig.channelId)
        throw new UserError('You must be in the same voice channel as the bot.'); if (join)
        await this.join(channel);
    else if (!this.connection)
        throw new UserError('Start playback with /play first.'); return member; }
    async manager(interaction: ChatInputCommandInteraction) { const member = await interaction.guild!.members.fetch(interaction.user.id); if (!member.permissions.has(PermissionFlagsBits.ManageGuild))
        throw new UserError('You need Manage Server permission to change this setting.', 403); }
    async interaction(interaction: ChatInputCommandInteraction | ButtonInteraction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (interaction.isButton()) {
                await this.sameVoice(interaction);
                const id = playerAction(interaction.customId);
                const e = this.engine;
                if(id==='more'){await interaction.editReply({content:'More controls',components:playerMoreComponents(this)});return;}
                if (id === 'favorite') {
                    if (!e.current)
                        throw new UserError('No track is playing.');
                    e.store.favorite(interaction.user.id, e.current.title, e.current.url ?? 'https://www.youtube.com/watch?v=' + e.current.id);
                    await interaction.editReply('The track was saved to your favorites.');
                    return;
                }
                if(id==='queue'){
                    await interaction.editReply(e.queue.map((t,i)=>`${i+1}. ${t.title}`).join('\n').slice(0,1900)||'The queue is empty.');
                    return;
                }
                if(id==='back10'||id==='forward30'){
                    if(!e.current||e.current.live)throw new UserError('This track cannot be seeked.');
                    await this.commands.execute({action:'seek',seconds:Math.max(0,Math.min(e.current.duration-.1,e.snapshot().position+(id==='back10'?-10:30)))},'discord',interaction.user.id);
                    await this.updateMessage(true);await interaction.deleteReply();return;
                }
                const action = id === 'pause-resume' ? (e.paused ? 'resume' : 'pause') : id === 'loop' ? 'loop' : id;
                await this.commands.execute({ action }, 'discord', interaction.user.id);
                await this.updateMessage(true);
                await interaction.deleteReply();
                return;
            }
            const name = interaction.commandName, e = this.engine;
            const text = (key: string, required = false) => interaction.options.getString(key, required) ?? '';
            const number = (key: string, fallback: number) => interaction.options.getInteger(key) ?? fallback;
            const boolean = (key: string) => interaction.options.getBoolean(key) ?? false;
            if (['play', 'play-next', 'play-advanced'].includes(name)) {
                if (boolean('split')) throw new UserError('Chapter splitting is not supported. Leave split off and try again.');
                await this.sameVoice(interaction, true);
                if(!this.musicChannelId&&interaction.guild){const target=interaction.guild!.channels.cache.find(c=>c.isTextBased()&&c.name==='musikk')??interaction.channel;if(target?.isTextBased()&&'send'in target){this.musicChannelId=target.id;e.store.set('music-channel',target.id);}}
                const count = await this.commands.add(text('query', true), interaction.user.id, {next:name === 'play-next' || boolean('next') || boolean('now') || boolean('immediate') || boolean('skip'),immediate:boolean('now') || boolean('skip'),shuffle:boolean('shuffle')});
                await this.playerMessage.confirmQueue(count,false);
                await this.updateMessage(true);
                await interaction.deleteReply();
                return;
            }
            if (name === 'config' || name === 'crossfade') {
                const admin = adminLink(this.site, this.guildId);
                await interaction.editReply('Bot settings are managed in web admin. ' + (admin || 'Ask the bot owner to configure the website URL.'));
                return;
            }
            if (name === 'help' || name === 'hjelp') {
                await interaction.editReply('**Afterparty**\n/play: YouTube, Spotify and SoundCloud links or track searches. Use sc: for SoundCloud search. Add next to queue next, now to play immediately, or shuffle for multiple tracks.\n/pause, /resume, /skip, /stop and /disconnect: playback controls. /seek, /fseek and /volume: position and volume.\n/queue, /history count and /favorites: your tracks. /vote-skip: listener voting. /now-playing: restore the player controls. /cleanup: duplicates or absent listeners.\n/concert url: share a YouTube concert in Discord and Afterparty. Ordinary /play stays private to Discord.\nManage server settings in web admin: ' + (adminLink(this.site, this.guildId) || 'ask the bot owner for the website URL.'));
                return;
            }
            if (name === 'concert' || name === 'konsert') {
                const link = text(name === 'concert' ? 'url' : 'lenke').trim();
                if (link) {
                    const id = youtubeId(link);
                    if (!id)
                        throw new UserError('Use a valid YouTube URL.');
                    await this.sameVoice(interaction, true);
                    const count=await this.commands.add(id, interaction.user.id, {concert:true});
                    await this.playerMessage.confirmQueue(count,true);
                    await this.updateMessage(true);
                    await interaction.deleteReply();
                }
                else
                    await interaction.editReply('Watch the shared concert in Afterparty: ' + this.site + '/?room='+this.roomCode);
                return;
            }
            if (name === 'favorites') {
                const sub = interaction.options.getSubcommand(), favorites = e.store.favorites(interaction.user.id);
                if (sub === 'use' && boolean('split')) throw new UserError('Chapter splitting is not supported. Leave split off and try again.');
                if (sub === 'list') {
                    await interaction.editReply(favorites.length ? favorites.map(f => f.name).join('\n').slice(0, 1900) : 'No favorites saved yet.');
                    return;
                }
                if (sub === 'create') {
                    e.store.favorite(interaction.user.id, text('name', true), text('query', true));
                    await interaction.editReply('The favorite was saved.');
                    return;
                }
                if (sub === 'remove') {
                    e.store.removeFavorite(interaction.user.id, text('name', true));
                    await interaction.editReply('The favorite was removed.');
                    return;
                }
                const favorite = favorites.find(f => f.name === text('name', true));
                if (!favorite)
                    throw new UserError('Favorite not found.');
                await this.sameVoice(interaction, true);
                const count=await this.commands.add(favorite.query, interaction.user.id, {next:boolean('immediate') || boolean('skip'),immediate:boolean('skip'),shuffle:boolean('shuffle')});
                await this.playerMessage.confirmQueue(count,false);
                await interaction.deleteReply();
                return;
            }
            if (name === 'grab') {
                if (!e.current)
                    throw new UserError('No track is playing.');
                await interaction.editReply(e.current.url ?? 'https://www.youtube.com/watch?v=' + e.current.id);
                return;
            }
            if (name === 'history') {
                const history = e.store.history(number('count', number('antall', 10)));
                await interaction.editReply(history.length ? history.map((h, i) => `${i + 1}. ${h.video.artist} · ${h.video.title}`).join('\n').slice(0, 1950) : 'No playback history yet.');
                return;
            }
            if (name === 'queue') {
                const page = number('page', 1), size = number('page-size', e.settings.defaultQueuePageSize);
                await interaction.editReply(e.queue.slice((page - 1) * size, page * size).map((t, i) => `${(page - 1) * size + i + 1}. ${t.artist} · ${t.title}`).join('\n').slice(0, 1950) || 'The queue is empty.');
                return;
            }
            if (name === 'now-playing') {
                await this.playerMessage.update(true,true);
                await interaction.deleteReply();
                return;
            }
            const member = await this.sameVoice(interaction);
            if (name === 'vote-skip') {
                if (!e.current)
                    throw new UserError('No track is playing.');
                const sub = interaction.options.getSubcommand();
                const listeners = member.voice.channel!.members.filter(m => !m.user.bot);
                for (const id of this.votes)
                    if (!listeners.has(id))
                        this.votes.delete(id);
                if (sub === 'vote')
                    this.votes.add(interaction.user.id);
                if (sub === 'undo')
                    this.votes.delete(interaction.user.id);
                const needed = Math.floor(listeners.size / 2) + 1;
                if (this.votes.size >= needed && sub === 'vote') {
                    await e.skip();
                    this.votes.clear();
                    await interaction.editReply('A majority voted to skip to the next track.');
                    return;
                }
                await interaction.editReply(`${this.votes.size}/${needed} votes to skip.`);
                return;
            }
            if (name === 'cleanup') {
                if (interaction.options.getSubcommand() === 'duplicates')
                    await this.commands.execute({ action: 'cleanup-duplicates' }, 'discord');
                else {
                    const listeners = member.voice.channel!.members;
                    e.queue = e.queue.filter(t => !t.requestedBy || t.requestedBy === 'website' || listeners.has(t.requestedBy));
                    e.mixer?.invalidateNext();
                    e.persist();
                    e.changed();
                }
                await interaction.editReply('The queue was cleaned up.');
                return;
            }
            let action = name;
            const input: Record<string, unknown> = { action };
            if (name === 'volume')
                input.value = number('level', 100);
            if (name === 'skip')
                input.number = number('number', 1);
            if (name === 'move') {
                input.from = number('from', 1);
                input.to = number('to', 1);
            }
            if (name === 'remove') {
                input.position = number('position', 1);
                input.range = number('range', 1);
            }
            if (['seek', 'fseek'].includes(name)) {
                action = 'seek';
                input.action = action;
                input.seconds = parseTime(text('time', true)) + (name === 'fseek' ? e.snapshot().position : 0);
            }
            await this.commands.execute(input, 'discord', interaction.user.id);
            await interaction.editReply('Done.');
        }
        catch (error) {
            const message = error instanceof UserError ? error.message : 'The action could not be completed. Try again.';
            if (interaction.deferred || interaction.replied)
                await interaction.editReply(message).catch(() => { });
            else
                await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    }
    embed() { return playerEmbed(this); }
    components() { return playerComponents(this); }
    updateMessage(force = false) { return this.playerMessage.update(force); }
    activity() { const s = this.engine.snapshot(); const text = s.current ? `${formatTime(Math.floor(s.position / 15) * 15)} · ${s.current.title}`.slice(0, 120) : 'Afterparty'; if (text !== this.lastActivity) {
        this.client.user?.setActivity(text, { type: ActivityType.Listening });
        this.lastActivity = text;
    } }
    privateState() { const e = this.engine, s = e.snapshot(), guild = this.client.guilds.cache.get(this.guildId); const song = (t: Track | null) => t ? { title: t.title, artist: t.artist, length: t.duration, thumbnailUrl: t.image, isLive: t.live, url: t.url ?? 'https://www.youtube.com/watch?v=' + t.id, source: t.source ?? 'youtube', requestedBy: t.requestedBy } : null; return { bot: { guildCount: guild ? 1 : 0, ready: e.ready, user: this.client.user?.username ?? 'Afterparty' }, guildId: this.guildId, guilds: guild ? [{ id: guild.id, name: guild.name, iconUrl: guild.iconURL() }] : [], activity: this.commands.activity, performance: this.metrics.snapshot(this.client.ws.ping), player: { queueRevision: e.revision(), connected: e.connected, current: song(e.current), loopCurrentQueue: e.loopQueue, loopCurrentSong: e.loop, position: s.position, queue: e.queue.map((t, i) => ({ ...song(t), position: i + 1 })), status: s.playing ? 'playing' : e.current ? 'paused' : 'idle', volume: e.volume, bitrate: e.bitrate, radioProvider: e.providers.recommendationStatus, radioError: e.radioError, lastfmConfigured: e.providers.recommendations.enabled }, settings: { ...e.settings, updatedAt: new Date().toISOString() }, sleepTimerEndsAt: this.commands.sleepUntil, snapshots: e.store.get<SavedQueue[]>('snapshots', []).map(q => ({ id: q.id, name: q.name, createdAt: q.createdAt, duration: q.tracks.reduce((n: number, t: Track) => n + t.duration, 0), songCount: q.tracks.length })) }; }
    async close() { if(this.stateListener)this.engine.off('state',this.stateListener);if(this.ownsMetrics)this.metrics.close(); if (this.messageTimer)
        clearInterval(this.messageTimer); this.disconnect(); if(this.ownsClient)await this.client.destroy(); }
}
export function parseTime(text: string) { if (/^\d+(?::\d{1,2}){0,2}$/.test(text))
    return text.split(':').reduce((n, v) => n * 60 + Number(v), 0); const match = text.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/); if (match && match.slice(1).some(Boolean))
    return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0); throw new UserError('Use seconds or minutes:seconds.'); }
