export type AudioReason =
  | "buffer-start"
  | "buffer-end"
  | "decoder-failure"
  | "encoder-failure"
  | "stream-stall"
  | "stream-error"
  | "recovery"
  | "recovery-exhausted"
  | "crossfade-unavailable"
  | "voice-disconnected"
  | "voice-error"
  | "voice-reconnected";
/** Only fixed reason codes and durations. Never provider stderr, URLs or IDs. */
export class AudioDiagnostics {
  events: {
    at: number;
    reason: AudioReason;
    durationMs: number;
  }[] = [];
  interruptions = 0;
  maxInterruptionMs = 0;
  bufferSince: number | null = null;
  note(reason: AudioReason, durationMs = 0) {
    const duration = Math.max(0, Math.round(durationMs));
    this.events.push({ at: Date.now(), reason, durationMs: duration });
    this.events = this.events.slice(-50);
  }
  buffer(active: boolean) {
    if (active && this.bufferSince === null) {
      this.bufferSince = performance.now();
      this.interruptions++;
      this.note("buffer-start");
    } else if (!active && this.bufferSince !== null) {
      const elapsed = performance.now() - this.bufferSince;
      this.maxInterruptionMs = Math.max(this.maxInterruptionMs, elapsed);
      this.note("buffer-end", elapsed);
      this.bufferSince = null;
    }
  }
  snapshot() {
    return {
      interruptions: this.interruptions,
      maxInterruptionMs: Math.round(
        Math.max(
          this.maxInterruptionMs,
          this.bufferSince === null ? 0 : performance.now() - this.bufferSince,
        ),
      ),
      buffering: this.bufferSince !== null,
      events: [...this.events],
    };
  }
}
