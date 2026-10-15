/** Monotonic client time keeps wall-clock adjustments out of playback estimates. */
export class LiveClock {
  private readonly origin: number;
  private offset: number | null = null;
  private bestRtt = Infinity;
  private sampling = false;
  readonly now: () => number;
  constructor(monotonic = () => performance.now(), wallTime = Date.now()) {
    this.origin = wallTime - monotonic();
    this.now = () => this.origin + monotonic();
  }
  record(sent: number, serverTime: number, received = this.now()) {
    const trip = received - sent;
    if (
      !Number.isFinite(serverTime) ||
      !Number.isFinite(trip) ||
      trip < 0 ||
      trip > 5000
    )
      return null;
    if (trip <= this.bestRtt * 1.2) {
      this.bestRtt = Math.min(this.bestRtt, trip);
      this.offset = serverTime - (sent + trip / 2);
    }
    return Math.round(trip);
  }
  age(serverTime: number) {
    return this.offset === null
      ? 0
      : Math.max(0, Math.min(1500, this.now() + this.offset - serverTime));
  }
  async sample(signal: AbortSignal, request: typeof fetch = fetch) {
    if (this.sampling || signal.aborted) return null;
    this.sampling = true;
    const sent = this.now();
    try {
      const response = await request("/api/realtime/clock", {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok || signal.aborted) return null;
      const data = (await response.json()) as { serverTime: number };
      return signal.aborted ? null : this.record(sent, data.serverTime);
    } catch {
      return null;
    } finally {
      this.sampling = false;
    }
  }
}
