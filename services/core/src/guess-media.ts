import { spawn } from 'node:child_process';
import { UserError } from './types.ts';
import { GUESS_AUDIO_MAX_BYTES, GUESS_AUDIO_RATE, guessWave, guessWaveSeconds, readGuessBytes, guessAbort } from './guess-audio-format.ts';
import { validateDeezerPreviewUrl } from './guess-deezer-metadata.ts';
export interface GuessMediaSource { read(key: string, signal: AbortSignal): Promise<Uint8Array> }
const unavailable = () => new UserError('Game preview is unavailable.', 503);
/** Decode only bounded, already-authorized preview bytes. No files or provider metadata survive. */
export async function normalizeGuessAudio(input: Uint8Array, signal: AbortSignal, format: 'mp3' | 'wav' | 'ogg' = 'mp3'): Promise<Uint8Array> {
  if (!['mp3', 'wav', 'ogg'].includes(format) || !input.length || input.length > 1_500_000 || signal.aborted) throw unavailable();
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'pipe', '-f', format, '-probesize', '65536', '-analyzeduration', '1000000', '-i', 'pipe:0', '-map_metadata', '-1', '-vn', '-t', '31', '-ac', '1', '-ar', String(GUESS_AUDIO_RATE), '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let settled = false, size = 0; const parts: Buffer[] = [];
    const fail = () => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', fail); child.kill('SIGKILL'); reject(unavailable()); };
    const timer = setTimeout(fail, 5000); timer.unref(); signal.addEventListener('abort', fail, { once: true });
    child.on('error', fail); child.stdin.on('error', fail);
    child.stdout.on('data', (part: Buffer) => { size += part.length; if (size > GUESS_AUDIO_MAX_BYTES - 44) fail(); else parts.push(part); });
    child.on('close', code => {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', fail);
      if (code !== 0 || signal.aborted || !size) { reject(unavailable()); return; }
      try { resolve(guessWave(Buffer.concat(parts))); } catch { reject(unavailable()); }
    });
    child.stdin.end(input); if (signal.aborted) fail();
  });
}
/** Fixed reviewed CDN only; no arbitrary URL transport, redirects or forwarded headers. */
export async function fetchDeezerPreview(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const valid = validateDeezerPreviewUrl(url), bounded = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  try {
    const response = await guessAbort(fetcher(valid, { redirect: 'error', signal: bounded, headers: { Accept: 'audio/mpeg' } }), bounded);
    let headerBytes = 0; response.headers.forEach((v,k) => { headerBytes += v.length + k.length; });
    if (headerBytes > 8192 || !response.ok || response.redirected || (response.url && response.url !== valid) ||
      !['audio/mpeg', 'audio/mp3'].includes((response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()) ||
      !['', 'identity'].includes(response.headers.get('content-encoding') ?? '')) { void response.body?.cancel().catch(() => {}); throw unavailable(); }
    const bytes = await readGuessBytes(response, 1_500_000, bounded);
    return await normalizeGuessAudio(bytes, bounded);
  } catch { throw unavailable(); }
}
/** Short-lived prepared previews. Never persists clips or resolves client URLs. */
export class PreparedGuessMedia implements GuessMediaSource {
  private clips: Map<string, Uint8Array>; private expires: number;
  constructor(clips: Map<string, Uint8Array>, expires = Date.now() + 300000) {
    if (clips.size > 8 || !Number.isFinite(expires) || expires > Date.now() + 300000) throw unavailable();
    this.clips = new Map([...clips].map(([key, bytes]) => { guessWaveSeconds(bytes); return [key, bytes.slice()]; })); this.expires = expires;
    // Expiry releases the buffers even when no later request touches this source.
    const expiry = setTimeout(() => this.clips.clear(), Math.max(0, expires - Date.now())); expiry.unref();
  }
  async read(key: string, signal: AbortSignal) {
    if (signal.aborted || Date.now() >= this.expires) { if (Date.now() >= this.expires) this.clips.clear(); throw unavailable(); }
    const clip = this.clips.get(key); if (!clip) throw unavailable(); return clip.slice();
  }
}
