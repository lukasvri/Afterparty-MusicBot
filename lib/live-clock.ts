/** Monotonic client time keeps wall-clock adjustments out of playback estimates. */
export class LiveClock {
  private readonly origin: number;
  private offset: number | null = null;
  private bestRtt = Infinity;
  private estimateAt = -Infinity;
  private generation = 0;
  private sampling = false;
  readonly now: () => number;
  constructor(monotonic = () => performance.now(), wallTime = Date.now()) {
    this.origin = wallTime - monotonic();
    this.now = () => this.origin + monotonic();
  }
  record(sent: number, serverTime: number, received = this.now()) {
    const trip = received - sent;
    if (
      !Number.isFinite(sent) ||
      !Number.isFinite(received) ||
      !Number.isFinite(serverTime) ||
      !Number.isFinite(trip) ||
      trip < 0 ||
      trip > 5000
    )
      return null;
    // A permanently retained best sample cannot adapt after a network change.
    if (received - this.estimateAt >= 60000) this.bestRtt = Infinity;
    if (trip <= Math.max(1, this.bestRtt) * 1.2) {
      this.bestRtt = Math.min(this.bestRtt, trip);
      this.offset = serverTime - (sent + trip / 2);
      this.estimateAt = received;
    }
    return Math.round(trip);
  }
  reset() {
    this.offset = null;
    this.bestRtt = Infinity;
    this.estimateAt = -Infinity;
    this.generation++;
  }
  age(serverTime: number, maximum = 1500) {
    return this.offset === null || !Number.isFinite(serverTime)
      ? 0
      : Math.max(0, Math.min(maximum, this.now() + this.offset - serverTime));
  }
  async sample(signal: AbortSignal, request: typeof fetch = fetch) {
    if (this.sampling || signal.aborted) return null;
    this.sampling = true;
    const sent = this.now(), generation = this.generation;
    try {
      const response = await request("/api/realtime/clock", {
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok || signal.aborted) return null;
      const data: unknown = await response.json();
      return signal.aborted || generation !== this.generation || !data || typeof data !== "object" || !("serverTime" in data) || typeof data.serverTime !== "number"
        ? null
        : this.record(sent, data.serverTime);
    } catch {
      return null;
    } finally {
      this.sampling = false;
    }
  }
}
