/** In-memory source of bounded, answer-safe WAV bytes for an authorized round. */
export interface GuessMediaSource {
  read(key: string, signal: AbortSignal): Promise<Uint8Array>;
}
