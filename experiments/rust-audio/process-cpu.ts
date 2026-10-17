// Counters for explicitly owned offline children only. No process discovery.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export type CpuSnapshot = { source: string; counterUnitMs: number; values: { pid: number; cpuMs: number }[]; error: string | null };

export function linuxCpuTicks(stat: string) {
  // comm is parenthesized and may itself contain spaces or closing parentheses.
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
  const ticks = Number(fields[11]) + Number(fields[12]); // stat fields 14 and 15
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new Error("Invalid process CPU counters");
  return ticks;
}

export function processCpu(pids: number[]): CpuSnapshot {
  try {
    if (new Set(pids).size !== pids.length || pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) throw new Error("Invalid owned child PID");
    if (!pids.length) return { source: "no children", counterUnitMs: 0, values: [], error: null };
    if (process.platform === "linux") {
      const result = spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8", timeout: 5000 });
      const hz = Number(result.stdout?.trim());
      if (result.status !== 0 || !Number.isFinite(hz) || hz <= 0) throw new Error("CLK_TCK unavailable");
      return { source: "Linux /proc/<owned-pid>/stat utime + stime", counterUnitMs: 1000 / hz,
        values: pids.map((pid) => ({ pid, cpuMs: linuxCpuTicks(readFileSync(`/proc/${pid}/stat`, "utf8")) * 1000 / hz })), error: null };
    }
    if (process.platform === "win32") {
      const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `@(Get-Process -Id ${pids.join(",")} -ErrorAction Stop | ForEach-Object { @{pid=$_.Id; cpuMs=$_.TotalProcessorTime.TotalMilliseconds} }) | ConvertTo-Json -Compress`],
      { windowsHide: true, encoding: "utf8", timeout: 10_000, maxBuffer: 16_384 });
      if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.trim());
      const parsed: unknown = JSON.parse(result.stdout);
      const values = (Array.isArray(parsed) ? parsed : [parsed]) as { pid: number; cpuMs: number }[];
      if (values.length !== pids.length || values.some((entry) => !pids.includes(entry.pid) || !Number.isFinite(entry.cpuMs) || entry.cpuMs < 0))
        throw new Error("Incomplete child CPU counters");
      return { source: "Windows Get-Process TotalProcessorTime", counterUnitMs: 0.0001, values, error: null };
    }
    throw new Error(`Child CPU unsupported on ${process.platform}`);
  } catch (error) { return { source: "unavailable", counterUnitMs: 0, values: [], error: String(error) }; }
}

export function cpuDelta(before: CpuSnapshot, after: CpuSnapshot) {
  if (before.error || after.error) return null;
  if (before.values.length !== after.values.length) return null;
  let total = 0;
  for (const entry of before.values) {
    const next = after.values.find((value) => value.pid === entry.pid);
    if (!next || next.cpuMs < entry.cpuMs) return null;
    total += next.cpuMs - entry.cpuMs;
  }
  return total;
}
