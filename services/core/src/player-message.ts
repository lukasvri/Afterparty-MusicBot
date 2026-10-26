import {isPlayerButton} from './player-compatibility.ts';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type Message } from 'discord.js';
import {UserError} from './types.ts';
import type { DiscordBot } from './discord.ts';
import { concertLink } from './concert-links.ts';
/** 16-position timeline, with bounded values for live and loading tracks. */
export function progressBar(position:number,duration:number){
    const progress=duration>0&&Number.isFinite(position)?position/duration:0;
    const dot=Math.max(0,Math.min(15,Math.floor(16*progress)));
    return Array.from({length:16},(_,i)=>i===dot?'🔘':'▬').join('');
}
export function playerEmbed(bot: DiscordBot) {
    const state=bot.engine.snapshot(),track=state.current;
    const embed=new EmbedBuilder().setColor(state.playing?'DarkGreen':'DarkRed');
    if(!track)return embed.setTitle('Playback finished').setDescription(bot.engine.lastError?'Could not play this track. Try another one with /play.':'Choose another track with /play.');
    const status=bot.engine.loading?'Loading':state.buffering?'Buffering':state.playing?'Now playing':'Paused';
    const url=track.source==='soundcloud'?track.url:`https://www.youtube.com/watch?v=${track.id}`;
    const title=track.title.replace(/\[.*\]/,'').trim().slice(0,256).replace(/([\\[\]])/g,'\\$1');
    const requestedBy=bot.engine.current?.requestedBy;
    const requester=requestedBy&&/^\d+$/.test(requestedBy)?`\nRequested by: <@${requestedBy}>`:'';
    const time=track.live?'Live':`${formatTime(state.position)}/${formatTime(track.duration)}`;
    const timeline=track.live?'':`${progressBar(state.position,track.duration)} `;
    const loop=bot.engine.loop?' 🔂':bot.engine.loopQueue?' 🔁':'';
    const volume=Number.isFinite(state.volume)?` 🔉 ${state.volume}%`:'';
    return embed.setTitle(status)
        .setDescription(`**${url?`[${title}](${url})`:title}**${requester}\n\n${state.playing?'⏹️':'▶️'} ${timeline}\`[${time}]\`${volume}${loop}`)
        .setFooter({text:`Source: ${track.artist}`.slice(0,2048)})
        .setThumbnail(track.image||null);
}
// Afterparty player controls; attribution is retained in THIRD_PARTY_NOTICES.md.
const icons:Record<string,string>={skip:'⏭️',stop:'⏹️',more:'⚙️',back10:'⏪',forward30:'⏩',queue:'📜',loop:'🔁',shuffle:'🔀',favorite:'⭐'};
const control=(id:string,label:string,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId('krutt:'+id).setLabel(label).setStyle(style).setEmoji(id==='pause-resume'?(label==='Resume'?'▶️':'⏸️'):icons[id]);
export function playerComponents(bot: DiscordBot) {
    const e=bot.engine;
    const playback=new ActionRowBuilder<ButtonBuilder>().addComponents(
        control('pause-resume',e.paused?'Resume':'Pause'),
        control('skip','Skip',ButtonStyle.Primary),control('stop','Stop',ButtonStyle.Danger),
    );
    const extras=new ActionRowBuilder<ButtonBuilder>().addComponents(
        control('loop','Loop',e.loop?ButtonStyle.Success:ButtonStyle.Secondary),
        control('shuffle','Shuffle queue'),control('favorite','Save favorite'),
    );
    const concert = e.current?.concert ? concertLink(bot.site, bot.guildId) : '';
    if(concert)extras.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Watch video · Afterparty').setURL(concert));
    return [playback,extras];
}
/** Secondary actions are private to the person opening the menu. */
export function playerMoreComponents(bot:DiscordBot){
    const e=bot.engine,seekDisabled=Boolean(!e.current||e.current.live||e.loading);
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(control('back10','−10 sec').setDisabled(seekDisabled),control('forward30','+30 sec').setDisabled(seekDisabled),control('queue','Show queue')),
        new ActionRowBuilder<ButtonBuilder>().addComponents(control('loop','Loop',e.loop?ButtonStyle.Success:ButtonStyle.Secondary),control('shuffle','Shuffle queue').setDisabled(e.queue.length<2),control('favorite','Save favorite')),
    ];
}
export function formatTime(seconds:number){const n=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));return n>=3600?`${Math.floor(n/3600)}:${String(Math.floor(n%3600/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`:`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
/** One ordinary bot message in #musikk. Serial writes prevent duplicate posts. */
export class PlayerMessage {
    private message: Message | null = null;
    private tail: Promise<unknown> = Promise.resolve();
    private lastEdit = 0;
    private lastPayload = '';
    private bot: DiscordBot;
    constructor(bot: DiscordBot) { this.bot = bot; }
    private notice='';
    private noticeUntil=0;
    async confirmQueue(count:number,concert:boolean):Promise<void>{
        this.notice=`Added ${count} ${concert ? 'concert' : 'track'}${count === 1 ? '' : 's'} to the queue.`;
        this.noticeUntil=Date.now()+15000;
        await this.update(true,true);
    }
    update(force=false,bringToBottom=false):Promise<void>{
        const bot = this.bot;
        if(!this.message&&!bot.engine.current&&!bot.engine.queue.length&&!bot.engine.store.get('player-message',null))return Promise.resolve();
        if (!bot.client.isReady() || (!force && Date.now() - this.lastEdit < 2500))
            return Promise.resolve();
        const job = this.tail.catch(() => { }).then(async () => {
            if (!force && Date.now() - this.lastEdit < 2500)
                return;
            const guild = bot.client.guilds.cache.get(bot.guildId);
            const channel = guild?.channels.cache.get(bot.musicChannelId) || guild?.channels.cache.find(c => c.isTextBased() && c.name === 'musikk');
            if (!channel?.isTextBased() || !('send' in channel))
                throw new UserError('The tracks were queued, but the player could not be shown. Check the configured music channel permissions.');
            const own = (m: Message) => m.author.id === bot.client.user?.id && !m.webhookId;
            if (!this.message) {
                const id = bot.engine.store.get<string | null>('player-message', null);
                if (id) {
                    const saved = await channel.messages.fetch(id).catch(() => null);
                    if (saved && own(saved))
                        this.message = saved;
                }
                if (!this.message) {
                    const recent = await channel.messages.fetch({ limit: 20 });
                    this.message = recent.find(m => own(m) && m.components.some(r => 'components' in r && r.components.some(c => 'customId' in c && isPlayerButton(c.customId ?? '')))) ?? null;
                }
            }
            if (!this.message && !bot.engine.current && !bot.engine.queue.length)
                return;
            const payload = {content:Date.now()<this.noticeUntil?this.notice:'', embeds: [playerEmbed(bot)], components: bot.engine.current ? playerComponents(bot) : [], allowedMentions: { parse: [] as never[] } };
            const fingerprint = JSON.stringify(payload);
            if (!bringToBottom && this.message && fingerprint === this.lastPayload)
                return;
            this.lastEdit = Date.now();
            if(bringToBottom){
                // Publish first: a failed send must leave the working player intact.
                const previous=this.message;
                this.message=await channel.send(payload);
                bot.engine.store.set('player-message',this.message.id);
                if(previous&&own(previous))await previous.delete().catch(async()=>{await previous.edit({content:'The player has moved to the latest message.',embeds:[],components:[]}).catch(()=>{});});
                this.lastPayload=fingerprint;
                return;
            }
            if (this.message) {
                try {
                    this.message = await this.message.edit(payload);
                }
                catch (error) {
                    if ((error as {
                        code?: number;
                    }).code !== 10008)
                        throw error;
                    this.message = null;
                }
            }
            if (!this.message)
                this.message = await channel.send(payload);
            this.lastPayload = fingerprint;
            bot.engine.store.set('player-message', this.message.id);
        });
        this.tail = job;
        return force ? job : job.catch(() => { });
    }
}
