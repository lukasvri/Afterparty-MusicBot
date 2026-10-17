# Rust audio research on dev

This page describes an **experiment**, not a production Rust rewrite.

Afterparty's live audio engine remains TypeScript/Node.js with FFmpeg for decoding
and Opus encoding. The prototype in `experiments/rust-audio` mixes 20 ms
frames of 48 kHz, stereo signed 16-bit PCM audio with volume and crossfade.
It includes an offline benchmark and an opt-in binary stdin/stdout worker,
with a versioned protocol for testing the cost and reliability of process IPC.
It deliberately uses synthetic data, no Discord connection, no credentials
and no shared production databases.

## Branches and checks

- `main` remains the default branch for TypeScript development, fixes and new
  application features through reviewed PRs.
- `dev` is the separate branch for isolated Rust testing, originally based on
  the latest `main`. It is not the staging branch for normal TypeScript work
  or a Rust compiler channel. Existing `nightly` and Rust branches are preserved.
- Focused `experiment/rust-*` branches target `dev` through PRs, where Rust checks run for
  changes in this experiment. CI does not start the bot or deploy artifacts.
- Before reviewing or editing code, fetch the canonical repository's `main`
  and `dev`, branch from current `dev` and incorporate the latest remote `main`
  into the task branch. Before submitting the PR, fetch both branches again,
  incorporate any newer `main` and rerun affected checks on the combined result.
  Preserve existing Rust work when incorporating updates, as required by
  [source freshness](../AGENTS.md#source-freshness).
- CI checks formatting, Clippy, locked tests and release builds on Linux and
  Windows with both the declared minimum Rust 1.85.0 and current stable. Each
  combination also runs the TypeScript parity harness against its release binary.
- Any future adoption of Rust in `main` needs a separate owner decision,
  focused review and validation. There is no automatic promotion from `dev`
  or `nightly` to `main`.

The prototype was copied from `nightly` commit
`75f56a4617aae1914601d708e634a84147d8bc39`, including the rounding parity
fix and minimum-toolchain checks from `2c864e5e7e1116f5e493703ca10761f7e1533684`.
That transfer preserved the Rust source and Cargo files. Subsequent work on
`dev` adds the stream worker described below. This does not merge the old branch
history into `main` or remove the original experiment.

## Running on a Linux development checkout

The Linux laptop hosts the production bot as well. Use a **separate checkout**,
not the active deployment directory. Never run the experiment with Core
credentials or the production data path.

```bash
git clone --branch dev https://github.com/lukasvri/Afterparty-MusicBot.git ~/Afterparty-Rust-Dev
cd ~/Afterparty-Rust-Dev
rustup toolchain install stable --profile minimal --component rustfmt --component clippy
cargo fmt --manifest-path experiments/rust-audio/Cargo.toml --all -- --check
cargo clippy --manifest-path experiments/rust-audio/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path experiments/rust-audio/Cargo.toml --locked
cargo build --manifest-path experiments/rust-audio/Cargo.toml --release --locked
cargo run --manifest-path experiments/rust-audio/Cargo.toml --release --locked -- --bench
```

Do not benchmark while production playback is active. Local benchmark results
measure **only synthetic PCM mixing**, not FFmpeg, providers, Discord latency,
network behaviour or complete end-to-end CPU consumption. Compare against a
matching TypeScript implementation on the same machine before evaluating a
native replacement. Follow `AGENTS.md` and production backup/rollback rules
for any future integration.

## Offline stream worker

The release executable accepts exactly one mode, `--bench` or `--stream`.
`--bench` retains the synthetic in-process benchmark. `--stream` reads binary
requests from stdin and writes binary replies to stdout. Diagnostics go only
to stderr. It does not discover Core, start FFmpeg, open a network listener or
connect to Discord. No production code launches this executable.

On Linux, a previously generated fixture can be run as follows:

```bash
experiments/rust-audio/target/release/afterparty-rust-audio --stream < requests.pcmproto > replies.pcmproto
```

The TypeScript test harness supplies fixtures directly through child
process pipes. Sending raw PCM without the protocol header is an error.

With Node.js 24.17+ installed, run the cross-language checks after the release
build. These commands only install the locked Core dependencies and invoke
offline tests. They do not start the bot:

```bash
npm --prefix services/core ci --omit=peer --ignore-scripts --no-audit --no-fund
node services/core/node_modules/typescript/bin/tsc --project experiments/rust-audio/tsconfig.json --noEmit
node --test --test-timeout=30000 experiments/rust-audio/stream-parity.test.ts experiments/rust-audio/worker-client.test.ts experiments/rust-audio/benchmark-suite.test.ts
```

The harness selects the platform's release executable, including `.exe` on
Windows. Set `RUST_AUDIO_BIN` to test an explicit local build instead. It imports
the actual `services/core/src/audio.ts` mixer; no reference implementation is
copied into the experiment.

### Protocol version 1

All multibyte numbers are little-endian. A PCM frame is exactly 3,840 bytes:
960 stereo sample pairs, signed 16-bit integers at 48 kHz. There is no padding,
compression, text encoding, transport checksum or negotiated audio format.

Each request starts with a 32-byte header:

| Byte offset | Size | Value |
| --- | --- | --- |
| 0 | 4 | ASCII `APCM` |
| 4 | 1 | Version `1` |
| 5 | 1 | Mix opcode `1` |
| 6 | 1 | Flags: `0` for one frame, `1` for two frames. All other bits are invalid. |
| 7 | 1 | Reserved, must be zero |
| 8 | 4 | Opaque unsigned request ID, echoed without reinterpretation |
| 12 | 4 | Payload length: `3840` with flags `0`, `7680` with flags `1` |
| 16 | 8 | Finite IEEE 754 binary64 crossfade progress |
| 24 | 8 | Finite IEEE 754 binary64 volume percentage |

The header is followed immediately by frame A and, when flag 1 is set, frame B.
The declared length is checked before any payload is read; it never controls
an allocation. Progress is clamped to `[0, 1]`, volume to `[0, 100]`. Without B,
progress has no effect on the samples but must still be finite. Mixing preserves
Core's `Math.round` rule, including negative half-way values and adjacent floats.

A successful response has a 16-byte header followed by one 3,840-byte PCM frame:

| Byte offset | Size | Value |
| --- | --- | --- |
| 0 | 4 | ASCII `APCM` |
| 4 | 1 | Version `1` |
| 5 | 1 | Mix-result opcode `129` (`0x81`) |
| 6 | 2 | Both bytes zero |
| 8 | 4 | Request ID copied from the corresponding request |
| 12 | 4 | Payload length `3840` |

Requests and replies remain in order. IDs may repeat and have no effect on
mixing, sequencing, deduplication or permissions. A caller must check the whole
response header and exact payload before using the PCM. A process crash or I/O
failure may leave a partial response, which must be discarded.

### Failure, shutdown and memory bounds

EOF before the first byte of the next request exits successfully. EOF inside a
header or payload is truncation and exits with status `1`. Invalid magic,
version, opcode, flags, reserved byte, length or nonfinite control also exits
with status `1`. There is no response for a rejected request and no attempt to
resynchronize or continue after it. Earlier complete replies remain valid.
Unknown, missing or extra CLI arguments return usage on stderr and status `2`.

The worker completes and flushes each reply before requesting the next header.
It keeps fixed arrays for two inputs, one output and headers, with no growing
request queue or payload-length allocation. The pipe, Rust standard input and
the parent process can have their own buffering. A blocked output consumer
therefore stops further worker processing after those bounded buffers fill.
Callers must drain stdout while sending input, respect their own writable
backpressure and cap outstanding requests. Writing an unbounded batch before
reading responses can deadlock two full pipes even though the worker itself
uses bounded memory.

Short reads, short writes and interrupted I/O calls are handled; other I/O
errors terminate processing. The worker has no internal deadline or control
channel. A producer that leaves an incomplete request open, or a consumer that
never drains stdout, can block it indefinitely. The parent owns timeout,
cancellation and process cleanup. Closing stdin requests graceful completion
after complete queued requests; stopping a blocked worker requires terminating
the child. The isolated parent below now exercises these responsibilities. It remains an
experiment, not a production recovery strategy.

### Validation and next decision

Rust unit tests cover sample parity, fragmented and interrupted I/O, malformed
and truncated requests, opaque IDs, clean EOF and propagation of read/write
failures. An observed reader/writer test verifies that the next request is not
read before the prior response is flushed, including failed writes and flushes.
CLI integration tests exercise the actual executable, binary-only stdout and
exit codes. The TypeScript harness provides comparison against Core's mixer
through real process pipes; it remains under `experiments/rust-audio`.
Its deterministic corpus compares 520 complete frames, or 998,400 signed
samples, covering all 65,536 possible sample values, saturation limits,
negative half-way rounding, adjacent floating-point controls and seeded random
crossfades. Separate checks cover fragmented requests with stdin still open,
reply correlation and order, malformed headers and clean versus truncated EOF.
The subprocess harness imposes a 10-second timeout and bounds captured output.

This establishes an inspectable process boundary for further measurement. The
bounded parent and repeated offline suite below now measure startup, concurrent
synthetic guilds, tail latency and optional FFmpeg/Opus stages, and exercise
failure recovery. They do not establish a full Discord audio improvement.
Provider decoding, paced real-time playback, simultaneous process-tree memory,
Rust child CPU and live Discord behavior remain outside those measurements.
Keep TypeScript as the production path until a separate adoption review.


## Bounded parent and process lifecycle

`experiments/rust-audio/worker-client.ts` is an offline TypeScript parent for the
Rust executable. Production Core does not import or launch it. It allows one
outstanding request, rejects concurrent requests instead of growing a queue,
validates full response headers, IDs and exact frame sizes, and caps stored
stderr at 4 KiB. The one pending request bounds submitted input to 7,712 bytes
and accumulated reply data to 3,856 bytes. Node and OS pipe buffers are additional.

Each request has a configurable deadline (default 1 second), including child
startup for the first request. Cancellation, malformed output, stream errors,
spawn failure, unexpected exit and deadline expiry terminate the child. Pending
calls reject only after the child's `close` event confirms process exit and pipe
closure. `close()` drains an idle worker through stdin EOF, with forced
termination if it ignores EOF; closing during a request cancels that request.
Timers and abort listeners are removed on completion. Pre-aborted or locally
invalid inputs leave a healthy worker reusable.

Failure is terminal. To retry, explicitly construct a new parent; there is no
automatic replay, process restart or production fallback. The Rust worker spawns
no descendants. This parent terminates only its direct child, and is not a
process-tree supervisor for FFmpeg or any future subprocess pipeline.

The parent selects an explicit `executable` option first, then `RUST_AUDIO_BIN`,
then the platform-specific release artifact. The parity harness, lifecycle suite
and benchmark therefore all support an alternate local build through
`RUST_AUDIO_BIN`; an explicit executable still controls synthetic test children.
Isolated process tests verify precedence without changing the test runner's
environment. This is an offline experiment fix and does not change the product
version or the production website's patch notes.

The lifecycle tests run both real Rust parity requests and synthetic child
processes that hang, ignore EOF, crash, truncate replies, flood output or send
invalid headers/IDs. They verify that rejected requests have reaped the child,
that concurrent work is bounded, and that cancellation and repeated shutdown
complete. Linux and Windows CI run the same harness on Rust stable and 1.85.0.

## Measuring the process boundary

After building the release executable and installing Core dependencies:

```bash
node experiments/rust-audio/benchmark.ts 5000
```

This uses the actual Core TypeScript mixer and a persistent Rust worker on the
same synthetic two-frame crossfade. It warms each path with 500 frames, verifies
byte parity before measurement, then reports 5,000 serial calls per path with
wall time, throughput, per-call p50/p95/p99/max latency, first-reply startup cost
and **parent-only** CPU time. Child CPU is excluded from the reported CPU field;
throughput and latency include IPC and Rust execution. The benchmark has no
performance pass/fail threshold because shared runners are noisy. It is an
inspectable measurement, not proof of reduced whole-pipeline CPU or latency.

A serial IPC call includes allocation, copies, protocol validation, pipe I/O,
Rust mixing and event-loop scheduling. Compare this total against the 20 ms
frame budget and against TypeScript before proposing adoption. In-process Rust
mixing speed by itself cannot establish a useful production improvement.

### Observed cloud run, 17 October 2026

One Linux x64 shared-runner observation used Node v24.19.0, Rust stable 1.99.1
release build and an AMD EPYC 9V74 CPU, with 20,000 frames after warmup:

| Metric | Core TypeScript | Persistent Rust IPC |
| --- | ---: | ---: |
| Wall time | 836.24 ms | 1,108.57 ms |
| Frames/second | 23,916.7 | 18,041.2 |
| Per-call p50 | 0.0338 ms | 0.0356 ms |
| Per-call p95 | 0.0635 ms | 0.0874 ms |
| Per-call p99 | 0.1061 ms | 0.4089 ms |
| Maximum call | 10.9614 ms | 8.2640 ms |
| Parent CPU | 781.41 ms | 597.38 ms |

Rust's process startup through its first reply took 8.789 ms. The IPC path took
about 33% more total wall time than TypeScript in this run. Parent CPU excludes
Rust child execution and cannot establish a CPU saving. This single synthetic
shared-runner observation supports keeping the current TypeScript production
path; it does not predict concurrent-guild or real Discord performance. Rerun
the command on the intended host with production playback stopped before using
these numbers for a decision.

## Repeated concurrent-guild and FFmpeg measurements

The opt-in `benchmark-suite.ts` complements the original serial benchmark. Run
from a separate checkout after the locked Core dependency install and Rust
release build:

```bash
node experiments/rust-audio/benchmark-suite.ts 5000 3 1,4,16 500
node experiments/rust-audio/benchmark-suite.ts 5000 3 1,4 500 copy
node experiments/rust-audio/benchmark-suite.ts 5000 3 1,4 500 opus
```

Arguments are frames **per guild**, repeat count, distinct guild counts, warmup
frames per guild and the optional FFmpeg stage (`none`, `copy` or `opus`). Bounds
are 100 to 100,000 frames, 1 to 10 repeats, up to four guild counts between 1 and
16, and 1 to 1,000 warmup frames. Defaults are `1000 3 1,4,16 100 none`.
`RUST_AUDIO_BIN` selects the actual release worker; `FFMPEG_PATH` selects a local
FFmpeg executable. `RUSTC_PATH` can provide compiler metadata when `rustc` is not
on PATH. JSON reports include OS, CPU model, logical CPUs, Node and available
Rust/FFmpeg versions, the measured worker's SHA-256 and every raw repetition.
They do not read credentials or private host state.

Each implementation and repeat runs in a fresh Node process. Order alternates
TS/Rust then Rust/TS to reduce consistent order bias. Every guild has distinct,
deterministic PCM fixtures, with byte parity checked before measurement and on
the first and last measured frames. Both paths receive the same warmup and batch
schedule. Rust uses one persistent worker per synthetic guild, with only one
outstanding request per worker. A batch waits for all guilds before the next
batch, and yields one event-loop turn on both paths. There is no growing request
queue. A failed child or stage aborts the run and reaps every started child.
The outer 120-second per-run deadline and CLI cancellation first send an IPC
abort request and wait for normal cleanup. After a two-second grace period,
the supervisor terminates its own measurement process tree with Windows
`taskkill /T /F` or its isolated POSIX process group. A timeout is a failed
measurement, never a partial success. Synthetic regressions verify cooperative
cleanup and forced cleanup of a child that ignores cancellation.

The optional stage starts one FFmpeg process per guild inside the timed region,
continuously drains output and caps retained diagnostics at 4 KiB. Each writer
awaits one frame's write callback before submitting another. `copy` passes PCM
through FFmpeg without encoding, exposing process startup, input probing, pipes
and scheduling. `opus` sends identical mixed PCM through FFmpeg `libopus` at
192 kbit/s with Core's current audio, compression, VBR, frame, page and flush
settings. It uses Core's input probe limits too. The experiment drains the Ogg
output directly rather than reproducing Core's demuxer and Discord transport.
EOF, final output drain and process exit are included in total elapsed time;
submission time and final-flush time are also reported separately. The copy
stage must emit exactly the submitted PCM byte count, and Opus must emit output.

Interpret metrics within their explicit scope:

- Throughput includes the complete chosen synthetic pipeline, including final
  FFmpeg flush. Node startup, Rust worker startup and mixer warmup are outside
  this timed region. Startup through the first Rust reply is measured separately
  before warmup. Child process import/launch cost is not a TypeScript startup
  comparison.
- p50/p95/p99/max run from a common batch submission to each guild's completed
  mix or accepted FFmpeg stdin write. This includes event-loop waiting behind
  other guilds, but does not measure when an encoded packet or audible sample
  reaches Discord. Batch latency and batches above 20 ms are also reported.
- These are saturated batches, not a paced 50 Hz playback simulation. A
  scheduling turn is included on both paths; GC, OS scheduling and pipe stalls
  remain part of observed latency. A shared development machine is noisy.
- Parent CPU excludes Rust and FFmpeg child CPU. FFmpeg's own `-benchmark`
  diagnostic supplies its cumulative CPU when available. Rust child CPU is not
  measured, so a parent-only reduction cannot establish a total CPU saving.
- Parent RSS is Node's process-lifetime high-water mark. Rust high-water RSS is
  read after timing using Linux `VmHWM` or Windows `PeakWorkingSet64`. FFmpeg
  reports its own maximum RSS when available. Unsupported values are null with
  a reason rather than zero. These peaks include startup/warmup and must not be
  added together as if they were a simultaneous process-tree peak.
- Do not subtract independent p99s or CPU fields to claim isolated Rust mixing,
  IPC-copy or codec CPU. The direct TS, Rust IPC, FFmpeg copy and Opus conditions
  expose aggregate boundary costs. Source/provider decoding and live scheduling
  need separate evidence before adoption.

The regression suite runs bounded real TS/Rust subprocess comparisons, verifies
order and report structure, rejects unbounded controls, and verifies cleanup
when FFmpeg cannot start. When FFmpeg is installed it also runs real concurrent
copy and Opus stages through EOF. The latter explicitly skips when FFmpeg is
unavailable. Stable Linux and Windows CI upload raw PCM measurement reports for
14 days; timings have no performance pass/fail threshold. Existing Rust minimum
toolchain, protocol parity and lifecycle checks remain required.

### Experimental patch notes

- Added repeatable, isolated TS/Rust comparisons with bounded synthetic guild
  concurrency, per-worker startup, batch/request tail latency and process peak
  memory fields.
- Added opt-in FFmpeg PCM-copy and Opus pipeline conditions with bounded writes,
  output draining, final-flush timing and child cleanup.
- Added benchmark contract/lifecycle regression coverage and stable-toolchain
  CI measurement artifacts. Existing production audio code is unchanged by the
  benchmark itself.
- Carried the reviewed PR #55 queue-undo source regression fix into this `dev`
  checkout: a manually re-added radio suggestion keeps its manual selection when
  undo restores the original slot. ID and recording exclusions are preserved.
  Product release records remain in that mainline PR rather than being copied
  into the Rust experiment.
- These notes cover offline research on `dev`. No product version change,
  production website patch note, Rust adoption, deployment or hearing claim is
  implied. Owner approval and a separate reviewed change remain required for
  production use.

### Validation scope, 17 October 2026

On the Windows development checkout, Rust stable 1.99.1 passed formatting,
Clippy with zero warnings, the locked release build, 18 library tests and four
CLI tests. The combined TypeScript parity, lifecycle and benchmark suite passed
20 tests, including actual FFmpeg copy/Opus pipelines and both supervisor
timeout cleanup paths. Website lint, both application typechecks, all 90 website
unit tests, release validation and the production website build passed.

The required `check:all` command was attempted, but the Windows Python runtime
cannot import POSIX `fcntl` in four existing deployment test modules. Running
the remaining commands explicitly produced 251 passing Core tests and one
existing Windows-incompatible shebang fixture failure in the stalled-decoder
test (`ENOENT`). Actual FFmpeg source/crossfade/stereo-Opus tests passed. The
checkout's generated changelog needed local LF normalization for equality tests;
its generated content and release version did not change. These are reported
limitations, not a passing full check. Linux CI must validate the deployment
suite and POSIX decoder fixture before review is complete. No live Discord or
hearing claim follows from these automated results.

### Observed repeated Windows run, 17 October 2026

The [raw measurement record](../experiments/rust-audio/measurements/2026-10-17-windows.json)
contains all 42 runs, runtime/binary metadata, throughput, CPU, startup, latency
and process memory fields. The machine used Windows x64 build 10.0.26300, an
Intel Core Ultra 7 255H (16 logical CPUs), Node 24.19.0, Rust 1.99.1 GNU release
build and FFmpeg 9.0.2. Other task checks were paused during capture, but OS
scheduling, thermal state and background activity were uncontrolled.

Each condition used 5,000 frames per guild, 500 warmup frames and three fresh
process repetitions with alternating implementation order. Ranges below are
the minimum and maximum across those three observations, not confidence
intervals. The selected guild count multiplies the total number of frames.

| Timed pipeline | Guilds | TS elapsed ms | Rust elapsed ms | TS request p99 ms | Rust request p99 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| PCM mixer | 1 | 103.45 to 123.65 | 231.15 to 234.47 | 0.036 to 0.053 | 0.161 to 0.166 |
| PCM mixer | 4 | 372.72 to 398.23 | 406.43 to 487.73 | 0.173 to 0.191 | 0.298 to 0.318 |
| PCM mixer | 16 | 1555.95 to 1593.27 | 1440.22 to 1505.52 | 0.760 to 0.773 | 1.017 to 1.120 |
| Mixer and FFmpeg PCM copy | 1 | 189.03 to 210.96 | 306.41 to 343.44 | 0.071 to 0.103 | 0.199 to 0.209 |
| Mixer and FFmpeg PCM copy | 4 | 591.69 to 617.64 | 583.64 to 678.71 | 0.264 to 0.278 | 0.488 to 0.546 |
| Mixer and FFmpeg Opus | 1 | 540.38 to 554.19 | 526.01 to 543.71 | 1.324 to 1.346 | 0.862 to 0.937 |
| Mixer and FFmpeg Opus | 4 | 686.59 to 693.55 | 703.64 to 725.99 | 0.383 to 0.460 | 0.597 to 0.643 |

The 16-guild PCM case completed faster with parallel Rust workers, but its
request p99 was higher. Parent lifetime peak RSS was 94.58 to 94.96 MiB for TS
and 143.57 to 144.45 MiB for Rust IPC, plus about 5.1 MiB lifetime peak for each
Rust worker. Rust startup through the first reply across the full corpus ranged
from 24.69 to 45.85 ms and is outside the table's timed region.

The single-guild Opus elapsed ranges overlapped; the four-guild Rust/Opus
pipeline took longer in all three observations. FFmpeg's own CPU in the
single-guild TS conditions was 47 to 63 ms for PCM copy versus 547 to 625 ms
for Opus. This shows a substantial codec cost in this synthetic workload, while
the PCM process boundary does not provide a consistent complete-pipeline gain.
There were no PCM-only batches above 20 ms; each FFmpeg run had one, including
startup effects. None of these are real-time deadline or listening results.

**Recommendation: retain TypeScript in production.** These measurements support
continued offline research only if a concrete bottleneck warrants it. They do
not establish reduced total CPU, lower simultaneous whole-tree memory, better
provider behavior or improved Discord sound. A Rust adoption proposal would
still need total child CPU, paced workload/host measurements and separate owner
review rather than promotion of this experiment into `main`.
