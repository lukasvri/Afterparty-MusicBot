// Offline compute probe. Run in a bounded test container, never with production data.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { Prepared } from "../services/core/src/audio.ts";

// The documented container mounts this probe as /app/capacity.ts. Keep the
// runtime module path there while checking calls against the repository's API.
const audioModule = "/app/src/audio.ts";
const { PcmDecoder, Mixer, encodeOpus }: typeof import("../services/core/src/audio.ts") =
  await import(audioModule);
const directory = mkdtempSync(join(tmpdir(), "afterparty-capacity-"));
const bitrates = [96000, 192000];
const tones = [["first", 440], ["second", 660]] as const;
const read = (name: string): number => {
  try {
    return Number(readFileSync("/sys/fs/cgroup/" + name, "utf8").trim());
  } catch {
    return 0;
  }
};

try {
  for (const [name, frequency] of tones) {
    const generated = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      `sine=frequency=${frequency}:duration=8`,
      "-ac", "2", "-ar", "48000", join(directory, name + ".wav"),
    ]);
    assert.equal(generated.status, 0, "Synthetic audio generation failed.");
  }
  for (const count of [1, 4, 8]) {
    let peakPids = 0, peakMemory = 0;
    const sample = () => {
      peakPids = Math.max(peakPids, read("pids.current"));
      peakMemory = Math.max(peakMemory, read("memory.current"));
    };
    const timer = setInterval(sample, 25),
      delays = monitorEventLoopDelay({ resolution: 10 });
    delays.enable();
    const started = performance.now();
    try {
      const packets = await Promise.all(Array.from({ length: count }, async (_, index) => {
        const abort = new AbortController();
        const prepare = (name: string): Prepared => ({
          track: {
            id: name, entryId: `${index}-${name}`, title: name,
            artist: "Synthetic", image: "", duration: 8,
            live: false, embeddable: true,
          },
          decoder: new PcmDecoder({
            url: join(directory, name + ".wav"), headers: "",
          }, 0, abort.signal),
        });
        const second = prepare("second");
        let supplied = false;
        const bitrate = bitrates[index % bitrates.length];
        const mixer = new Mixer({
          first: prepare("first"), offset: 0, volume: () => 100,
          crossfade: () => 2,
          next: async () => {
            if (supplied) return null;
            supplied = true;
            return second;
          },
          onSegment() {},
          bitrate,
        });
        let encoded: ReturnType<typeof encodeOpus> | undefined;
        try {
          mixer.prepare();
          await mixer.preparing;
          await mixer.nextRead;
          encoded = encodeOpus(mixer, bitrate);
          const packetStream: AsyncIterable<unknown> = encoded.stream;
          let packets = 0;
          for await (const packet of packetStream) {
            assert(Buffer.isBuffer(packet) && packet.length > 0);
            packets++;
          }
          assert(packets >= 700 && packets <= 701, "An independent stream lost audio packets.");
          return packets;
        } finally {
          mixer.destroy();
          abort.abort();
          encoded?.process.kill("SIGKILL");
        }
      }));
      sample();
      const seconds = (performance.now() - started) / 1000;
      console.log(JSON.stringify({
        streams: count,
        seconds: Number(seconds.toFixed(3)),
        audio_seconds_per_stream: 14,
        speed_vs_realtime: Number((14 / seconds).toFixed(2)),
        packets,
        peak_pids: peakPids,
        peak_memory_mib: Math.round(peakMemory / 1024 ** 2),
        event_loop_p99_ms: Number((delays.percentile(99) / 1e6).toFixed(2)),
      }));
    } finally {
      clearInterval(timer);
      delays.disable();
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
