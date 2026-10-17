// Offline cross-language checks. This never starts Core or connects to Discord.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { FRAME_BYTES, mixPcm } from "../../services/core/src/audio.ts";

const executable = process.env.RUST_AUDIO_BIN ?? fileURLToPath(new URL(
  `./target/release/afterparty-rust-audio${process.platform === "win32" ? ".exe" : ""}`,
  import.meta.url,
));
const requestBytes = 32;
const responseBytes = 16;
const packetBytes = responseBytes + FRAME_BYTES;
const magic = Buffer.from("APCM");

type MixCase = { a: Buffer; b: Buffer | null; progress: number; volume: number };

function frame(sample: (index: number) => number) {
  const pcm = Buffer.alloc(FRAME_BYTES);
  for (let index = 0; index < FRAME_BYTES / 2; index++)
    pcm.writeInt16LE(sample(index), index * 2);
  return pcm;
}

function request(input: MixCase, id: number) {
  const header = Buffer.alloc(requestBytes);
  magic.copy(header);
  header[4] = 1;
  header[5] = 1;
  header[6] = input.b ? 1 : 0;
  header.writeUInt32LE(id, 8);
  header.writeUInt32LE(FRAME_BYTES * (input.b ? 2 : 1), 12);
  header.writeDoubleLE(input.progress, 16);
  header.writeDoubleLE(input.volume, 24);
  return Buffer.concat([header, input.a, ...(input.b ? [input.b] : [])]);
}

function verify(packet: Buffer, input: MixCase, id: number) {
  assert.equal(packet.length, packetBytes);
  assert.deepEqual(packet.subarray(0, 8), Buffer.from([65, 80, 67, 77, 1, 0x81, 0, 0]));
  assert.equal(packet.readUInt32LE(8), id, "Reply must preserve the opaque request ID");
  assert.equal(packet.readUInt32LE(12), FRAME_BYTES);
  assert.deepEqual(packet.subarray(responseBytes), mixPcm(input.a, input.b, input.progress, input.volume),
    `PCM differs from the current Core implementation for request ${id}`);
}

function run(input: Buffer, maxOutput = packetBytes) {
  const result = spawnSync(executable, ["--stream"], {
    input, timeout: 10_000, maxBuffer: maxOutput + 4096, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, "Worker must finish without being killed by the timeout");
  return result;
}

function corpus() {
  const cases: MixCase[] = [];
  const boundary = [-32768, -32767, -1001, -3, -1, 0, 1, 3, 1001, 32766, 32767];
  const a = frame((index) => boundary[index % boundary.length]);
  const b = frame((index) => boundary[(boundary.length - 1 - index % boundary.length)]);
  const volumes = [-10, 0, 49.99999999999999, 50, 50.00000000000001, 85, 100, 150];
  const fades = [-1, 0, 0.49999999999999994, 0.5, 0.5000000000000001, 1, 2];
  for (const volume of volumes)
    for (const progress of fades)
      for (const second of [null, b]) cases.push({ a, b: second, progress, volume });
  // Exercise every signed 16-bit sample, including the final sample of each frame.
  for (let start = 0; start < 65536; start += FRAME_BYTES / 2) {
    const sweep = frame((index) => (start + index) % 65536 - 32768);
    for (const volume of volumes) cases.push({ a: sweep, b: null, progress: 0, volume });
  }
  let seed = 0xa17e2026;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  for (let index = 0; index < 128; index++) cases.push({
    a: frame(() => (next() & 0xffff) - 32768),
    b: frame(() => (next() & 0xffff) - 32768),
    progress: next() / 0xffffffff,
    volume: next() % 121 - 10,
  });
  return cases;
}

test("Rust stream PCM matches the actual TypeScript mixer over a deterministic corpus", (t) => {
  assert.equal(FRAME_BYTES, 3840);
  const cases = corpus();
  // Repeated and maximum IDs are valid correlation tokens, not sequence counters.
  const id = (index: number) => index % 19 === 0 ? 0xffffffff : index % 7 === 0 ? 0 : index;
  const result = run(Buffer.concat(cases.map((input, index) => request(input, id(index)))), cases.length * packetBytes);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stderr.length, 0);
  assert.equal(result.stdout.length, cases.length * packetBytes);
  cases.forEach((input, index) => verify(result.stdout.subarray(index * packetBytes, (index + 1) * packetBytes), input, id(index)));
  t.diagnostic(`${cases.length} complete frames and ${cases.length * FRAME_BYTES / 2} samples compared byte for byte`);
});

test("fragmented requests get complete replies before stdin closes", { timeout: 15_000 }, async () => {
  const child = spawn(executable, ["--stream"], { timeout: 10_000, windowsHide: true });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  // Observe early process failure even while waiting on its stdout iterator.
  void closed.catch(() => {});
  child.stdin.on("error", () => {});
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096); });
  const output: AsyncIterator<Buffer> = child.stdout[Symbol.asyncIterator]();
  try {
    const cases = corpus().slice(-12);
    for (const [index, input] of cases.entries()) {
      const bytes = request(input, index);
      const parts = [...bytes.subarray(0, requestBytes)].map((byte) => Buffer.from([byte]));
      parts.push(bytes.subarray(requestBytes, requestBytes + 1), bytes.subarray(requestBytes + 1, -1), bytes.subarray(-1));
      for (const part of parts)
        await new Promise<void>((resolve, reject) => child.stdin.write(part, (error) => error ? reject(error) : resolve()));
      let packet = Buffer.alloc(0);
      while (packet.length < packetBytes) {
        const chunk = await output.next();
        assert(!chunk.done, `Worker exited before replying: ${stderr}`);
        packet = Buffer.concat([packet, chunk.value]);
        assert(packet.length <= packetBytes, "One request must not produce extra bytes or messages");
      }
      verify(packet, input, index);
    }
    child.stdin.end();
    assert((await output.next()).done, "Clean EOF must not produce extra output");
    assert.equal(await closed, 0, stderr);
    assert.equal(stderr, "");
  } finally {
    child.kill("SIGKILL");
    await closed.catch(() => {});
  }
});

test("malformed requests stop after prior valid replies without desynchronizing the stream", () => {
  const input: MixCase = { a: frame(() => -1001), b: null, progress: 0, volume: 50 };
  const mutate: Array<(header: Buffer) => void> = [
    (header) => { header[0] = 0; },
    (header) => { header[4] = 2; },
    (header) => { header[5] = 0x81; },
    (header) => { header[6] = 2; },
    (header) => { header[7] = 1; },
    (header) => { header.writeUInt32LE(0xffffffff, 12); },
    (header) => { header.writeDoubleLE(NaN, 16); },
    (header) => { header.writeDoubleLE(Infinity, 24); },
  ];
  for (const change of mutate) {
    const invalid = request(input, 42);
    change(invalid);
    const result = run(Buffer.concat([request(input, 41), invalid, request(input, 43)]));
    assert.equal(result.status, 1);
    assert(result.stderr.length > 0 && result.stderr.length < 4096);
    verify(result.stdout, input, 41);
  }
});

test("EOF is clean only between whole requests", () => {
  const empty = run(Buffer.alloc(0));
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout.length + empty.stderr.length, 0);
  const input: MixCase = { a: frame(() => 1), b: frame(() => -1), progress: 0.5, volume: 100 };
  const full = request(input, 0);
  for (const length of [1, 31, 32, 33, 32 + FRAME_BYTES, full.length - 1]) {
    const result = run(full.subarray(0, length));
    assert.equal(result.status, 1, `Truncated request length ${length} must fail`);
    assert.equal(result.stdout.length, 0);
    assert(result.stderr.length > 0);
  }
});
