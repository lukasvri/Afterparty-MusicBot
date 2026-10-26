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
  pending: Buffer = Buffer.alloc(0);
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
            "Audio decoding stopped (" + this.stderrReason + ").",
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
              () => reject(new Error("The audio stream stopped delivering data.")),
              DECODER_TIMEOUT_MS,
            );
          }),
        ]);
        if (next.done) this.ended = true;
        else
          this.pending = this.pending.length
            ? Buffer.concat([this.pending, next.value])
            : next.value;
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
/** Frames are immutable downstream. Unity gain needs neither a copy nor a sample loop. */
export function mixPcm(
  a: Buffer,
  b: Buffer | null,
  progress: number,
  volume: number,
) {
  const gain = Math.max(0, Math.min(1, volume / 100)),
    fade = Math.max(0, Math.min(1, progress));
  if (!b && gain === 1) return a;
  if (gain === 0) return Buffer.alloc(FRAME_BYTES);
  const out = Buffer.allocUnsafe(FRAME_BYTES);
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
  private nextReady: Promise<void> | null = null;
  private nextReadError: Error | null = null;
  private mainRead: Promise<void> | null = null;
  private mainReadError: Error | null = null;
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
    if (this.disposed || this.preparing || this.nextPrepared || this.endedPreparation) return;
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
  private fadeSeconds() {
    if (this.main.track.live) return 0;
    const configured = this.options.crossfade(),
      available = Math.max(0, this.main.track.duration - this.offset);
    // Honor the configured overlap whenever the remaining source can cover it.
    // Preserve the conservative short-tail fallback when it cannot.
    return available >= configured ? configured : available / 4;
  }
  bufferNext() {
    if (this.disposed || !this.nextPrepared || this.nextRead || this.nextFailed) return;
    const prepared = this.nextPrepared,
      generation = this.preparationGeneration,
      buffered = this.nextFrames;
    // Keep the original bounded reservoir after fade readiness. Short tails may
    // start fading as soon as enough frames are ready without losing jitter cover.
    const frames = Math.min(
      600,
      Math.max(1, Math.round(this.options.crossfade() * 50)),
    );
    let ready!: () => void;
    this.nextReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const owned = () =>
      !this.disposed &&
      (this.main === prepared ||
        (generation === this.preparationGeneration && this.nextPrepared === prepared));
    const task = (async () => {
      try {
        while (
          this.nextPrepared === prepared &&
          generation === this.preparationGeneration &&
          buffered.length < frames
        ) {
          const frame = await prepared.decoder.frame();
          if (!owned()) return;
          if (!frame) break;
          // Capture the queue: promotion transfers this same array to mainFrames.
          // An in-flight read then appends exactly once before this pump retires.
          buffered.push(frame);
          ready();
        }
      } catch (cause) {
        if (owned()) {
          const error = cause instanceof Error
            ? cause
            : new Error("Audio decoding stopped.");
          prepared.decoder.stop();
          if (this.main === prepared) this.mainReadError = error;
          else {
            this.nextFailed = true;
            this.nextReadError = error;
            this.options.onDiagnostic?.("crossfade-unavailable");
          }
        }
      }
    })().finally(() => {
      ready();
      if (this.nextRead === task) this.nextRead = null;
      if (this.mainRead === task) this.mainRead = null;
    });
    this.nextRead = task;
  }
  private async readMainFrame(): Promise<Buffer | null> {
    if (this.disposed) return null;
    const buffered = this.mainFrames.shift();
    if (buffered) return buffered;
    // A promoted source can still have one prefetch read in flight. Never race
    // that read with a second decoder.frame() call or discard its resulting frame.
    if (this.mainRead) await this.mainRead;
    if (this.disposed) return null;
    if (this.mainReadError) throw this.mainReadError;
    return this.mainFrames.shift() ?? (await this.main.decoder.frame());
  }
  private promoteNext(consumedFrames: number) {
    this.main.decoder.stop();
    this.main = this.nextPrepared!;
    this.mainFrames = this.nextFrames;
    this.mainRead = this.nextRead;
    this.mainReadError = this.nextReadError;
    this.nextPrepared = null;
    this.nextFrames = [];
    this.nextRead = null;
    this.nextReady = null;
    this.nextReadError = null;
    this.nextFailed = false;
    this.offset = this.main.track.offset ?? 0;
    this.trackFrame = consumedFrames;
    this.fadeFrame = 0;
    this.endedPreparation = false;
  }
  invalidateNext() {
    if (this.fadeFrame) return;
    this.preparationGeneration++;
    this.nextPrepared?.decoder.stop();
    this.nextPrepared = null;
    this.nextFrames = [];
    this.nextRead = null;
    this.nextReady = null;
    this.nextReadError = null;
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
    if (this.disposed) return null;
    const remaining =
      this.main.track.duration - this.offset - this.trackFrame / 50;
    const fadeSeconds = this.fadeSeconds();
    if (remaining < fadeSeconds + 20 && !this.main.track.live) this.prepare();
    let a = await this.readMainFrame();
    if (this.disposed) return null;
    if (!a) {
      if (this.preparing) await this.preparing;
      if (!this.nextPrepared) {
        this.prepare();
        if (this.preparing) await this.preparing;
      }
      if (!this.nextFrames.length && this.nextReady) await this.nextReady;
      if (this.disposed || !this.nextPrepared || this.nextFailed) return null;
      const consumed = this.fadeFrame ? this.fadeFrame - 1 : 0;
      this.promoteNext(consumed);
      // An early outgoing EOF can interrupt an announced fade. Keep the
      // incoming frames already heard and its original clock segment.
      if (!consumed) this.options.onSegment(this.main.track, this.frameIndex, this.offset);
      a = await this.readMainFrame();
      if (this.disposed || !a) return null;
    }
    let b: Buffer | null = null;
    if (
      !this.fadeFrame &&
      this.nextPrepared &&
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
        this.promoteNext(this.fadeLength);
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
    stream.destroy(new Error("Audio encoding could not start.")),
  );
  // stdout can end before the exit status arrives. Only a successful exit is EOF.
  process.on("close", (code) => {
    if (!stream.destroyed) {
      if (code === 0) stream.end();
      else
        stream.destroy(
          new Error("Audio encoding stopped (" + stderrReason + ")."),
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
