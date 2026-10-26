import { Engine } from "./engine.ts";
import { Commands } from "./commands.ts";
import { BRIDGE_CHECKPOINT_MS, CORE_PRESENCE_CAPABILITY, BRIDGE_RECONCILIATION_REQUIRED } from "./bridge-checkpoint.ts";

const HEARTBEAT_MS = 5000;
const CHANGE_DELAY_MS = 50;
const MAX_RETRY_MS = 30000;

type BridgeJob = Record<string, unknown> & {
  id: string;
  action: string;
  expiresAt: number;
};
type BridgeReply = { serverTime: number; commands: BridgeJob[] };

function readReply(value: unknown): BridgeReply {
  if (!value || typeof value !== "object") throw new Error("Invalid bridge response.");
  const data = value as Partial<BridgeReply>;
  if (
    !Number.isFinite(data.serverTime) ||
    !Array.isArray(data.commands) ||
    data.commands.length > 5 ||
    data.commands.some(
      (job) =>
        !job ||
        typeof job !== "object" ||
        typeof job.id !== "string" ||
        !job.id ||
        job.id.length > 160 ||
        typeof job.action !== "string" ||
        !Number.isFinite(job.expiresAt),
    )
  )
    throw new Error("Invalid bridge response.");
  return data as BridgeReply;
}

/** Durable fallback bridge. Live playback updates use Core's direct transport. */
export class Publisher {
  readonly engine: Engine;
  readonly commands: Commands;
  readonly url: string;
  readonly key: string;
  readonly context: Record<string, string>;
  running = false;
  dirty = false;
  closed = false;
  offset = 0;
  lastWarning = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private scheduledAt = Infinity;
  private retryAt = 0;
  private failures = 0;
  private request: AbortController | null = null;
  private checkpointRevision = 0;
  private checkpointIntent = '';
  private checkpointAt = -Infinity;

  constructor(
    engine: Engine,
    commands: Commands,
    url: string,
    key: string,
    context: Record<string, string> = {},
  ) {
    this.context = context;
    this.engine = engine;
    this.commands = commands;
    this.url = url;
    this.key = key;
    engine.on("state", this.changed);
    void this.sync();
  }

  private schedule(delay: number) {
    if (this.closed || this.engine.store.get('bridge-reconciliation-block', false)) return;
    const at = performance.now() + delay;
    if (this.timer && this.scheduledAt <= at) return;
    clearTimeout(this.timer);
    this.scheduledAt = at;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.scheduledAt = Infinity;
      void this.sync();
    }, delay);
  }

  changed = () => {
    this.dirty = true;
    if (!this.running)
      this.schedule(Math.max(CHANGE_DELAY_MS, this.retryAt - performance.now()));
  };

  async sync() {
    if (this.running || this.closed || this.engine.store.get('bridge-reconciliation-block', false)) return;
    const retryIn = this.retryAt - performance.now();
    if (retryIn > 0) {
      this.schedule(retryIn);
      return;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    this.scheduledAt = Infinity;
    this.running = true;
    this.dirty = false;
    this.request = new AbortController();
    try {
      const state = this.engine.websiteSnapshot();
      const events = this.engine.store.events();
      const results = this.engine.store.bridgeResults();
      const started = performance.now();
      const publicState = {
        ...state,
        current:
          state.current && /^[\w-]{11}$/.test(state.current.id)
            ? state.current
            : null,
        queue: state.queue.filter((track) => /^[\w-]{11}$/.test(track.id)),
      };
      const bridgeRevision = this.engine.store.nextBridgeRevision();
      // Engine state revisions include explicit pause/seek/queue changes. Buffering
      // can change between those events, so it also participates in the intent key.
      // Advancing position and presence do not create a durable room checkpoint.
      const intent = JSON.stringify([state.epoch, state.sequence, state.buffering]);
      const checkpointInterval = state.playing ? BRIDGE_CHECKPOINT_MS : 86400000;
      if (intent !== this.checkpointIntent || started - this.checkpointAt >= checkpointInterval) {
        this.checkpointRevision = bridgeRevision;
        this.checkpointIntent = intent;
        this.checkpointAt = started;
      }
      const response = await fetch(new URL("/api/bridge", this.url), {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: "Bearer " + this.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...this.context,
          bridgeRevision,
          checkpointRevision: this.checkpointRevision,
          ...(this.context.presenceCapability === CORE_PRESENCE_CAPABILITY ? { presenceCapability: CORE_PRESENCE_CAPABILITY } : {}),
          state: publicState,
          sampledAt: state.serverTime + this.offset,
          events: events.filter((event) => event.video.concert),
          results,
        }),
        signal: AbortSignal.any([
          this.request.signal,
          AbortSignal.timeout(10000),
        ]),
      });
      if (this.closed) return;
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { code?: string } | null;
        if (this.closed) return;
        if (response.status === 409 && error?.code === BRIDGE_RECONCILIATION_REQUIRED) {
          // Never advance a restored counter until it eventually overtakes current
          // durable state. The operator must reconcile the complete per-guild data.
          this.engine.store.set('bridge-reconciliation-block', true);
          this.engine.emit('state', this.engine.websiteSnapshot());
          console.warn('The audience bridge requires manual state reconciliation. Publishing is blocked.');
          return;
        }
        throw new Error("The audience bridge did not respond.");
      }
      // A 200 response alone cannot acknowledge durable data or supply a clock.
      const data = readReply(await response.json());
      if (this.closed) return;
      const received = performance.now();
      const elapsed = received - started;
      this.offset = data.serverTime + elapsed / 2 - Date.now();
      this.engine.store.acknowledge(events.map((event) => event.id));
      this.engine.store.acknowledgeJobs(results.map((result) => result.id));
      this.failures = 0;
      this.retryAt = 0;
      for (const job of data.commands) {
        const old = this.engine.store.job(job.id, { ...job, bridge: true });
        if (old) continue;
        // Job deadlines use the website's clock. Compare on that clock even
        // when this host's wall clock differs or changes during the request.
        const serverNow = data.serverTime + elapsed / 2 + performance.now() - received;
        if (job.expiresAt <= serverNow) {
          this.engine.store.finishJob(
            job.id,
            "failed",
            "The command expired before it reached the bot.",
          );
          this.dirty = true;
          continue;
        }
        void this.commands.execute(job, job.id.startsWith("public:") ? "public" : "admin")
          .then((result) => {
            if (this.closed) return;
            this.engine.store.finishJob(job.id, "done", result);
            this.changed();
          })
          .catch((error: unknown) => {
            if (this.closed) return;
            this.engine.store.finishJob(
              job.id,
              "failed",
              error instanceof Error ? error.message : "The command failed.",
            );
            this.changed();
          });
      }
    } catch {
      if (this.closed) return;
      this.dirty = true;
      this.retryAt = performance.now() + Math.min(
        MAX_RETRY_MS,
        HEARTBEAT_MS * 2 ** Math.min(this.failures++, 3),
      );
      if (Date.now() - this.lastWarning > 60000) {
        console.warn(
          "Publikumsbroen er midlertidig utilgjengelig. Historikk og resultater beholdes lokalt.",
        );
        this.lastWarning = Date.now();
      }
    } finally {
      this.running = false;
      this.request = null;
      this.schedule(Math.max(
        this.retryAt - performance.now(),
        this.dirty ? CHANGE_DELAY_MS : HEARTBEAT_MS,
      ));
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.request?.abort();
    this.engine.off("state", this.changed);
  }
}
