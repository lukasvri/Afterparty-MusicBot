import {ButtonInteraction, ChatInputCommandInteraction, GuildMember, User} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {MediaSource, STATUS} from '../services/player.js';
import {getMemberVoiceChannel, isUserInVoice} from '../utils/channels.js';
import {prisma} from '../utils/db.js';
import {
  buildPlaybackMessage,
  PLAYBACK_BUTTON_IDS,
  publishPlaybackMessage,
  resetPlaybackActivity,
  stopPlaybackMessageTracking,
  trackPlaybackMessage,
} from '../utils/playback-message.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('now-playing')
    .setDescription('shows the currently played song');

  public readonly handledButtonIds = Object.values(PLAYBACK_BUTTON_IDS);

  constructor(@inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager) {}

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (!player.getCurrent()) {
      throw new Error('nothing is currently playing');
    }

    await interaction.deferReply({ephemeral: true});
    const message = await publishPlaybackMessage(interaction.guild!, player);
    await interaction.editReply(`Spilleren er oppdatert i <#${message.channelId}>.`);
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !interaction.member
      || !isUserInVoice(interaction.guild, interaction.member.user as User)) {
      throw new Error('gotta be in a voice channel');
    }

    const player = this.playerManager.get(interaction.guild.id);

    const memberVoice = getMemberVoiceChannel(interaction.member as GuildMember);
    const botVoiceChannelId = player.voiceConnection?.joinConfig.channelId;
    if (botVoiceChannelId && memberVoice?.[0].id !== botVoiceChannelId) {
      throw new Error('Du må vere i same talekanal som boten.');
    }
    if (!player.getCurrent()) {
      throw new Error('Ingen sang spiller nå.');
    }

    if (interaction.customId === PLAYBACK_BUTTON_IDS.skip && player.queueSize() === 0) {
      throw new Error('no song to skip to');
    }

    if (interaction.customId === PLAYBACK_BUTTON_IDS.shuffle && player.isQueueEmpty()) {
      throw new Error('not enough songs to shuffle');
    }

    if (interaction.customId === PLAYBACK_BUTTON_IDS.stop && !player.voiceConnection) {
      throw new Error('not connected');
    }

    if (interaction.customId === PLAYBACK_BUTTON_IDS.pauseResume && !player.getCurrent()) {
      throw new Error('nothing to play');
    }

    await interaction.deferUpdate();

    if (interaction.customId === PLAYBACK_BUTTON_IDS.pauseResume) {
      if (player.status === STATUS.PLAYING) {
        player.pause();
      } else {
        if (!player.voiceConnection) {
          const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember)!;
          await player.connect(targetVoiceChannel);
        }

        await player.play();
      }
    } else if (interaction.customId === PLAYBACK_BUTTON_IDS.skip) {
      await player.forward(1);
    } else if (interaction.customId === PLAYBACK_BUTTON_IDS.loop) {
      if (player.loopCurrentQueue) {
        player.loopCurrentQueue = false;
      }

      player.loopCurrentSong = !player.loopCurrentSong;
    } else if (interaction.customId === PLAYBACK_BUTTON_IDS.shuffle) {
      player.shuffle();
    } else if (interaction.customId === PLAYBACK_BUTTON_IDS.favorite) {
      const current = player.getCurrent()!;
      const name = current.title.slice(0, 90);
      const query = current.source === MediaSource.Youtube
        ? `https://www.youtube.com/watch?v=${current.url}`
        : current.url;
      const existing = await prisma.favoriteQuery.findFirst({
        where: {guildId: interaction.guild.id, name},
      });

      if (existing) {
        await interaction.followUp({content: `⭐ **${name}** er allereie lagra.`, ephemeral: true});
      } else {
        await prisma.favoriteQuery.create({
          data: {
            authorId: interaction.user.id,
            guildId: interaction.guild.id,
            name,
            query,
          },
        });
        await interaction.followUp({content: `⭐ Lagra **${name}** som favoritt.`, ephemeral: true});
      }
    } else if (interaction.customId === PLAYBACK_BUTTON_IDS.stop) {
      player.stop();
      stopPlaybackMessageTracking(interaction.guild.id);
      resetPlaybackActivity(interaction.message);
      await interaction.editReply({
        content: '⏹️ Avspelinga er stoppa.',
        embeds: [],
        components: [],
      });
      return;
    }

    await interaction.editReply(buildPlaybackMessage(player));
    const message = await interaction.fetchReply();
    trackPlaybackMessage(message, player);
  }
}
