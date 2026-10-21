import { spawn } from 'node:child_process';
import { GUESS_AUDIO_MAX_BYTES, GUESS_AUDIO_RATE, guessWave, guessWaveSeconds } from './guess-audio-format.ts';
import { UserError } from './types.ts';

export const GUESS_MP3_MAX_BYTES = 2 * 1024 * 1024;
export const GUESS_CLIP_MAX_BYTES = 8 * 1024 * 1024;
export type GuessClipOptions = { format: 'webm' | 'mp4'; startSeconds: number; durationSeconds: number };
const unavailable = () => new UserError('Game preview preparation is unavailable.', 503);
let active = 0;

/** Legacy preview decoding retains its MP3-only input and two-MiB limit. */
export async function decodeGuessMp3(input: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
  return decode(input, { maximum: GUESS_MP3_MAX_BYTES, demuxer: 'mp3', formats: 'mp3', startSeconds: 0, durationSeconds: 30 }, signal);
}

/** Select audio from bounded WebM/Matroska or MP4/M4A bytes. Seeking never opens a URL or file. */
export async function decodeGuessClip(input: Uint8Array, options: GuessClipOptions, signal: AbortSignal): Promise<Uint8Array> {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw unavailable();
    const { format, startSeconds, durationSeconds } = options;
    if (!['webm', 'mp4'].includes(format) || !Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 3600 ||
      !Number.isInteger(durationSeconds) || durationSeconds < 15 || durationSeconds > 30) throw unavailable();
    return await decode(input, { maximum: GUESS_CLIP_MAX_BYTES, demuxer: format === 'webm' ? 'matroska' : 'mov',
      formats: format === 'webm' ? 'matroska,webm' : 'mov,mp4,m4a,3gp,3g2,mj2', startSeconds, durationSeconds }, signal);
  } catch { throw unavailable(); }
}

type DecodeOptions = { maximum: number; demuxer: string; formats: string; startSeconds: number; durationSeconds: number };
/** Both entry points share process capacity, cancellation and the canonical answer-safe output envelope. */
async function decode(input: Uint8Array, options: DecodeOptions, signal: AbortSignal): Promise<Uint8Array> {
  if (!(input instanceof Uint8Array) || !input.length || input.length > options.maximum || signal.aborted || active >= 2) throw unavailable();
  active++;
  const bytes = new Uint8Array(input);
  try {
    const pcm = await new Promise<Uint8Array>((resolve, reject) => {
      const child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-xerror', '-max_alloc', '16777216',
        '-threads', '1', '-filter_threads', '1', '-probesize', String(options.maximum),
        '-analyzeduration', '1000000', '-protocol_whitelist', 'pipe', '-format_whitelist', options.formats, '-f', options.demuxer, '-i', 'pipe:0',
        // Output-side seeking consumes a pipe sequentially instead of attempting input seeks.
        ...(options.startSeconds ? ['-ss', options.startSeconds.toFixed(6)] : []),
        '-map', '0:a:0', '-vn', '-sn', '-dn', '-t', String(options.durationSeconds),
        '-map_metadata', '-1', '-ac', '1', '-ar', String(GUESS_AUDIO_RATE),
        '-c:a', 'pcm_s16le', '-threads', '1', '-f', 's16le', 'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      const parts: Uint8Array[] = [];
      let size = 0, failed = false;
      const fail = () => {
        failed = true; parts.length = 0;
        child.stdin.destroy(); child.stdout.destroy();
        child.kill('SIGKILL');
      };
      const timer = setTimeout(fail, 10_000);
      signal.addEventListener('abort', fail, { once: true });
      child.once('error', fail);
      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        // FFmpeg can finish the requested clip before consuming a longer input's tail.
        // A broken input pipe alone is harmless; success still requires code zero and valid PCM.
        if (error.code !== 'EPIPE') fail();
      });
      child.stdout.on('error', fail);
      child.stdout.on('data', (chunk: Buffer) => {
        if (failed) return;
        size += chunk.byteLength;
        if (size > Math.min(GUESS_AUDIO_MAX_BYTES - 44, options.durationSeconds * GUESS_AUDIO_RATE * 2)) { fail(); return; }
        parts.push(new Uint8Array(chunk));
      });
      // Wait for close, including after failure, before releasing the global process slot.
      child.once('close', code => {
        clearTimeout(timer); signal.removeEventListener('abort', fail);
        if (failed || signal.aborted || code !== 0 || !size || size % 2) { reject(unavailable()); return; }
        const output = new Uint8Array(size);
        let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
        resolve(output);
      });
      if (signal.aborted) fail(); else child.stdin.end(bytes);
    });
    signal.throwIfAborted();
    const wav = guessWave(pcm);
    if (guessWaveSeconds(wav) < 15) throw unavailable();
    return wav;
  } catch { throw unavailable(); }
  finally { bytes.fill(0); active--; }
}
