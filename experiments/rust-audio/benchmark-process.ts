// Owns only the fresh offline measurement process and its descendants.
import { spawn, spawnSync } from "node:child_process";

export class BenchmarkProcessError extends Error {
  readonly stdout: string;
  constructor(message: string, stdout: string) { super(message); this.stdout = stdout; }
}

export async function measurementProcess(args: string[], timeoutMs = 120_000, graceMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true, detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stdout = "", stderr = "", failure: Error | null = null;
    let forceTimer: NodeJS.Timeout | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      // The measurement's handler aborts work and awaits its normal finally.
      if (child.connected) child.send({ type: "afterparty-benchmark-cancel" }, () => {});
      forceTimer = setTimeout(() => {
        if (!child.pid) return;
        if (process.platform === "win32") {
          const killed = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, timeout: 10_000, encoding: "utf8" });
          if (killed.error || killed.status !== 0) {
            failure = new Error(`${error.message}; process-tree cleanup failed: ${killed.error?.message ?? killed.stderr}`);
            child.kill("SIGKILL");
          }
        } else {
          try { process.kill(-child.pid, "SIGKILL"); }
          catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ESRCH") failure = new Error(`${error.message}; ${cause}`); }
        }
      }, graceMs);
    };
    const timer = setTimeout(() => stop(new Error("Benchmark subprocess timed out")), timeoutMs);
    const interrupt = () => stop(new Error("Benchmark cancelled"));
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    child.on("error", (error) => { failure ??= error; });
    child.stdout!.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > 1024 * 1024) stop(new Error("Benchmark report exceeded 1 MiB"));
      else stdout += chunk.toString();
    });
    child.stderr!.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096); });
    child.once("close", (code, signal) => {
      clearTimeout(timer); clearTimeout(forceTimer);
      process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
      if (failure || code !== 0 || signal) reject(new BenchmarkProcessError(
        `${failure?.message ?? `Benchmark subprocess exited (${signal ?? code})`}: ${stderr}`, stdout));
      else resolve(stdout);
    });
  });
}
