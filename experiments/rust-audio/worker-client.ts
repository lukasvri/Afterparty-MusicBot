// Experimental parent process only. Production Core never imports this module.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

export const FRAME_BYTES = 3840;
const PACKET_BYTES = 16 + FRAME_BYTES;
export const defaultExecutable = fileURLToPath(new URL(
  `./target/release/afterparty-rust-audio${process.platform === "win32" ? ".exe" : ""}`,
  import.meta.url,
));
export type MixInput = { a: Buffer; b: Buffer | null; progress: number; volume: number };
type Pending = { id: number; bytes: Buffer; resolve: (frame: Buffer) => void; reject: (error: Error) => void; cleanup: () => void };

/** One bounded request at a time; failure is terminal and always reaps the child. */
export class RustAudioWorker {
  private child: ChildProcessWithoutNullStreams;
  private pending: Pending | null = null;
  private failure: Error | null = null;
  private closing = false;
  private nextId = 0;
  private exited = false;
  private stderrTail = Buffer.alloc(0);
  private replyChunks = 0;
  readonly closed: Promise<void>;
  readonly timeoutMs: number;

  constructor(options: { executable?: string; args?: string[]; timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 1000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 60_000)
      throw new RangeError("timeoutMs must be between 0 and 60000");
    this.child = spawn(options.executable ?? process.env.RUST_AUDIO_BIN ?? defaultExecutable, options.args ?? ["--stream"], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    this.closed = new Promise((resolve) => this.child.once("close", (code, signal) => {
      this.exited = true;
      if (!this.closing || this.pending || code !== 0 || signal)
        this.failure ??= new Error(`Rust worker exited (${signal ?? code})`);
      const pending = this.pending;
      this.pending = null;
      pending?.cleanup();
      // close means the process exited and all three pipes have closed.
      resolve();
      if (pending) pending.reject(this.failure ?? new Error("Rust worker closed"));
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
  get diagnostics() { return this.stderrTail.toString(); }
  get isClosed() { return this.exited; }
  get transportStats() { return { replyChunks: this.replyChunks }; }

  private fail(error: Error) {
    this.failure ??= error;
    if (!this.exited) this.child.kill("SIGKILL");
  }

  private receive(chunk: Buffer) {
    this.replyChunks++;
    const pending = this.pending;
    if (!pending || pending.bytes.length + chunk.length > PACKET_BYTES) {
      this.fail(new Error("Unexpected or oversized Rust worker reply"));
      return;
    }
    pending.bytes = Buffer.concat([pending.bytes, chunk]);
    if (pending.bytes.length < PACKET_BYTES) return;
    const packet = pending.bytes;
    if (!packet.subarray(0, 8).equals(Buffer.from([65, 80, 67, 77, 1, 129, 0, 0])) ||
        packet.readUInt32LE(8) !== pending.id || packet.readUInt32LE(12) !== FRAME_BYTES) {
      this.fail(new Error("Invalid Rust worker reply header or request ID"));
      return;
    }
    if (this.failure) return;
    this.pending = null;
    pending.cleanup();
    pending.resolve(packet.subarray(16));
  }

  async mix(input: MixInput, signal?: AbortSignal): Promise<Buffer> {
    if (this.failure) { await this.closed; throw this.failure; }
    if (this.closing || this.exited) throw new Error("Rust worker is closed");
    if (this.pending) throw new Error("Rust worker already has an outstanding request");
    if (signal?.aborted) throw new Error("Rust mix cancelled");
    if (input.a.length !== FRAME_BYTES || (input.b && input.b.length !== FRAME_BYTES) ||
        !Number.isFinite(input.progress) || !Number.isFinite(input.volume))
      throw new RangeError("Invalid PCM frame or nonfinite mix controls");
    const id = this.nextId++ >>> 0;
    const header = Buffer.alloc(32);
    header.write("APCM");
    header[4] = 1; header[5] = 1; header[6] = input.b ? 1 : 0;
    header.writeUInt32LE(id, 8);
    header.writeUInt32LE(FRAME_BYTES * (input.b ? 2 : 1), 12);
    header.writeDoubleLE(input.progress, 16);
    header.writeDoubleLE(input.volume, 24);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("Rust mix timed out")), this.timeoutMs);
      const abort = () => this.fail(new Error("Rust mix cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      this.pending = { id, bytes: Buffer.alloc(0), resolve, reject, cleanup: () => {
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
      } };
      // The sole outstanding packet bounds writable buffering to 7712 bytes.
      this.child.stdin.write(Buffer.concat([header, input.a, ...(input.b ? [input.b] : [])]),
        (error) => { if (error) this.fail(error); });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.exited) return;
    if (this.pending) this.fail(new Error("Rust worker closed during a request"));
    else this.child.stdin.end();
    const timer = setTimeout(() => this.fail(new Error("Rust worker shutdown timed out")), this.timeoutMs);
    try { await this.closed; } finally { clearTimeout(timer); }
  }
}
