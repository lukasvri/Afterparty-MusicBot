/** Answer-safe PCM envelope shared by Core, proxy and browser. No provider metadata. */
export const GUESS_AUDIO_RATE = 16000;
export const GUESS_AUDIO_MAX_SECONDS = 30;
export const GUESS_AUDIO_MAX_BYTES = 44 + GUESS_AUDIO_RATE * 2 * GUESS_AUDIO_MAX_SECONDS;
const ascii = (bytes: Uint8Array, at: number, size: number) => String.fromCharCode(...bytes.subarray(at, at + size));
export function guessWave(pcm: Uint8Array): Uint8Array {
  if (!pcm.length || pcm.length % 2 || pcm.length > GUESS_AUDIO_MAX_BYTES - 44) throw Error('Invalid preview audio.');
  const bytes = new Uint8Array(pcm.length + 44), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => { for (let n = 0; n < value.length; n++) bytes[at + n] = value.charCodeAt(n); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, GUESS_AUDIO_RATE, true); view.setUint32(28, GUESS_AUDIO_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, pcm.length, true); bytes.set(pcm, 44); return bytes;
}
export function guessWaveSeconds(bytes: Uint8Array): number {
  if (bytes.length < 46 || bytes.length > GUESS_AUDIO_MAX_BYTES || bytes.length % 2) throw Error('Invalid preview audio.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 8) !== 'WAVEfmt ' || ascii(bytes, 36, 4) !== 'data' ||
    view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== GUESS_AUDIO_RATE || view.getUint32(28, true) !== GUESS_AUDIO_RATE * 2 ||
    view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.length - 44) throw Error('Invalid preview audio.');
  return (bytes.length - 44) / (GUESS_AUDIO_RATE * 2);
}
export async function readGuessBytes(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body || signal.aborted) throw Error('Preview request canceled.');
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) { void response.body.cancel().catch(() => {}); throw Error('Preview is too large.'); }
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const chunk = await guessAbort(reader.read(), signal); signal.throwIfAborted();
      if (chunk.done) break; size += chunk.value.length;
      if (size > maximum) throw Error('Preview is too large.'); parts.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Release request capacity even when an injected dependency ignores cancellation. */
export function guessAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason ?? Error('Preview request canceled.')); };
    operation.then(value => { signal.removeEventListener('abort', aborted); if (!signal.aborted) resolve(value); }, error => { signal.removeEventListener('abort', aborted); reject(error); });
    if (signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once: true });
  });
}
