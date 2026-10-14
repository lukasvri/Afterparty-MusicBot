import {ChatInputCommandInteraction, GuildMember} from 'discord.js';
import {inject, injectable} from 'inversify';
import shuffle from 'array-shuffle';
import {TYPES} from '../types.js';
import GetSongs from '../services/get-songs.js';
import {MediaSource, SongMetadata, STATUS} from './player.js';
import PlayerManager from '../managers/player.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {publishMusicNotice, publishPlaybackMessage} from '../utils/playback-message.js';
import {SponsorBlock} from 'sponsorblock-api';
import Config from './config.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {ONE_HOUR_IN_SECONDS} from '../utils/constants.js';
import {areSameSong} from '../utils/song-identity.js';

const isSameQueueEntry = (capturedId: number | null, currentId: number | null) => (
  capturedId !== null && capturedId === currentId
);

const normalizeSkipError = (error: unknown) => (
  error instanceof Error && error.message === 'No songs in queue to forward to.'
    ? new Error('no song to skip to')
    : error
);

@injectable()
export default class AddQueryToQueue {
  private readonly sponsorBlock?: SponsorBlock;
  private sponsorBlockDisabledUntil?: Date;
  private readonly sponsorBlockTimeoutDelay;
  private readonly cache: KeyValueCacheProvider;

  constructor(@inject(TYPES.Services.GetSongs) private readonly getSongs: GetSongs,
    @inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager,
    @inject(TYPES.Config) private readonly config: Config,
    @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider) {
    this.sponsorBlockTimeoutDelay = config.SPONSORBLOCK_TIMEOUT;
    this.sponsorBlock = config.ENABLE_SPONSORBLOCK
      ? new SponsorBlock('muse-sb-integration')
      : undefined;
    this.cache = cache;
  }

  public async addToQueue({
    query,
    addToFrontOfQueue,
    shuffleAdditions,
    shouldSplitChapters,
    skipCurrentTrack,
    interaction,
  }: {
    query: string;
    addToFrontOfQueue: boolean;
    shuffleAdditions: boolean;
    shouldSplitChapters: boolean;
    skipCurrentTrack: boolean;
    interaction: ChatInputCommandInteraction;
  }): Promise<void> {
    const guildId = interaction.guild!.id;
    const player = this.playerManager.get(guildId);
    const currentQueueEntryId = player.getCurrentQueueEntryId();
    const wasPlayingSong = currentQueueEntryId !== null;

    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember)
      ?? getMostPopularVoiceChannel(interaction.guild!);

    const {playlistLimit} = await getGuildSettings(guildId);

    // Keep the command response private. The shared player is published in #musikk.
    await interaction.deferReply({ephemeral: true});

    let [newSongs, extraMsg] = await this.getSongs.getSongs(query, playlistLimit, shouldSplitChapters);

    if (newSongs.length === 0) {
      throw new Error('no songs found');
    }

    if (shuffleAdditions) {
      newSongs = shuffle(newSongs);
    }

    if (this.config.ENABLE_SPONSORBLOCK) {
      newSongs = await Promise.all(newSongs.map(song => this.skipNonMusicSegments({...song})));
    }

    const needsConnection = player.voiceConnection === null;
    if (needsConnection) {
      await player.connect(targetVoiceChannel);
    } else {
      await player.ensureVoiceConnectionReady();
    }

    const existingSongs = [...player.getQueue()];
    const currentSong = player.getCurrent();
    if (currentSong) {
      existingSongs.push(currentSong);
    }
    const uniqueSongs: SongMetadata[] = [];
    let skippedDuplicates = 0;
    for (const song of newSongs) {
      if (existingSongs.some(existing => areSameSong(song, existing))
        || uniqueSongs.some(existing => areSameSong(song, existing))) {
        skippedDuplicates++;
      } else {
        uniqueSongs.push(song);
      }
    }

    newSongs = uniqueSongs;
    if (newSongs.length === 0) {
      await interaction.editReply('Sangen finnes allerede i spilleren eller køen.');
      return;
    }

    if (skippedDuplicates > 0) {
      const duplicateMsg = `${skippedDuplicates} duplikat${skippedDuplicates === 1 ? '' : 'er'} hoppet over`;
      extraMsg = extraMsg === '' ? duplicateMsg : `${extraMsg}, ${duplicateMsg}`;
    }

    newSongs.forEach((song, index) => {
      player.add({
        ...song,
        addedInChannelId: process.env.MUSIC_TEXT_CHANNEL_ID?.trim() || interaction.channel!.id,
        requestedBy: interaction.member!.user.id,
      }, {
        immediate: addToFrontOfQueue ?? false,
        immediateOffset: index,
      });
    });

    const firstSong = newSongs[0];
    let statusMsg = '';
    let shouldPublishPlayer = false;

    if (needsConnection) {
      await player.play();

      if (wasPlayingSong) {
        statusMsg = 'held fram med avspelinga';
      }

      shouldPublishPlayer = true;
    } else if (player.status === STATUS.IDLE) {
      await player.play();
      shouldPublishPlayer = true;
    }

    if (!player.getCurrent()) {
      throw new Error('no playable songs found');
    }

    let didSkipCurrentTrack = false;
    if (skipCurrentTrack && isSameQueueEntry(currentQueueEntryId, player.getCurrentQueueEntryId())) {
      try {
        await player.forward(1);
        didSkipCurrentTrack = true;
        shouldPublishPlayer = true;
      } catch (error: unknown) {
        throw normalizeSkipError(error);
      }
    }

    if (statusMsg !== '') {
      if (extraMsg === '') {
        extraMsg = statusMsg;
      } else {
        extraMsg = `${statusMsg}, ${extraMsg}`;
      }
    }

    if (extraMsg !== '') {
      extraMsg = ` (${extraMsg})`;
    }

    const title = firstSong.title.replace(/[*_`~]/g, '').slice(0, 300);
    const reply = newSongs.length === 1
      ? `Lagt til **${title}** ${addToFrontOfQueue ? 'fremst i' : 'i'} køen${didSkipCurrentTrack ? ', og hoppa over førre song' : ''}${extraMsg}`
      : `Lagt til **${title}** og ${newSongs.length - 1} andre songar i køen${didSkipCurrentTrack ? ', og hoppa over førre song' : ''}${extraMsg}`;

    try {
      await publishMusicNotice(interaction.guild!, reply);
      if (shouldPublishPlayer) {
        await publishPlaybackMessage(interaction.guild!, player);
      }
      await interaction.deleteReply();
    } catch {
      // The music request succeeded. A notification failure must not invite a retry.
      await interaction.editReply(`${reply}\nKlarte ikkje å oppdatere meldinga i #musikk.`);
    }
  }

  private async skipNonMusicSegments(song: SongMetadata) {
    if (!this.sponsorBlock
      || (this.sponsorBlockDisabledUntil && new Date() < this.sponsorBlockDisabledUntil)
      || song.source !== MediaSource.Youtube
      || !song.url) {
      return song;
    }

    try {
      const segments = await this.cache.wrap(
        async () => this.sponsorBlock?.getSegments(song.url, ['music_offtopic']),
        {
          key: `sponsorblock:${song.url}`,
          expiresIn: ONE_HOUR_IN_SECONDS,
        },
      ) ?? [];
      const originalStart = song.offset;
      const originalEnd = song.offset + song.length;
      const skipSegments = segments
        .filter(({startTime, endTime}) => endTime > originalStart && startTime < originalEnd)
        .sort((a, b) => a.startTime - b.startTime)
        .reduce((acc: Array<{startTime: number; endTime: number}>, {startTime, endTime}) => {
          const previousSegment = acc[acc.length - 1];
          // If segments overlap merge
          if (previousSegment && previousSegment.endTime > startTime) {
            acc[acc.length - 1].endTime = Math.max(previousSegment.endTime, endTime);
          } else {
            acc.push({startTime, endTime});
          }

          return acc;
        }, []);

      const intro = skipSegments[0];
      const outro = skipSegments.at(-1);
      // SponsorBlock timestamps refer to the full source, including when this
      // queue entry is only a chapter. Clamp both trims to that entry's interval.
      const start = intro && intro.startTime <= originalStart + 2
        ? Math.min(originalEnd, Math.max(originalStart, Math.floor(intro.endTime)))
        : originalStart;
      const end = outro && outro.endTime >= originalEnd - 2
        ? Math.max(start, Math.min(originalEnd, outro.startTime))
        : originalEnd;
      song.offset = start;
      song.length = Math.max(0, end - start);

      return song;
    } catch (e) {
      if (!(e instanceof Error)) {
        console.error('Unexpected event occurred while fetching skip segments : ', e);
        return song;
      }

      if (!e.message.includes('404')) {
        console.warn(`Could not fetch skip segments for "${song.url}" :`, e);
      }

      if (e.message.includes('504')) {
        this.sponsorBlockDisabledUntil = new Date(new Date().getTime() + (this.sponsorBlockTimeoutDelay * 60_000));
      }

      return song;
    }
  }
}
