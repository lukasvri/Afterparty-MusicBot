// Explicit offline batch experiment. Production Core never imports this client.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { FRAME_BYTES, defaultExecutable, type MixInput } from "./worker-client.ts";

export const BATCH_COUNTS = [1, 4, 8] as const;
export const BATCH_HEADER_BYTES = 16, FRAME_REPLY_HEADER_BYTES = 8;
export const MAX_BATCH_REQUEST_BYTES = 16 + 8 * (32 + 2 * FRAME_BYTES);
export const MAX_BATCH_REPLY_BYTES = 16 + 8 * (8 + FRAME_BYTES);
type Pending = { batchId: number; ids: number[]; bytes: Buffer; offset: number;
  resolve: (frames: Buffer[]) => void; reject: (error: Error) => void; cleanup: () => void };

/** One bounded batch at a time. Any process/protocol failure is terminal. */
export class RustBatchWorker {
  private child: ChildProcessWithoutNullStreams;
  private pending: Pending | null = null;
  private failure: Error | null = null;
  private closing = false;
  private exited = false;
  private nextBatchId = 0;
  private nextFrameId = 0;
  private stderrTail = Buffer.alloc(0);
  private replyChunks = 0;
  private requests = 0;
  readonly closed: Promise<void>;
  readonly timeoutMs: number;

  constructor(options: { executable?: string; args?: string[]; timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 1000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 60_000)
      throw new RangeError("timeoutMs must be between 0 and 60000");
    this.child = spawn(options.executable ?? process.env.RUST_AUDIO_BIN ?? defaultExecutable,
      options.args ?? ["--batch-stream"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.closed = new Promise((resolve) => this.child.once("close", (code, signal) => {
      this.exited = true;
      if (!this.closing || this.pending || code !== 0 || signal) this.failure ??= new Error(`Rust batch worker exited (${signal ?? code})`);
      const pending = this.pending; this.pending = null; pending?.cleanup();
      resolve(); if (pending) pending.reject(this.failure ?? new Error("Rust batch worker closed"));
    }));
    this.child.on("error", (error) => this.fail(error));
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.stdout.on("error", (error) => this.fail(error));
    this.child.stderr.on("error", (error) => this.fail(error));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = Buffer.concat([this.stderrTail, chunk.subarray(-4096)]).subarray(-4096);
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
  }

  get pid() { return this.child.pid; }
  get isClosed() { return this.exited; }
  get diagnostics() { return this.stderrTail.toString(); }
  get transportStats() { return { requests: this.requests, replyChunks: this.replyChunks }; }

  private fail(error: Error) { this.failure ??= error; if (!this.exited) this.child.kill("SIGKILL"); }

  private receive(chunk: Buffer) {
    this.replyChunks++;
    const pending = this.pending;
    if (!pending || pending.offset + chunk.length > pending.bytes.length) {
      this.fail(new Error("Unexpected or oversized Rust batch reply")); return;
    }
    chunk.copy(pending.bytes, pending.offset); pending.offset += chunk.length;
    if (pending.offset < pending.bytes.length) return;
    const packet = pending.bytes, count = pending.ids.length;
    if (!packet.subarray(0, 8).equals(Buffer.from([65, 80, 66, 84, 1, 129, count, 0])) ||
        packet.readUInt32LE(8) !== pending.batchId || packet.readUInt32LE(12) !== packet.length - BATCH_HEADER_BYTES) {
      this.fail(new Error("Invalid Rust batch reply header or batch ID")); return;
    }
    const frames: Buffer[] = [];
    for (let index = 0; index < count; index++) {
      const offset = BATCH_HEADER_BYTES + index * (FRAME_REPLY_HEADER_BYTES + FRAME_BYTES);
      if (packet.readUInt32LE(offset) !== pending.ids[index] || packet.readUInt32LE(offset + 4) !== FRAME_BYTES) {
        this.fail(new Error("Invalid Rust batch frame ID or length")); return;
      }
      frames.push(packet.subarray(offset + FRAME_REPLY_HEADER_BYTES, offset + FRAME_REPLY_HEADER_BYTES + FRAME_BYTES));
    }
    if (this.failure) return;
    this.pending = null; pending.cleanup(); pending.resolve(frames);
  }

  async mixBatch(inputs: MixInput[], signal?: AbortSignal): Promise<Buffer[]> {
    if (this.failure) { await this.closed; throw this.failure; }
    if (this.closing || this.exited) throw new Error("Rust batch worker is closed");
    if (this.pending) throw new Error("Rust batch worker already has an outstanding batch");
    if (signal?.aborted) throw new Error("Rust batch cancelled");
    if (!BATCH_COUNTS.some((count) => count === inputs.length) || inputs.some((input) =>
      input.a.length !== FRAME_BYTES || (input.b !== null && input.b.length !== FRAME_BYTES) ||
      !Number.isFinite(input.progress) || !Number.isFinite(input.volume))) throw new RangeError("Invalid batch count, PCM frame or controls");
    const batchId = this.nextBatchId++ >>> 0;
    const ids: number[] = [], parts: Buffer[] = [];
    let payloadBytes = 0;
    for (const input of inputs) {
      const id = this.nextFrameId++ >>> 0, header = Buffer.alloc(32); ids.push(id);
      header.write("APCM"); header[4] = 1; header[5] = 1; header[6] = input.b ? 1 : 0;
      header.writeUInt32LE(id, 8); header.writeUInt32LE(FRAME_BYTES * (input.b ? 2 : 1), 12);
      header.writeDoubleLE(input.progress, 16); header.writeDoubleLE(input.volume, 24);
      parts.push(header, input.a); if (input.b) parts.push(input.b);
      payloadBytes += 32 + FRAME_BYTES * (input.b ? 2 : 1);
    }
    const header = Buffer.alloc(BATCH_HEADER_BYTES);
    header.write("APBT"); header[4] = 1; header[5] = 1; header[6] = inputs.length;
    header.writeUInt32LE(batchId, 8); header.writeUInt32LE(payloadBytes, 12);
    // Copy caller inputs immediately; only one <=61,712-byte packet can be queued.
    const request = Buffer.concat([header, ...parts]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("Rust batch timed out")), this.timeoutMs);
      const abort = () => this.fail(new Error("Rust batch cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      this.pending = { batchId, ids, bytes: Buffer.allocUnsafe(BATCH_HEADER_BYTES + inputs.length * (FRAME_REPLY_HEADER_BYTES + FRAME_BYTES)), offset: 0,
        resolve, reject, cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
      this.requests++;
      this.child.stdin.write(request, (error) => { if (error) this.fail(error); });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.exited) return;
    if (this.pending) this.fail(new Error("Rust batch worker closed during a batch"));
    else this.child.stdin.end();
    const timer = setTimeout(() => this.fail(new Error("Rust batch worker shutdown timed out")), this.timeoutMs);
    try { await this.closed; } finally { clearTimeout(timer); }
  }
}
