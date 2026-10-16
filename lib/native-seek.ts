/** Detect a discontinuity, not elapsed playback or time lost while buffering. */
export class NativeSeekTracker {
  private sample: { position: number; at: number } | null = null;
  private candidate: { position: number; at: number } | null = null;
  private written = false;
  private target = 0;
  reset() { this.sample = null; this.candidate = null; this.written = false; }
  write(position: number) { this.reset(); this.written = true; this.target = position; }
  get pending() { return this.candidate !== null; }
  acknowledge(position: number, at: number) {
    if (this.written && Number.isFinite(position) && Math.abs(position - this.target) < 1) {
      this.written = false;
      this.sample = { position, at };
    }
  }
  observe(position: number, at: number, state: number): number | null {
    if (!Number.isFinite(position)) return null;
    if (this.written) {
      // A delayed API seek is still our seek, even after slow buffering.
      this.acknowledge(position, at);
      return null;
    }
    const previous = this.sample;
    if (this.candidate) {
      if (state === 3) return null;
      const change = position - this.candidate.position;
      const elapsed = Math.max(0, at - this.candidate.at) / 1000;
      this.candidate = null;
      this.sample = { position, at };
      return change >= -.5 && change <= elapsed + .5 ? position : null;
    }
    if (previous && (position < previous.position - 1 || position > previous.position + Math.max(0, at - previous.at) / 1000 + 1)) {
      this.candidate = { position, at };
      return null;
    }
    this.sample = { position, at };
    return null;
  }
}
