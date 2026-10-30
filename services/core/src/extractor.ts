import { spawn } from "node:child_process";
import { UserError } from "./types.ts";

const MAX_OUTPUT_BYTES = 8_000_000;
// Full extraction can include a large Node challenge runtime. Metadata that
// skips player JS uses half its admission weight, within the same shared pool.
const MAX_ACTIVE = 4;
const memoryLimit = process.constrainedMemory();
const MEMORY_UNITS = Number.isFinite(memoryLimit) && memoryLimit > 0
  ? Math.max(2, Math.min(8, Math.floor(memoryLimit / (256 * 1024 * 1024))))
  : 8;
export type ExtractorProfile = "media" | "metadata";
const MAX_WAITING = 16;
const SOURCE_FAILURE = "Could not load the media source. Try another link.";
/** A metadata fast path may retry only when no usable format survives. */
export class ExtractorFormatError extends UserError {
  constructor() {
    super(SOURCE_FAILURE, 502);
    this.name = "ExtractorFormatError";
  }
}
type Waiter = { enter: () => void; priority: boolean; units: number };
let active = 0, activeUnits = 0;
const waiting: Waiter[] = [];

const fits = (units: number) => active < MAX_ACTIVE && activeUnits + units <= MEMORY_UNITS;
const enter = (units: number) => { active++; activeUnits += units; };
function drain() {
  // Do not let lighter catalog work bypass an older queued playback request.
  while (waiting[0] && fits(waiting[0].units)) waiting.shift()!.enter();
}

async function acquire(units: number, signal?: AbortSignal, priority = false) {
  if (signal?.aborted) throw new UserError("The request was cancelled.");
  if (!waiting.length && fits(units)) {
    enter(units);
    return;
  }
  if (waiting.length >= MAX_WAITING)
    throw new UserError("The music source is busy. Try again shortly.", 503);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      const index = waiting.indexOf(waiter);
      if (index < 0) return;
      waiting.splice(index, 1);
      cleanup();
      drain();
      reject(
        new UserError(
          signal?.aborted
            ? "The request was cancelled."
            : "The music source is busy. Try again shortly.",
          503,
        ),
      );
    };
    const waiter: Waiter = {
      priority, units,
      enter: () => {
        cleanup();
        enter(units);
        resolve();
      },
    };
    const timer = setTimeout(cancel, 15000);
    signal?.addEventListener("abort", cancel, { once: true });
    // Playback gets priority, but older playback requests keep their place.
    const regular = priority ? waiting.findIndex((w) => !w.priority) : -1;
    if (regular >= 0) waiting.splice(regular, 0, waiter);
    else waiting.push(waiter);
  });
}

function spawnJson<T>(
  command: string,
  args: string[],
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted)
    return Promise.reject(new UserError("The request was cancelled."));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0,
      failure: Error | undefined;
    let stderrPrefix = "", stderrTail = "", formatUnavailable = false;
    const finishStderrLine = () => {
      // Only the final ERROR line determines whether a full-format fallback
      // is appropriate. Earlier warnings must not reclassify a private failure.
      if (/^\s*ERROR:/i.test(stderrPrefix))
        formatUnavailable = /Requested format is not available|No video formats found/i.test(stderrTail);
      stderrPrefix = ""; stderrTail = "";
    };
    const stop = (error: Error) => {
      failure ??= error;
      child.kill("SIGKILL");
    };
    const cancel = () => stop(new UserError("The request was cancelled."));
    const timer = setTimeout(
      () => stop(new UserError("The media source did not respond in time.", 504)),
      30000,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES)
        stop(new UserError("The media source response was too large.", 502));
      else chunks.push(chunk);
    });
    // Inspect a bounded rolling suffix for a formats-only failure. Never return
    // or log stderr, which can contain private source URLs.
    child.stderr.on("data", (chunk: Buffer) => {
      const parts = chunk.toString("utf8").split(/\r?\n/);
      for (let index = 0; index < parts.length; index++) {
        if (index) finishStderrLine();
        stderrPrefix = (stderrPrefix + parts[index]).slice(0, 64);
        stderrTail = (stderrTail + parts[index]).slice(-512);
      }
    });
    child.on("error", (error) => {
      failure ??= error;
    });
    child.stdout.on("error", stop);
    child.stderr.on("error", stop);
    // Keep the slot until the subprocess actually exits, including cancellation.
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      finishStderrLine();
      if (failure) return reject(failure);
      if (code !== 0)
        return reject(
          formatUnavailable ? new ExtractorFormatError() : new UserError(SOURCE_FAILURE, 502),
        );
      try {
        resolve(JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")));
      } catch {
        reject(new UserError("The media source returned an invalid response.", 502));
      }
    });
  });
}

/** Bounded subprocess admission shared by all server providers. */
export async function runJson<T = Record<string, unknown>>(
  command: string,
  args: string[],
  signal?: AbortSignal,
  priority = false,
  profile: ExtractorProfile = "media",
) {
  const units = profile === "metadata" ? 1 : 2;
  await acquire(units, signal, priority);
  try {
    return await spawnJson<T>(command, args, signal);
  } finally {
    active--;
    activeUnits -= units;
    drain();
  }
}
