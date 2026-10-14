import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Guild,
  Message,
  type MessageCreateOptions,
} from 'discord.js';
import Player, {STATUS} from '../services/player.js';
import {buildPlayingMessageEmbed} from './build-embed.js';

export const PLAYBACK_BUTTON_IDS = {
  pauseResume: 'muse:pause-resume',
  skip: 'muse:skip',
  loop: 'muse:loop',
  shuffle: 'muse:shuffle',
  favorite: 'muse:favorite',
  stop: 'muse:stop',
} as const;

const UPDATE_INTERVAL_MS = 3_000;
const ACTIVITY_TIME_STEP_SECONDS = 15;
let currentBotActivity = '';

interface TrackedMessage {
  message: Message;
  timer: NodeJS.Timeout;
}

const trackedMessages = new Map<string, TrackedMessage>();
const messageTails = new Map<string, Promise<unknown>>();

const serializeMessage = async <T>(guildId: string, operation: () => Promise<T>): Promise<T> => {
  const pending = (messageTails.get(guildId) ?? Promise.resolve()).catch(() => undefined).then(operation);
  messageTails.set(guildId, pending);
  try {
    return await pending;
  } finally {
    if (messageTails.get(guildId) === pending) {
      messageTails.delete(guildId);
    }
  }
};

const isPermanentMessageError = (error: unknown) => (
  typeof error === 'object' && error !== null && 'code' in error
  && [10008, 50001, 50013].includes(Number(error.code))
);

const formatActivityTime = (seconds: number) => {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};

export const buildPlaybackActivity = (player: Player) => {
  const current = player.getCurrent();
  if (!current) {
    return undefined;
  }

  if (current.isLive) {
    return `LIVE • ${current.title}`.slice(0, 120);
  }

  const duration = Math.max(0, Math.floor(current.length));
  const position = Math.min(
    duration,
    Math.floor(Math.max(0, player.getPosition()) / ACTIVITY_TIME_STEP_SECONDS)
      * ACTIVITY_TIME_STEP_SECONDS,
  );
  const time = `${formatActivityTime(position)}/${formatActivityTime(duration)}`;
  const availableTitleLength = Math.max(0, 120 - time.length - 3);
  return `${time} • ${current.title.slice(0, availableTitleLength)}`;
};

const updateBotActivity = (message: Message, player?: Player) => {
  const activity = (player ? buildPlaybackActivity(player) : undefined)
    ?? process.env.BOT_ACTIVITY
    ?? 'musikk med gjengen';

  if (activity !== currentBotActivity) {
    message.client.user?.setActivity(activity, {type: ActivityType.Listening});
    currentBotActivity = activity;
  }
};

export const resetPlaybackActivity = (message: Message) => {
  updateBotActivity(message);
};
const afterpartyButton=(player:Player)=>{
  if(!process.env.PUBLIC_SITE_URL||player.guildId!==process.env.DISCORD_GUILD_ID)return [];
  try{const url=new URL('/?room=DISCORD1',process.env.PUBLIC_SITE_URL);if(url.protocol!=='https:'||!url.hostname.endsWith('.chatgpt.site'))return [];return [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Se video · Afterparty').setURL(url.href)];}catch{return [];}
};

export const buildPlaybackComponents = (player: Player) => ([
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(PLAYBACK_BUTTON_IDS.pauseResume)
      .setEmoji(player.status === STATUS.PLAYING ? '⏸️' : '▶️')
      .setLabel(player.status === STATUS.PLAYING ? 'Pause' : 'Fortsett')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(PLAYBACK_BUTTON_IDS.skip)
      .setEmoji('⏭️')
      .setLabel('Hopp over')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(PLAYBACK_BUTTON_IDS.stop)
      .setEmoji('⏹️')
      .setLabel('Stopp')
      .setStyle(ButtonStyle.Danger),
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(PLAYBACK_BUTTON_IDS.loop)
      .setEmoji('🔁')
      .setLabel('Gjenta')
      .setStyle(player.loopCurrentSong ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(PLAYBACK_BUTTON_IDS.shuffle)
      .setEmoji('🔀')
      .setLabel('Bland kø')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(PLAYBACK_BUTTON_IDS.favorite)
      .setEmoji('⭐')
      .setLabel('Lagre favoritt')
      .setStyle(ButtonStyle.Secondary),
    ...afterpartyButton(player),
  ),
] as unknown as NonNullable<MessageCreateOptions['components']>);

export const buildPlaybackMessage = (player: Player) => ({
  embeds: [buildPlayingMessageEmbed(player)],
  components: buildPlaybackComponents(player),
});

export const stopPlaybackMessageTracking = (guildId: string) => {
  const tracked = trackedMessages.get(guildId);
  if (tracked) {
    clearInterval(tracked.timer);
    trackedMessages.delete(guildId);
  }
};

export const trackPlaybackMessage = (message: Message, player: Player) => {
  stopPlaybackMessageTracking(player.guildId);
  updateBotActivity(message, player);

  let updating = false;
  const timer = setInterval(() => {
    if (updating || messageTails.has(player.guildId)) {
      return;
    }
    const tracked = trackedMessages.get(player.guildId);
    if (!tracked || tracked.message.id !== message.id) {
      return;
    }

    if (!player.getCurrent() || !player.voiceConnection) {
      stopPlaybackMessageTracking(player.guildId);
      updateBotActivity(message);
      void message.edit({
        content: '⏹️ Avspelinga er ferdig.',
        embeds: [],
        components: [],
      }).catch(() => undefined);
      return;
    }

    updateBotActivity(message, player);
    updating = true;
    void serializeMessage(player.guildId, () => message.edit(buildPlaybackMessage(player)))
      .catch(error => {
        if (isPermanentMessageError(error)
          && trackedMessages.get(player.guildId)?.message.id === message.id) {
          stopPlaybackMessageTracking(player.guildId);
        }
      })
      .finally(() => { updating = false; });
  }, UPDATE_INTERVAL_MS);

  timer.unref();
  trackedMessages.set(player.guildId, {message, timer});
};

const getMusicChannel = (guild: Guild) => {
  const configuredId = process.env.MUSIC_TEXT_CHANNEL_ID?.trim();
  const configuredChannel = configuredId ? guild.channels.cache.get(configuredId) : undefined;
  const namedChannel = guild.channels.cache.find(channel => (
    channel.type === ChannelType.GuildText && channel.name.toLowerCase() === 'musikk'
  ));
  const channel = configuredChannel ?? namedChannel;

  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error('fant ikke tekstkanalen #musikk');
  }

  return channel;
};

export const publishMusicNotice = async (guild: Guild, content: string) => (
  getMusicChannel(guild).send({content: content.slice(0, 1900), allowedMentions: {parse: []}})
);

export const publishPlaybackMessage = async (guild: Guild, player: Player) => serializeMessage(guild.id, async () => {
  const channel = getMusicChannel(guild);
  const existing = trackedMessages.get(guild.id);
  let message: Message;

  if (existing && existing.message.channelId === channel.id) {
    try {
      message = await existing.message.edit(buildPlaybackMessage(player));
    } catch (error: unknown) {
      if (typeof error !== 'object' || error === null || !('code' in error) || Number(error.code) !== 10008) {
        throw error;
      }
      stopPlaybackMessageTracking(guild.id);
      message = await channel.send(buildPlaybackMessage(player));
    }
  } else {
    message = await channel.send(buildPlaybackMessage(player));
  }

  trackPlaybackMessage(message, player);
  return message;
});
