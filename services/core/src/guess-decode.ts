import { spawn } from 'node:child_process';
import { GUESS_AUDIO_MAX_BYTES, GUESS_AUDIO_RATE, guessWave, guessWaveSeconds } from './guess-audio-format.ts';
import { UserError } from './types.ts';

export const GUESS_MP3_MAX_BYTES = 2 * 1024 * 1024;
const unavailable = () => new UserError('Game preview preparation is unavailable.', 503);
let active = 0;

/** Decode bounded bytes only, with no files, network protocols, tags or provider stderr in output. */
export async function decodeGuessMp3(input: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
  if (!(input instanceof Uint8Array) || !input.length || input.length > GUESS_MP3_MAX_BYTES || signal.aborted || active >= 2) throw unavailable();
  active++;
  const bytes = new Uint8Array(input);
  try {
    const pcm = await new Promise<Uint8Array>((resolve, reject) => {
      const child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-xerror', '-max_alloc', '16777216',
        '-threads', '1', '-filter_threads', '1', '-probesize', String(GUESS_MP3_MAX_BYTES),
        '-analyzeduration', '1000000', '-protocol_whitelist', 'pipe', '-format_whitelist', 'mp3', '-f', 'mp3', '-i', 'pipe:0',
        '-map', '0:a:0', '-vn', '-sn', '-dn', '-t', '30',
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
      child.stdin.on('error', fail);
      child.stdout.on('error', fail);
      child.stdout.on('data', (chunk: Buffer) => {
        if (failed) return;
        size += chunk.byteLength;
        if (size > GUESS_AUDIO_MAX_BYTES - 44) { fail(); return; }
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
  finally { active--; }
}
