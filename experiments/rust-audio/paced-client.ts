// Offline arrival-aware adapter only. Production Core never imports this file.
import { FRAME_BYTES, type MixInput } from "./worker-client.ts";

export type PacedBatchOptions = {
  batchSize: 1 | 4 | 8;
  maxWaitMs: number;
  mix: (inputs: MixInput[], signal: AbortSignal) => Promise<Buffer[]>;
};
type Pending = { input: MixInput; arrivedAt: number;
  resolve: (frame: Buffer) => void; reject: (error: Error) => void };
type Active = { items: Pending[]; controller: AbortController };

/** At most eight queued frames and one <=8-frame backend call, with no lookahead.
 * maxWaitMs bounds collection waiting, not time blocked behind an active backend.
 * Backends must observe abort and settle promptly. close waits up to one second;
 * the owner must still close/reap an uncooperative backend independently.
 */
export class PacedBatchQueue {
  private readonly options: PacedBatchOptions;
  private queue: Pending[] = [];
  private active: Active | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failure: Error | null = null;
  private finishing = false;
  private finished = false;
  private finishPromise: Promise<void> | null = null;
  private finishResolve: (() => void) | null = null;
  private finishReject: ((error: Error) => void) | null = null;
  private settlement: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | null = null;
  private maxQueued = 0;
  private maxInFlight = 0;

  constructor(options: PacedBatchOptions) {
    if (![1, 4, 8].includes(options.batchSize) || !Number.isFinite(options.maxWaitMs) ||
      options.maxWaitMs < 0 || options.maxWaitMs > 1000) throw new RangeError("Invalid batchSize or maxWaitMs");
    if (typeof options.mix !== "function") throw new TypeError("mix must be a backend function");
    this.options = { ...options };
  }

  get stats() {
    return { queued: this.queue.length, inFlight: this.active?.items.length ?? 0,
      maxQueuedObserved: this.maxQueued, maxInFlightObserved: this.maxInFlight };
  }

  push(input: MixInput): Promise<Buffer> {
    if (this.failure || this.finishing || this.finished) return Promise.reject(this.failure ?? new Error("Paced batch queue is finished"));
    if (this.queue.length >= 8) return Promise.reject(new Error("Paced batch queue capacity exceeded"));
    if (!input || !Buffer.isBuffer(input.a) || input.a.length !== FRAME_BYTES ||
      (input.b !== null && (!Buffer.isBuffer(input.b) || input.b.length !== FRAME_BYTES)) ||
      !Number.isFinite(input.progress) || !Number.isFinite(input.volume)) return Promise.reject(new RangeError("Invalid PCM frame or controls"));
    const snapshot = { a: Buffer.from(input.a), b: input.b === null ? null : Buffer.from(input.b),
      progress: input.progress, volume: input.volume };
    return new Promise((resolve, reject) => {
      this.queue.push({ input: snapshot, arrivedAt: performance.now(), resolve, reject });
      this.maxQueued = Math.max(this.maxQueued, this.queue.length);
      this.pump();
    });
  }

  /** Stop accepting arrivals and drain only frames already submitted, in 8/4/1 chunks. */
  finish(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.finishPromise) return this.finishPromise;
    this.finishing = true;
    this.finishPromise = new Promise((resolve, reject) => { this.finishResolve = resolve; this.finishReject = reject; });
    this.pump();
    return this.finishPromise;
  }

  /** Terminal cancellation; rejects arrivals immediately, then bounds backend cleanup. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.fail(new Error("Paced batch queue closed"));
    const settled = this.settlement;
    this.closePromise = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([settled, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]); }
      finally { clearTimeout(timer); }
    })();
    return this.closePromise;
  }

  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }

  private fail(reason: unknown) {
    this.failure ??= reason instanceof Error ? reason : new Error(String(reason));
    this.clearTimer();
    for (const pending of this.queue.splice(0)) pending.reject(this.failure);
    const active = this.active; this.active = null;
    for (const pending of active?.items ?? []) pending.reject(this.failure);
    active?.controller.abort();
    this.finishReject?.(this.failure); this.finishResolve = null; this.finishReject = null;
  }

  private pump() {
    this.clearTimer();
    if (this.failure || this.active || this.finished) return;
    if (!this.queue.length) {
      if (this.finishing) {
        this.finished = true; this.finishResolve?.(); this.finishResolve = null; this.finishReject = null;
      }
      return;
    }
    const remaining = this.queue[0].arrivedAt + this.options.maxWaitMs - performance.now();
    if (this.queue.length < this.options.batchSize && !this.finishing && remaining > 0) {
      this.timer = setTimeout(() => { this.timer = null; this.pump(); }, remaining);
      return;
    }
    const count = [8, 4, 1].find(size => size <= this.options.batchSize && size <= this.queue.length)!;
    const active: Active = { items: this.queue.splice(0, count), controller: new AbortController() };
    this.active = active; this.maxInFlight = Math.max(this.maxInFlight, count);
    this.settlement = Promise.resolve().then(() => {
      // Closing before the backend starts must not create a stale request.
      if (this.active !== active) return [];
      return this.options.mix(active.items.map(item => item.input), active.controller.signal);
    }).then(outputs => {
      if (this.active !== active) return;
      if (!Array.isArray(outputs) || outputs.length !== count || outputs.some(frame => !Buffer.isBuffer(frame) || frame.length !== FRAME_BYTES))
        throw new Error("Invalid paced backend output");
      const frames = outputs.map(frame => Buffer.from(frame));
      this.active = null;
      active.items.forEach((item, index) => item.resolve(frames[index]));
      this.pump();
    }).catch(error => { if (this.active === active) this.fail(error); });
  }
}
