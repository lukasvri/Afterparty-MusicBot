import { spawn } from "node:child_process";
import { UserError } from "./types.ts";

const MAX_OUTPUT_BYTES = 8_000_000;
const MAX_ACTIVE = 4;
const MAX_WAITING = 16;
type Waiter = { enter: () => void; priority: boolean };
let active = 0;
const waiting: Waiter[] = [];

async function acquire(signal?: AbortSignal, priority = false) {
  if (signal?.aborted) throw new UserError("Forespørselen ble avbrutt.");
  if (active < MAX_ACTIVE) {
    active++;
    return;
  }
  if (waiting.length >= MAX_WAITING)
    throw new UserError("Musikkilden er opptatt. Prøv igjen om litt.", 503);
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
            ? "Forespørselen ble avbrutt."
            : "Musikkilden er opptatt. Prøv igjen om litt.",
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
    return Promise.reject(new UserError("Forespørselen ble avbrutt."));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0,
      failure: Error | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      child.kill("SIGKILL");
    };
    const cancel = () => stop(new UserError("Forespørselen ble avbrutt."));
    const timer = setTimeout(
      () => stop(new UserError("Mediekilden svarte ikke innen fristen.", 504)),
      30000,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES)
        stop(new UserError("Mediekilden ga et for stort svar.", 502));
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
            "Mediekilden kunne ikke lastes. Prøv en annen lenke.",
            502,
          ),
        );
      try {
        resolve(JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")));
      } catch {
        reject(new UserError("Mediekilden ga et ugyldig svar.", 502));
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
