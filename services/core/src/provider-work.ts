import { UserError } from "./types.ts";

// Leave time for the website's 25s Core transport and 35s browser request.
export const CORE_SEARCH_DEADLINE_MS = 24000;
export const CORE_SEARCH_RESULTS_MS = 22000;
export const MUSIC_REQUEST_DEADLINE_MS = 30000;
const cancelled = () => new UserError("The request was cancelled.", 499);

/** One bounded provider job, with independently cancellable subscribers. */
export class ProviderWork<T> {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private subscribers = 0;
  private finished = false;
  private timer: ReturnType<typeof setTimeout>;
  private resolveResult!: (value: T) => void;
  private rejectResult!: (error: unknown) => void;
  private readonly result: Promise<T>;
  private readonly released: () => void;

  constructor(milliseconds: number, released: () => void) {
    this.released = released;
    this.result = new Promise<T>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    // Reservations can be retired before their first subscriber attaches.
    void this.result.catch(() => {});
    this.timer = setTimeout(() => this.reject(
      new UserError("The music source took too long. Try again shortly.", 504),
    ), milliseconds);
  }

  private finish() {
    this.finished = true;
    clearTimeout(this.timer);
    this.released();
  }

  resolve(value: T) {
    if (this.finished) return;
    this.finish();
    this.resolveResult(value);
  }

  reject(error: unknown) {
    if (this.finished) return;
    this.finish();
    this.controller.abort(error);
    this.rejectResult(error);
  }

  run(provider: (signal: AbortSignal) => Promise<T>) {
    void Promise.resolve().then(() => {
      this.signal.throwIfAborted();
      return provider(this.signal);
    }).then(value => this.resolve(value), error => this.reject(error));
  }

  wait(signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      if (!this.subscribers) this.reject(cancelled());
      return Promise.reject(cancelled());
    }
    this.subscribers++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const complete = (ok: boolean, value: unknown) => {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", abort);
        this.subscribers--;
        if (!this.finished && !this.subscribers) this.reject(cancelled());
        if (ok) resolve(value as T); else reject(value);
      };
      const abort = () => complete(false, cancelled());
      signal?.addEventListener("abort", abort, { once: true });
      void this.result.then(value => complete(true, value), error => complete(false, error));
    });
  }
}
