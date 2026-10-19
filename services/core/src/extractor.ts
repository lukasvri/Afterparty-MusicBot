import { spawn } from "node:child_process";
import { UserError } from "./types.ts";

const MAX_OUTPUT_BYTES = 8_000_000;
const MAX_ACTIVE = 4;
const MAX_WAITING = 16;
type Waiter = { enter: () => void; priority: boolean };
let active = 0;
const waiting: Waiter[] = [];

async function acquire(signal?: AbortSignal, priority = false) {
  if (signal?.aborted) throw new UserError("The request was cancelled.");
  if (active < MAX_ACTIVE) {
    active++;
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
      priority,
      enter: () => {
        cleanup();
        active++;
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
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: grouped });
    const chunks: Buffer[] = [];
    let bytes = 0,
      failure: Error | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      // yt-dlp may start a JavaScript runtime. Kill its owned process group too.
      try { if (grouped && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { child.kill("SIGKILL"); }
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
    // Drain stderr without retaining private source URLs or redundant log buffers.
    child.stderr.resume();
    child.on("error", (error) => {
      failure ??= error;
    });
    child.stdout.on("error", stop);
    child.stderr.on("error", stop);
    // Keep the slot until the subprocess actually exits, including cancellation.
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (failure) return reject(failure);
      if (code !== 0)
        return reject(
          new UserError(
            "Could not load the media source. Try another link.",
            502,
          ),
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
) {
  await acquire(signal, priority);
  try {
    return await spawnJson<T>(command, args, signal);
  } finally {
    active--;
    waiting.shift()?.enter();
  }
}
