import { Client, GatewayIntentBits, Events, MessageFlags, PermissionFlagsBits, ActivityType, ChannelType, type ChatInputCommandInteraction, type ButtonInteraction, type VoiceBasedChannel, type Guild } from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, type VoiceConnection } from '@discordjs/voice';
import { readFile } from 'node:fs/promises';
import { PlayerMessage, playerEmbed, playerComponents, playerMoreComponents, formatTime } from './player-message.ts';
import { youtubeId } from './providers.ts';
import { Engine } from './engine.ts';
import { Metrics } from './metrics.ts';
import { Commands } from './commands.ts';
import { DiscordSink } from './audio.ts';
import { UserError, type Track } from './types.ts';
export class DiscordBot {
    metrics:Metrics;
    ownsClient:boolean;
    ownsMetrics:boolean;
    roomCode:string;
    stateListener:(()=>void)|null=null;
    joining=false;
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
    handleInteraction(interaction:any){
        if(interaction.guildId!==this.guildId)return;
        if(interaction.isAutocomplete()){
            const focused=interaction.options.getFocused(),now=Date.now(),last=this.autocompleteAt.get(interaction.user.id)??0;if(focused.length<3||now-last<1000){void interaction.respond([]);return;}if(this.autocompleteAt.size>1000)this.autocompleteAt.clear();this.autocompleteAt.set(interaction.user.id,now);
            void Promise.race([this.engine.providers.search(focused,5),new Promise<never[]>(r=>setTimeout(()=>r([]),2000))]).then(tracks=>interaction.respond(tracks.map(t=>({name:(t.artist+' · '+t.title).slice(0,100),value:'https://www.youtube.com/watch?v='+t.id})))).catch(()=>interaction.respond([]).catch(()=>{}));return;
        }
        if(interaction.isChatInputCommand()||interaction.isButton())void this.interaction(interaction);
    }
    voiceState(before:any,after:any){
        if(after.guild.id!==this.guildId||!this.connection)return;
        const channelId=this.connection.joinConfig.channelId;
        if(after.id===this.client.user?.id&&!after.channelId){this.disconnect();return;}
        const channel=after.guild.channels.cache.get(channelId);
        if(!this.testing&&channel?.isVoiceBased()&&this.engine.settings.leaveIfNoListeners&&channel.members.filter((m:any)=>!m.user.bot).size===0)this.disconnect();
    }
    async start(token:string){
        if(this.ownsClient){await this.client.login(token);if(!this.client.isReady())await new Promise<void>(resolve=>this.client.once(Events.ClientReady,()=>resolve()));}
        const guild=await this.client.guilds.fetch(this.guildId),definitions=JSON.parse(await readFile(new URL('./legacy-commands.json',import.meta.url),'utf8'));
        await guild.commands.set(definitions);
        this.messageTimer=setInterval(()=>{
            void this.updateMessage();if(this.ownsClient)this.activity();
            if(!this.engine.current&&this.engine.connected){if(this.engine.settings.secondsToWaitAfterQueueEmpties>0&&Date.now()-this.idleSince>this.engine.settings.secondsToWaitAfterQueueEmpties*1000)this.disconnect();}else this.idleSince=Date.now();
        },3000);
        await this.restore(guild);if(this.engine.current)await this.playerMessage.update(true,true).catch(()=>console.warn('Spillermeldingen kunne ikke flyttes.'));
    }
    async restore(guild: Guild) { const id = this.engine.store.get<string | null>('voice-channel', null), recovery = this.engine.store.get<{
        paused: boolean;
    } | null>('recovery', null); if (!id || !this.engine.queue.length)
        return; const channel = await guild.channels.fetch(id).catch(() => null); if (!channel?.isVoiceBased() || !channel.members.some(m => !m.user.bot))
        return; await this.join(channel); await this.engine.startNext(); if (recovery?.paused && this.engine.current)
        this.engine.pause(); }
    async diagnostic() { if (this.engine.current || this.engine.queue.length || this.engine.connected)
        throw new UserError('Testen krever en tom bot.'); const guild = await this.client.guilds.fetch(this.guildId); const channels = await guild.channels.fetch(); const channel = channels.find(c => c?.type === ChannelType.GuildVoice && !c.members.some(m => !m.user.bot) && c.permissionsFor(guild.members.me!).has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])); if (!channel?.isVoiceBased())
        throw new UserError('Fant ingen tom talekanal for testen.'); this.testing = true; const settings = this.engine.settings; try {
        this.engine.setSettings({ radio: false, crossfade: 0 });
        await this.join(channel);
        await this.commands.add('K4DyBUG242c', 'diagnostic');
        const deadline = Date.now() + 45000;
        while (this.engine.snapshot().position < 5 && Date.now() < deadline) {
            if (!this.engine.current && !this.engine.loading)
                throw new UserError(this.engine.lastError || 'Testlyden stoppet.');
            await new Promise(r => setTimeout(r, 100));
        }
        const before = this.engine.snapshot();
        if (!before.playing || before.position < 5)
            throw new UserError('Discord mottok ikke nok lydpakker.');
        this.engine.pause();
        const paused = this.engine.snapshot().position;
        await new Promise(r => setTimeout(r, 300));
        if (Math.abs(this.engine.snapshot().position - paused) > .04)
            throw new UserError('Lydklokken stoppet ikke ved pause.');
        this.engine.resume();
        await new Promise(r => setTimeout(r, 500));
        if (this.engine.snapshot().position < paused + .3)
            throw new UserError('Lydklokken startet ikke igjen.');
        return JSON.stringify({ voiceReady: true, audioSeconds: before.position, pauseClockFrozen: true, resumeClockAdvanced: true, engine: 'gutta-krutt-core' });
    }
    finally {
        this.engine.stop();
        this.disconnect();
        this.engine.setSettings(settings);
        this.testing = false;
    } }
    async join(channel:VoiceBasedChannel){if(this.connection?.joinConfig.channelId===channel.id&&this.engine.connected)return;this.admitVoice?.();this.joining=true;try{await this.connectVoice(channel);}finally{this.joining=false;}}
    async connectVoice(channel: VoiceBasedChannel) { if (this.connection?.joinConfig.channelId === channel.id && this.engine.connected)
        return; const me = channel.guild.members.me; if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]))
        throw new UserError('Boten mangler tilgang til å bli med og spille lyd.'); this.connection?.destroy(); this.connection = joinVoiceChannel({ guildId: this.guildId, channelId: channel.id, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: !this.engine.settings.turnDownVolumeWhenPeopleSpeak }); try {
        await entersState(this.connection, VoiceConnectionStatus.Ready, 20000);
    }
    catch {
        this.connection.destroy();
        this.connection = null;
        throw new UserError('Kunne ikke koble til talekanalen. Prøv igjen.');
    } this.engine.store.set('voice-channel', channel.id); this.connection.subscribe(this.sink.player); this.engine.channelBitrate = channel.bitrate; this.engine.setConnection(true); this.connection.on(VoiceConnectionStatus.Disconnected, () => { const connection = this.connection; if (!connection)
        return; void Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]).catch(() => { if (this.connection === connection)
        this.disconnect(); }); }); this.connection.receiver.speaking.on('start', id => { if (id === this.client.user?.id)
        return; this.talking.add(id); this.engine.ducking = this.engine.settings.turnDownVolumeWhenPeopleSpeak && this.talking.size > 0; }); this.connection.receiver.speaking.on('end', id => { this.talking.delete(id); this.engine.ducking = this.engine.settings.turnDownVolumeWhenPeopleSpeak && this.talking.size > 0; }); }
    disconnect() { this.connection?.destroy(); this.connection = null; this.talking.clear(); this.engine.ducking = false; this.engine.setConnection(false); }
    async sameVoice(interaction: ChatInputCommandInteraction | ButtonInteraction, join = false) { const member = await interaction.guild!.members.fetch(interaction.user.id), channel = member.voice.channel; if (!channel)
        throw new UserError('Bli med i en talekanal først.'); if (this.connection && channel.id !== this.connection.joinConfig.channelId)
        throw new UserError('Du må være i samme talekanal som boten.'); if (join)
        await this.join(channel);
    else if (!this.connection)
        throw new UserError('Start musikken med /play først.'); return member; }
    async manager(interaction: ChatInputCommandInteraction) { const member = await interaction.guild!.members.fetch(interaction.user.id); if (!member.permissions.has(PermissionFlagsBits.ManageGuild))
        throw new UserError('Du må kunne administrere serveren for å endre denne innstillingen.', 403); }
    async interaction(interaction: ChatInputCommandInteraction | ButtonInteraction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (interaction.isButton()) {
                await this.sameVoice(interaction);
                const id = interaction.customId.replace(/^(?:muse|krutt):/, '');
                const e = this.engine;
                if(id==='more'){await interaction.editReply({content:'Flere valg',components:playerMoreComponents(this)});return;}
                if (id === 'favorite') {
                    if (!e.current)
                        throw new UserError('Ingen sang spiller.');
                    e.store.favorite(interaction.user.id, e.current.title, e.current.url ?? 'https://www.youtube.com/watch?v=' + e.current.id);
                    await interaction.editReply('Sangen er lagret som favoritt.');
                    return;
                }
                if(id==='queue'){
                    await interaction.editReply(e.queue.map((t,i)=>`${i+1}. ${t.title}`).join('\n').slice(0,1900)||'Køen er tom.');
                    return;
                }
                if(id==='back10'||id==='forward30'){
                    if(!e.current||e.current.live)throw new UserError('Denne sangen kan ikke spoles.');
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
                await this.sameVoice(interaction, true);
                if(!this.musicChannelId&&interaction.guild){const target=interaction.guild!.channels.cache.find(c=>c.isTextBased()&&c.name==='musikk')??interaction.channel;if(target?.isTextBased()&&'send'in target){this.musicChannelId=target.id;e.store.set('music-channel',target.id);}}
                const count = await this.commands.add(text('query', true), interaction.user.id, {next:name === 'play-next' || boolean('immediate') || boolean('skip'),immediate:boolean('skip'),shuffle:boolean('shuffle')});
                await this.playerMessage.confirmQueue(count,false,text('query',true));
                await this.updateMessage(true);
                await interaction.deleteReply();
                return;
            }
            if (name === 'config') {
                const sub = interaction.options.getSubcommand();
                if (sub === 'get') {
                    await interaction.editReply('```json\n' + JSON.stringify(e.settings, null, 2) + '\n```');
                    return;
                }
                await this.manager(interaction);
                const names: Record<string, string> = { 'set-audio-quality': 'audioBitrateKbps', 'set-playlist-limit': 'playlistLimit', 'set-wait-after-queue-empties': 'secondsToWaitAfterQueueEmpties', 'set-leave-if-no-listeners': 'leaveIfNoListeners', 'set-queue-add-response-hidden': 'queueAddResponseEphemeral', 'set-reduce-vol-when-voice': 'turnDownVolumeWhenPeopleSpeak', 'set-reduce-vol-when-voice-target': 'turnDownVolumeWhenPeopleSpeakTarget', 'set-auto-announce-next-song': 'autoAnnounceNextSong', 'set-default-volume': 'defaultVolume', 'set-default-queue-page-size': 'defaultQueuePageSize' };
                const option = interaction.options.data[0]?.options?.[0];
                if (!names[sub] || !option)
                    throw new UserError('Ukjent innstilling.');
                this.commands.updateSettings({ [names[sub]]: option.value });
                await interaction.editReply('Innstillingen er lagret.');
                return;
            }
            if (name === 'crossfade') {
                const sub = interaction.options.getSubcommand();
                if (sub !== 'status') {
                    await this.manager(interaction);
                    this.commands.updateSettings({ crossfade: sub === 'off' ? 0 : number('seconds', 6) });
                }
                await interaction.editReply(`Crossfade: ${e.settings.crossfade} sekunder.`);
                return;
            }
            if (name === 'hjelp') {
                await interaction.editReply('**Gutta Krutt**\n/play: YouTube-, Spotify- og SoundCloud-lenker. Bruk sc: foran et SoundCloud-søk. /play-next: legg fremst. /pause og /resume: felles avspilling. /skip: neste sang. /queue, /history og /favorites: musikken din. /konsert lenke: spill konserten i Discord og Afterparty. /crossfade og /config: innstillinger.\n' + this.site);
                return;
            }
            if (name === 'konsert') {
                const link = text('lenke').trim();
                if (link) {
                    const id = youtubeId(link);
                    if (!id)
                        throw new UserError('Bruk en gyldig YouTube-lenke.');
                    await this.sameVoice(interaction, true);
                    const count=await this.commands.add(id, interaction.user.id, {concert:true});
                    await this.playerMessage.confirmQueue(count,true,link);
                    await this.updateMessage(true);
                    await interaction.deleteReply();
                }
                else
                    await interaction.editReply('Se den felles konserten i Afterparty: ' + this.site + '/?room='+this.roomCode);
                return;
            }
            if (name === 'favorites') {
                const sub = interaction.options.getSubcommand(), favorites = e.store.favorites();
                if (sub === 'list') {
                    await interaction.editReply(favorites.length ? favorites.map(f => f.name).join('\n').slice(0, 1900) : 'Ingen favoritter ennå.');
                    return;
                }
                await this.sameVoice(interaction, sub === 'use');
                if (sub === 'create') {
                    e.store.favorite(interaction.user.id, text('name', true), text('query', true));
                    await interaction.editReply('Favoritten er lagret.');
                    return;
                }
                if (sub === 'remove') {
                    e.store.removeFavorite(interaction.user.id, text('name', true));
                    await interaction.editReply('Favoritten er fjernet.');
                    return;
                }
                const favorite = favorites.find(f => f.name === text('name', true));
                if (!favorite)
                    throw new UserError('Fant ikke favoritten.');
                const count=await this.commands.add(favorite.query, interaction.user.id, {next:boolean('immediate') || boolean('skip'),immediate:boolean('skip'),shuffle:boolean('shuffle')});
                await this.playerMessage.confirmQueue(count,false,favorite.name);
                await interaction.deleteReply();
                return;
            }
            if (name === 'grab') {
                if (!e.current)
                    throw new UserError('Ingen sang spiller.');
                await interaction.editReply(e.current.url ?? 'https://www.youtube.com/watch?v=' + e.current.id);
                return;
            }
            if (name === 'history') {
                const history = e.store.history(number('antall', 10));
                await interaction.editReply(history.length ? history.map((h, i) => `${i + 1}. ${h.video.artist} · ${h.video.title}`).join('\n').slice(0, 1950) : 'Ingen avspillinger ennå.');
                return;
            }
            if (name === 'queue') {
                const page = number('page', 1), size = number('page-size', e.settings.defaultQueuePageSize);
                await interaction.editReply(e.queue.slice((page - 1) * size, page * size).map((t, i) => `${(page - 1) * size + i + 1}. ${t.artist} · ${t.title}`).join('\n').slice(0, 1950) || 'Køen er tom.');
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
                    throw new UserError('Ingen sang spiller.');
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
                    await interaction.editReply('Flertallet stemte for neste sang.');
                    return;
                }
                await interaction.editReply(`${this.votes.size}/${needed} stemmer for å hoppe over.`);
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
                await interaction.editReply('Køen er ryddet.');
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
            await interaction.editReply('Utført.');
        }
        catch (error) {
            const message = error instanceof UserError ? error.message : 'Handlingen kunne ikke fullføres. Prøv igjen.';
            if (interaction.deferred || interaction.replied)
                await interaction.editReply(message).catch(() => { });
            else
                await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    }
    embed() { return playerEmbed(this); }
    components() { return playerComponents(this); }
    updateMessage(force = false) { return this.playerMessage.update(force); }
    activity() { const s = this.engine.snapshot(); const text = s.current ? `${formatTime(Math.floor(s.position / 15) * 15)} · ${s.current.title}`.slice(0, 120) : 'Gutta Krutt Afterparty'; if (text !== this.lastActivity) {
        this.client.user?.setActivity(text, { type: ActivityType.Listening });
        this.lastActivity = text;
    } }
    privateState() { const e = this.engine, s = e.snapshot(), guild = this.client.guilds.cache.get(this.guildId); const song = (t: Track | null) => t ? { title: t.title, artist: t.artist, length: t.duration, thumbnailUrl: t.image, isLive: t.live, url: t.url ?? 'https://www.youtube.com/watch?v=' + t.id, source: t.source ?? 'youtube', requestedBy: t.requestedBy } : null; const memory = process.memoryUsage(); return { bot: { guildCount: guild ? 1 : 0, ready: e.ready, user: this.client.user?.username ?? 'Gutta Krutt' }, guildId: this.guildId, guilds: guild ? [{ id: guild.id, name: guild.name, iconUrl: guild.iconURL() }] : [], activity: this.commands.activity, performance: this.metrics.snapshot(this.client.ws.ping), player: { queueRevision: e.revision(), connected: e.connected, current: song(e.current), loopCurrentQueue: e.loopQueue, loopCurrentSong: e.loop, position: s.position, queue: e.queue.map((t, i) => ({ ...song(t), position: i + 1 })), status: s.playing ? 'playing' : e.current ? 'paused' : 'idle', volume: e.volume, bitrate: e.bitrate, radioProvider: e.providers.recommendationStatus, lastfmConfigured: e.providers.recommendations.enabled }, settings: { ...e.settings, updatedAt: new Date().toISOString() }, sleepTimerEndsAt: this.commands.sleepUntil, snapshots: e.store.get<any[]>('snapshots', []).map(q => ({ id: q.id, name: q.name, createdAt: q.createdAt, duration: q.tracks.reduce((n: number, t: Track) => n + t.duration, 0), songCount: q.tracks.length })) }; }
    async close() { if(this.stateListener)this.engine.off('state',this.stateListener);if(this.ownsMetrics)this.metrics.close(); if (this.messageTimer)
        clearInterval(this.messageTimer); this.disconnect(); if(this.ownsClient)await this.client.destroy(); }
}
export function parseTime(text: string) { if (/^\d+(?::\d{1,2}){0,2}$/.test(text))
    return text.split(':').reduce((n, v) => n * 60 + Number(v), 0); const match = text.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/); if (match && match.slice(1).some(Boolean))
    return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0); throw new UserError('Bruk sekunder eller minutt:sekund.'); }
