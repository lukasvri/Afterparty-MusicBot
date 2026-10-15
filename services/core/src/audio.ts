import { Readable } from "node:stream";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import prism from "prism-media";
import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  type AudioResource,
  type AudioPlayer,
} from "@discordjs/voice";
import type { Track } from "./types.ts";
export const DECODER_TIMEOUT_MS = 6000;
export const FRAME_MS = 20,
  FRAME_SAMPLES = 960,
  FRAME_BYTES = 3840;
/** Respect the voice channel ceiling without forcing every server down to 96 kbit/s. */
export function audioBitrate(channel: number, requestedKbps: number) {
  const ceiling = Number.isFinite(channel) && channel >= 8000 ? channel : 64000;
  const requested =
    Number.isFinite(requestedKbps) && requestedKbps >= 64
      ? requestedKbps * 1000
      : 192000;
  return Math.max(8000, Math.min(384000, ceiling, requested));
}
export function ffmpegReason(chunk: Buffer | string) {
  const text = String(chunk).slice(0, 4096).toLowerCase();
  return /timed out|connection|network|http error/.test(text)
    ? "network"
    : /invalid data|invalid argument|codec|decoder/.test(text)
      ? "format"
      : /no such file|not found/.test(text)
        ? "unavailable"
        : "unknown";
}
export class PcmDecoder {
  stderrReason = "unknown";
  child: ChildProcessWithoutNullStreams;
  ended = false;
  error: Error | null = null;
  disposed = false;
  pending = Buffer.alloc(0);
  iterator: AsyncIterator<Buffer>;
  closed: Promise<void>;
  constructor(
    source: { url: string; headers: string },
    offset: number,
    signal: AbortSignal,
    ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg",
  ) {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      ...(/^https?:/.test(source.url)
        ? [
            "-reconnect",
            "1",
            "-reconnect_streamed",
            "1",
            "-reconnect_delay_max",
            "2",
          ]
        : []),
      ...(source.headers ? ["-headers", source.headers] : []),
      ...(offset > 0 ? ["-ss", String(offset)] : []),
      "-i",
      source.url,
      "-vn",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-f",
      "s16le",
      "pipe:1",
    ];
    this.child = spawn(ffmpeg, args, {
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });
    this.iterator = this.child.stdout[Symbol.asyncIterator]();
    this.child.stdin.end();
    this.child.stderr.on("data", (chunk) => {
      this.stderrReason = ffmpegReason(chunk);
    });
    this.child.on("error", (e) => {
      this.error = e;
      this.child.stdout.destroy(e);
    });
    this.closed = new Promise((resolve) =>
      this.child.once("close", (code) => {
        if (code !== 0 && !this.disposed)
          this.error ??= new Error(
            "Lyddekodingen stoppet (" + this.stderrReason + ").",
          );
        resolve();
      }),
    );
    this.child.stdout.on("error", () => {});
  }
  async frame(): Promise<Buffer | null> {
    while (this.pending.length < FRAME_BYTES && !this.ended) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (this.error) throw this.error;
        const next = await Promise.race([
          (async () => {
            const next = await this.iterator.next();
            // EOF alone cannot distinguish a successful decode from a subprocess crash.
            if (next.done) {
              await this.closed;
              if (this.error) throw this.error;
            }
            return next;
          })(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Lydstrømmen sluttet å levere data.")),
              DECODER_TIMEOUT_MS,
            );
          }),
        ]);
        if (next.done) this.ended = true;
        else this.pending = Buffer.concat([this.pending, next.value]);
      } catch (error) {
        this.stop();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    if (!this.pending.length) return null;
    const frame = this.pending.subarray(0, FRAME_BYTES);
    this.pending = this.pending.subarray(FRAME_BYTES);
    return frame.length === FRAME_BYTES ? frame : pad(frame);
  }
  stop() {
    this.disposed = true;
    this.child.stdout.destroy();
    this.child.kill("SIGKILL");
  }
}
function pad(data: Buffer) {
  const b = Buffer.alloc(FRAME_BYTES);
  data.copy(b, 0, 0, FRAME_BYTES);
  return b;
}
export function mixPcm(
  a: Buffer,
  b: Buffer | null,
  progress: number,
  volume: number,
) {
  const out = Buffer.allocUnsafe(FRAME_BYTES),
    gain = Math.max(0, Math.min(1, volume / 100)),
    fade = Math.max(0, Math.min(1, progress));
  for (let i = 0; i < FRAME_BYTES; i += 2) {
    const sample =
      (a.readInt16LE(i) * (b ? 1 - fade : 1) +
        (b ? b.readInt16LE(i) * fade : 0)) *
      gain;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i);
  }
  return out;
}
export type Prepared = { track: Track; decoder: PcmDecoder };
type MixerOptions = {
  first: Prepared;
  offset: number;
  volume: () => number;
  crossfade: () => number;
  next: (from: Track) => Promise<Prepared | null>;
  onSegment: (track: Track, startFrame: number, offset: number) => void;
  bitrate: number;
  onDiagnostic?: (reason: "crossfade-unavailable") => void;
};
export class Mixer extends Readable {
  mainFrames: Buffer[] = [];
  nextFrames: Buffer[] = [];
  nextRead: Promise<void> | null = null;
  nextFailed = false;
  options: MixerOptions;
  main: Prepared;
  offset: number;
  frameIndex = 0;
  trackFrame = 0;
  nextPrepared: Prepared | null = null;
  preparing: Promise<void> | null = null;
  endedPreparation = false;
  preparationGeneration = 0;
  fadeFrame = 0;
  fadeLength = 0;
  reading = false;
  disposed = false;
  lastError: Error | null = null;
  constructor(options: MixerOptions) {
    super({ highWaterMark: FRAME_BYTES * 6 });
    this.options = options;
    this.main = options.first;
    this.offset = options.offset;
    options.onSegment(this.main.track, 0, this.offset);
  }
  prepare() {
    if (this.preparing || this.nextPrepared || this.endedPreparation) return;
    const generation = this.preparationGeneration;
    this.preparing = this.options
      .next(this.main.track)
      .then((p) => {
        if (this.disposed || generation !== this.preparationGeneration) {
          p?.decoder.stop();
          return;
        }
        this.nextPrepared = p;
        this.endedPreparation = !p;
        if (p) this.bufferNext();
      })
      .catch(() => {
        if (generation === this.preparationGeneration)
          this.endedPreparation = true;
      })
      .finally(() => {
        this.preparing = null;
      });
  }
  bufferNext() {
    if (!this.nextPrepared || this.nextRead || this.nextFailed) return;
    const prepared = this.nextPrepared,
      generation = this.preparationGeneration;
    // At most 12 seconds of stereo PCM, 2.3 MiB. A fade never waits for I/O.
    const frames = Math.min(
      600,
      Math.max(1, Math.round(this.options.crossfade() * 50)),
    );
    this.nextRead = (async () => {
      try {
        while (this.nextFrames.length < frames) {
          const frame = await prepared.decoder.frame();
          if (this.disposed || generation !== this.preparationGeneration)
            return;
          if (!frame) break;
          this.nextFrames.push(frame);
        }
      } catch {
        if (generation === this.preparationGeneration && !this.disposed) {
          this.nextFailed = true;
          prepared.decoder.stop();
          this.options.onDiagnostic?.("crossfade-unavailable");
        }
      }
    })().finally(() => {
      if (generation === this.preparationGeneration) this.nextRead = null;
    });
  }
  invalidateNext() {
    if (this.fadeFrame) return;
    this.preparationGeneration++;
    this.nextPrepared?.decoder.stop();
    this.nextPrepared = null;
    this.nextFrames = [];
    this.nextRead = null;
    this.nextFailed = false;
    this.endedPreparation = false;
  }
  _read() {
    if (this.reading || this.disposed) return;
    this.reading = true;
    void this.produce()
      .then((packet) => {
        this.reading = false;
        if (!this.disposed) this.push(packet);
      })
      .catch((error) => {
        this.reading = false;
        this.destroy(error);
      });
  }
  async produce(): Promise<Buffer | null> {
    const remaining =
      this.main.track.duration - this.offset - this.trackFrame / 50;
    const fadeSeconds = this.main.track.live
      ? 0
      : Math.min(
          this.options.crossfade(),
          Math.max(0, (this.main.track.duration - this.offset) / 4),
        );
    if (remaining < fadeSeconds + 20 && !this.main.track.live) this.prepare();
    let a = this.mainFrames.shift() ?? (await this.main.decoder.frame());
    if (!a) {
      if (this.preparing) await this.preparing;
      if (!this.nextPrepared) {
        this.prepare();
        if (this.preparing) await this.preparing;
      }
      if (this.nextRead) await this.nextRead;
      if (!this.nextPrepared || this.nextFailed) return null;
      this.main.decoder.stop();
      this.main = this.nextPrepared;
      this.nextPrepared = null;
      this.mainFrames = this.nextFrames;
      this.nextFrames = [];
      this.offset = this.main.track.offset ?? 0;
      this.trackFrame = 0;
      this.fadeFrame = 0;
      this.endedPreparation = false;
      this.options.onSegment(this.main.track, this.frameIndex, this.offset);
      a = this.mainFrames.shift() ?? (await this.main.decoder.frame());
      if (!a) return null;
    }
    let b: Buffer | null = null;
    if (
      !this.fadeFrame &&
      this.nextPrepared &&
      !this.nextRead &&
      !this.nextFailed &&
      this.nextFrames.length >= Math.round(fadeSeconds * 50) &&
      fadeSeconds > 0 &&
      remaining <= fadeSeconds &&
      !this.nextPrepared.track.live &&
      this.nextPrepared.track.duration > fadeSeconds * 3
    ) {
      this.fadeFrame = 1;
      this.fadeLength = Math.max(1, Math.round(fadeSeconds * 50));
      this.options.onSegment(
        this.nextPrepared.track,
        this.frameIndex,
        this.nextPrepared.track.offset ?? 0,
      );
    }
    const progress = this.fadeFrame ? this.fadeFrame / this.fadeLength : 0;
    if (this.fadeFrame && this.nextPrepared) {
      b = this.nextFrames.shift()!;
    }
    const packet = mixPcm(a, b, progress, this.options.volume());
    this.frameIndex++;
    this.trackFrame++;
    if (this.fadeFrame) {
      this.fadeFrame++;
      if (this.fadeFrame > this.fadeLength) {
        this.main.decoder.stop();
        this.main = this.nextPrepared!;
        this.nextPrepared = null;
        this.mainFrames = this.nextFrames;
        this.nextFrames = [];
        this.offset = this.main.track.offset ?? 0;
        this.trackFrame = this.fadeLength;
        this.fadeFrame = 0;
        this.endedPreparation = false;
      }
    }
    return packet;
  }
  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.disposed = true;
    this.preparationGeneration++;
    this.main.decoder.stop();
    this.nextPrepared?.decoder.stop();
    callback(error);
  }
}
export function encodeOpus(mixer: Mixer, bitrate: number) {
  const process = spawn(
    processEnvFfmpeg(),
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-probesize",
      "32",
      "-analyzeduration",
      "0",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-i",
      "pipe:0",
      "-c:a",
      "libopus",
      "-b:a",
      String(bitrate),
      "-application",
      "audio",
      "-compression_level",
      "10",
      "-vbr",
      "on",
      "-frame_duration",
      "20",
      "-page_duration",
      "20000",
      "-flush_packets",
      "1",
      "-f",
      "opus",
      "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const stream = new prism.opus.OggDemuxer();
  let stderrReason = "unknown";
  process.stderr.on("data", (chunk) => {
    stderrReason = ffmpegReason(chunk);
  });
  process.on("error", () =>
    stream.destroy(new Error("Lydkodingen kunne ikke startes.")),
  );
  // stdout can end before the exit status arrives. Only a successful exit is EOF.
  process.on("close", (code) => {
    if (!stream.destroyed) {
      if (code === 0) stream.end();
      else
        stream.destroy(
          new Error("Lydkodingen stoppet (" + stderrReason + ")."),
        );
    }
  });
  process.stdin.on("error", () => {});
  process.stdout.on("error", (error) => stream.destroy(error));
  mixer.on("error", (error) => stream.destroy(error));
  mixer.once("close", () => {
    if (!mixer.readableEnded) stream.destroy();
  });
  mixer.pipe(process.stdin);
  process.stdout.pipe(stream, { end: false });
  stream.once("close", () => {
    mixer.unpipe(process.stdin);
    mixer.destroy();
    process.stdin.destroy();
    process.stdout.destroy();
    process.kill("SIGKILL");
  });
  return { stream, process };
}
function processEnvFfmpeg() {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}
export interface Sink {
  diagnostics?(): { missedFrames: number; maxConsecutiveMissedFrames: number };
  play(stream: Readable, id: string): void;
  pause(): void;
  resume(): void;
  stop(): void;
  duration(): number;
  advancing(): boolean;
  buffering(): boolean;
  onIdle: ((id: string) => void) | null;
  onError: ((error: Error, id: string) => void) | null;
}
export class DiscordSink implements Sink {
  missedFrames = 0;
  maxConsecutiveMissedFrames = 0;
  lastMissing = 0;
  stopping = false;
  sourceEnded = false;
  wantedPause = false;
  lastDuration = 0;
  lastAdvance = performance.now();
  player: AudioPlayer;
  resource: AudioResource<{ id: string }> | null = null;
  onIdle: ((id: string) => void) | null = null;
  onError: ((error: Error, id: string) => void) | null = null;
  constructor() {
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
        maxMissedFrames: Math.ceil((DECODER_TIMEOUT_MS + 1000) / FRAME_MS),
      },
    });
    this.player.on("stateChange", (before, after) => {
      if (after.status === AudioPlayerStatus.Playing && this.wantedPause)
        this.player.pause(true);
      if (
        after.status === AudioPlayerStatus.Idle &&
        before.status !== AudioPlayerStatus.Idle &&
        "resource" in before
      ) {
        const id = (before.resource.metadata as { id: string }).id;
        if (!this.stopping) {
          if (this.sourceEnded) this.onIdle?.(id);
          else this.onError?.(new Error("stream-stall"), id);
        }
      }
    });
    this.player.on("error", (error) =>
      this.onError?.(error, (error.resource.metadata as { id: string }).id),
    );
  }
  diagnostics() {
    return {
      missedFrames: this.missedFrames,
      maxConsecutiveMissedFrames: this.maxConsecutiveMissedFrames,
    };
  }

  play(stream: Readable, id: string) {
    this.sourceEnded = false;
    this.lastDuration = 0;
    this.lastAdvance = performance.now();
    stream.once("end", () => {
      if (this.resource?.metadata.id === id) this.sourceEnded = true;
    });
    this.resource = createAudioResource(stream, {
      inputType: StreamType.Opus,
      metadata: { id },
      silencePaddingFrames: 0,
    });
    const resource = this.resource,
      read = resource.read.bind(resource);
    this.lastMissing = 0;
    resource.read = () => {
      const packet = read();
      if (packet) this.lastMissing = 0;
      else if (!this.sourceEnded && !this.wantedPause) {
        this.missedFrames++;
        this.lastMissing++;
        this.maxConsecutiveMissedFrames = Math.max(
          this.maxConsecutiveMissedFrames,
          this.lastMissing,
        );
      }
      return packet;
    };
    this.player.play(resource);
  }
  pause() {
    this.wantedPause = true;
    this.player.pause(true);
  }
  resume() {
    this.wantedPause = false;
    this.player.unpause();
  }
  stop() {
    this.wantedPause = false;
    this.stopping = true;
    this.player.stop(true);
    this.stopping = false;
    this.resource = null;
    this.lastDuration = 0;
  }
  duration() {
    const duration = this.resource?.playbackDuration ?? 0;
    if (duration !== this.lastDuration) {
      this.lastDuration = duration;
      this.lastAdvance = performance.now();
    }
    return duration;
  }
  advancing() {
    this.duration();
    return (
      this.player.state.status === AudioPlayerStatus.Playing &&
      performance.now() - this.lastAdvance < 120
    );
  }
  buffering() {
    return (
      !this.wantedPause &&
      (this.player.state.status === AudioPlayerStatus.Buffering ||
        this.player.state.status === AudioPlayerStatus.AutoPaused ||
        (this.player.state.status === AudioPlayerStatus.Playing &&
          !this.advancing()))
    );
  }
}
