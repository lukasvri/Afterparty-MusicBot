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

The release executable accepts exactly one mode: `--bench`, `--stream`, the
explicit offline control `--echo-stream` or the separate `--batch-stream`
experiment described below.
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
node --test --test-timeout=30000 experiments/rust-audio/stream-parity.test.ts experiments/rust-audio/worker-client.test.ts experiments/rust-audio/benchmark-suite.test.ts experiments/rust-audio/process-cpu.test.ts experiments/rust-audio/batch-client.test.ts experiments/rust-audio/batch-benchmark.test.ts experiments/rust-audio/paced-client.test.ts experiments/rust-audio/paced-benchmark.test.ts
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
Provider decoding, simultaneous process-tree memory and live Discord behavior
remain outside those measurements. The follow-up profiling section adds owned
Rust process CPU counters and explicitly synthetic paced scheduling.
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
frames per guild and the optional FFmpeg stage (`none`, `copy` or `opus`). Two
further optional arguments select cadence (`saturated` or `paced`) and a
PCM-only protocol control (`mix` or `echo`). Bounds
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
- Saturated batches are the default. Optional paced batches use common 20 ms
  deadlines, with completion and scheduling-lag metrics described below. GC,
  OS scheduling and pipe stalls remain part of observed latency. A shared
  development machine is noisy.
- Parent CPU excludes Rust and FFmpeg child CPU. The follow-up counters below
  add owned Rust CPU and a pipeline CPU sum when all components are available.
  A parent-only reduction cannot establish a total CPU saving.
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

**Recommendation at this snapshot: retain TypeScript in production.** These measurements support
continued offline research only if a concrete bottleneck warrants it. They do
not establish reduced total CPU, lower simultaneous whole-tree memory, better
provider behavior or improved Discord sound. A Rust adoption proposal would
still need total child CPU, paced workload/host measurements and separate owner
review rather than promotion of this experiment into `main`. The follow-up below
addresses the first two with explicit measurement limits.

## Follow-up: process CPU, protocol control and paced scheduling

The suite now brackets its measured region with counters for the Rust child
PIDs it owns. Linux reads process user/system ticks from
[`/proc/<pid>/stat`](https://www.man7.org/linux/man-pages/man5/proc_pid_stat.5.html),
converted using `getconf CLK_TCK`. Windows reads
[`TotalProcessorTime`](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.totalprocessortime),
which includes user and privileged CPU. Probes run outside the latency region
while every Rust worker is idle; their own process CPU is excluded. Both TS and
Rust also probe the supervisor PID and discard that counter, so the control
receives the same out-of-band helper/startup pause after warmup.

`rustChildCpuMs` is the before/after aggregate for the measured workload.
`rustLifetimeCpuMs` additionally includes worker startup and warmup up to the
last probe. `pipelineCpuMs` adds parent CPU, measured Rust child CPU and FFmpeg's
own benchmark CPU only when every required component is available. Missing,
reset or incomplete counters produce null instead of a partial total. Linux
reports its clock-tick unit, commonly 10 ms; Windows TimeSpan units are
0.0001 ms. These are `counterUnitMs` values, not measured effective precision.
Actual scheduler CPU accounting can be substantially coarser and its practical
precision is not established by this harness.
Small differences and short runs cannot support a CPU-saving claim.

```bash
# Rotate TS, Rust mixing and Rust protocol-only control in fresh processes.
node experiments/rust-audio/benchmark-suite.ts 10000 3 1,4 500 none saturated echo
# Same mixer-to-Opus pipeline, with owned child CPU included.
node experiments/rust-audio/benchmark-suite.ts 5000 3 1,4 500 opus
# Common 20ms deadlines, bounded one-frame work per guild.
node experiments/rust-audio/benchmark-suite.ts 100 3 1,4 100 none paced
node experiments/rust-audio/benchmark-suite.ts 100 3 1,4 100 opus paced
```

`--echo-stream` uses the same protocol-v1 parser, exact input sizes, request IDs,
validation, first-frame copy, reply framing and flush/EOF behavior, but returns
frame A unchanged instead of mixing samples. The normal parent still selects
`--stream`. The suite checks echo output against A, rotates all three conditions
across repetitions, and disallows echo with an encoder because different PCM
would make codec comparisons invalid. This measures the aggregate transport,
validation, copying and scheduling boundary; it does not isolate a memory-copy
instruction cost. Do not subtract independent p99 values to infer mixer latency.

Paced runs use a common deadline grid of `start + frame * 20 ms`, rather than
sleeping 20 ms after each completion. They allow only one outstanding frame per
guild and wait for the entire batch before issuing another. Late batches catch
up sequentially without growing a queue. `scheduleLag` measures start lateness;
`scheduledLatency` measures completion or accepted encoder stdin write relative
to the scheduled frame time; `missedScheduledDeadlines` counts batches completing
after the next deadline. Runs are capped at 2,000 frames per guild to remain
within child/supervisor deadlines. These are synthetic scheduling/pipe metrics,
not packet delivery, provider decoding, network or audible Discord latency.

### Experimental patch notes for this follow-up

- Added owned Rust child CPU counters, counter-unit metadata and explicit
  null handling before calculating complete measured pipeline CPU.
- Added an explicit protocol-only echo control and common-deadline 50 Hz
  workload conditions without increasing outstanding work or buffer bounds.
- Added Linux counter parsing, live CPU, echo parity and paced-workload
  regression coverage. No production integration or product version change is
  implied; notes remain experimental on `dev`.
- Coalesced the fixed 16-byte header and 3,840-byte PCM response into one bounded
  `write_all` submission, followed by the existing mandatory flush before input.
  Short/interrupted writes remain supported; this does not promise a single OS
  syscall or atomic pipe delivery. A focused regression failed on the separate
  16-byte header submission and passed on the complete 3,856-byte packet.

### Follow-up measurements and decision

The [72-run record](../experiments/rust-audio/measurements/2026-10-17-cpu-protocol.json)
compares the same final harness against preserved before/after release binaries
on the Windows machine described above. Both binaries include the echo control;
only the after binary coalesces replies. The
[baseline source patch](../experiments/rust-audio/measurements/baseline-reply.patch)
reconstructs the separate-write behavior in an isolated experimental checkout.
It intentionally makes the new packet-submission regression fail and is not a
production patch. Each report records its actual binary SHA-256, configuration
and runtime metadata. Saturated reports label the counter unit consistently
after a metadata-only rename; measured values are unchanged.

There are three fresh-process repetitions per condition. PCM/echo uses 10,000
frames per guild and 500 warmup frames; Opus uses 5,000 and 500. Before and after
sets were captured in successive blocks of a coordinated quiet window using the
same benchmark harness source and arguments; the Rust reply implementation
differs as documented. TS/Rust/echo ordering rotated within each set. They were not
randomized or interleaved across binary versions. Ranges are observed minima
and maxima, not confidence intervals; OS scheduling, thermal state and actual
CPU-accounting precision remain uncontrolled.

| Saturated condition | TS pipeline CPU ms, after set | Rust pipeline CPU ms, before | Rust pipeline CPU ms, after |
| --- | ---: | ---: | ---: |
| PCM, 1 guild | 204 to 219 | 483.50 to 562.25 | 469.63 to 717.88 |
| PCM, 4 guilds | 798 to 938 | 1483.63 to 1656.63 | 1452.63 to 1781.88 |
| Mixer to Opus, 1 guild | 765 to 890 | 936.13 to 1016.50 | 890.88 to 953.50 |
| Mixer to Opus, 4 guilds | 3547 to 3627 | 4017.13 to 4344.63 | 3984.63 to 4484.38 |

For one-guild PCM after coalescing, Rust child CPU was 140.63 to 234.38 ms and
parent CPU 282 to 546 ms. The protocol-only echo condition still used 374.50 to
547.75 ms combined CPU versus TS mixing's 204 to 219 ms. This identifies a
substantial aggregate process-boundary cost on this host; it does not isolate
individual copies or justify subtracting independent tail percentiles.

The optimization guarantees one bounded writer submission instead of two. For
20,000 requests in the four-guild Opus condition, observed parent reply-data
events fell from 20,817 to 20,914 before to 20,181 to 20,210 after. These are
Node data events, not syscall counts. Elapsed ranges overlapped: 728.18 to
784.85 ms before and 756.40 to 775.35 ms after. Total CPU ranges also overlapped,
so no complete-pipeline CPU or elapsed-time saving is established. Keep the
coalescing as a bounded transport simplification, without claiming a production
speedup.

The after binary also ran three 100-frame, four-guild paced repetitions per
implementation for PCM and Opus. PCM had zero missed scheduled 20 ms batch
deadlines in all six runs. Scheduled completion p99 was 14.45 to 15.85 ms for
TS and 15.46 to 16.26 ms for Rust; start-lag p99 was already roughly 14 to 16 ms
on both paths. Opus had one missed batch per run with encoder startup included;
the report does not retain missed-frame indices, so startup is not a proved
cause. Its scheduled p99 ranges overlapped: 15.76 to 16.37 ms for TS and 15.66
to 16.29 ms for Rust. Short paced CPU observations varied widely and cannot
support a CPU-saving claim. No conclusion about a different host, network,
encoded-packet latency or audible playback follows.

**Retain TypeScript in production.** The missing Rust child CPU is now measured
within stated counter limits, and it removes the apparent parent-only saving
in these saturated conditions on this host. The process boundary remains a substantial
cost; coalescing does not establish a complete-pipeline improvement. Further
research should target a demonstrated host bottleneck and collect longer paced
observations or a lower-overhead integration boundary before proposing adoption.
No production code, product release version, website notes or deployment changed.

Follow-up validation: Rust formatting, Clippy with zero warnings, a locked
release build, 20 library tests and five CLI tests passed. Harness typechecking,
lint with zero warnings and all 25 TypeScript parity/lifecycle/CPU/benchmark
tests passed, including real FFmpeg and both timeout cleanup paths. Minimum
Rust 1.85 and Linux/Windows CI remain required; the local run used Rust 1.99.1.
The required full `check:all` was attempted again: lint passed, then the same
four existing POSIX `fcntl` deployment modules failed to import on Windows.
This is not a passing full check; Linux CI must validate that suite.

## Opt-in bounded batches

This experiment builds on the process-CPU profiling in
[PR #58](https://github.com/lukasvri/Afterparty-MusicBot/pull/58). The batch task
branch is stacked on that work; if the dependency is still open, review it
before treating the batch diff as independent. No Rust code is adopted into
production `main` by this experiment.

`--batch-stream` is explicit and uses separate `APBT` framing. Existing `APCM`
version-1 `--stream` requests and semantics are unchanged. The batch mode accepts
exactly 1, 4 or 8 complete PCM frames per request. Each frame retains its own
version-1 controls, optional second source and opaque ID. There is also an opaque
outer batch ID; IDs correlate replies, not permissions or deduplication.

Both outer request and reply headers are 16 bytes, little-endian:

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | ASCII `APBT` |
| 4 | 1 | Batch protocol version `1` |
| 5 | 1 | Request opcode `1`, reply opcode `129` |
| 6 | 1 | Frame count, exactly `1`, `4` or `8` |
| 7 | 1 | Reserved, zero |
| 8 | 4 | Opaque unsigned batch ID, echoed unchanged |
| 12 | 4 | Exact body length, excluding this outer header |

The request body contains consecutive complete version-1 `APCM` requests:
32-byte frame header, frame A and optional frame B. Their magic, version,
opcode, flags, fixed payload lengths and finite controls are all validated.
For count `N`, the declared body must be between `N * (32 + 3840)` and
`N * (32 + 7680)` bytes. The worker checks that bound before reading frame
headers, and checks the remaining declared budget before reading each body.
The actual frame sizes must consume the budget exactly; extra declared bytes
do not cause reads into another batch.

The reply body has `N` records, each containing the frame ID (4 bytes), exact
PCM length `3840` (4 bytes), then the mixed PCM. Every frame is parsed and mixed
into a fixed reply array before any reply bytes are submitted. An invalid or
truncated later frame therefore produces no successful partial batch. Complete
earlier batches remain valid. The whole reply is flushed before reading the
next batch header. Short/interrupted I/O remains supported, and any other I/O
or protocol failure ends the process without resynchronization.

The maximum request is **61,712 bytes** and the maximum reply **30,800 bytes**.
Rust uses fixed arrays, not payload-length allocations or a request queue.
The isolated `RustBatchWorker` parent permits only one outstanding batch and
caps the captured reply to the expected fixed size. It checks outer and every
per-frame ID/length before returning any frames. Returned storage is not reused
by later calls; submitted input is copied before returning to the caller.
stderr retention is limited to 4 KiB. Runtime and OS pipe buffering is additional.
Timeout, cancellation, malformed/oversized replies, stream errors and child exit
are terminal and reject only after child/pipe cleanup. A retry constructs a new
parent; there is no automatic replay, production fallback or integration.

### Comparing the batch boundary

After the locked Core dependency install and Rust release build:

```bash
node experiments/rust-audio/batch-benchmark.ts 8000 3 1,4 512
node experiments/rust-audio/batch-benchmark.ts 4000 3 4 512 opus
```

Arguments are frames per guild, repeats, guild counts, warmup frames per guild
and optional codec `none` or `opus`. Frames are bounded to 128 through 100,000,
repeats to 1 through 10, and guilds to up to four distinct counts from 1 to 16.
Frames and warmup must divide by eight; warmup is between 8 and 1,024 frames.

The five conditions are direct Core TypeScript, existing Rust version-1 IPC,
and batch IPC with sizes 1, 4 and 8. Every condition receives the same ordered,
deterministic eight-frame sequence per guild, including independent frame
controls, one/two-source requests, volume/fade bounds and negative-half rounding
controls. This is a synthetic mixture, not a measured production distribution.
Byte parity is checked against Core before measurement and on the first/last
measured ready block. Each path processes identical warmup frames.

Every eight-frame block is already fully available before processing starts.
TypeScript mixes those eight frames synchronously with no per-frame await in
the PCM-only condition. The version-1 parent awaits one request per frame;
batch parents await one request per 1, 4 or 8 frames. All paths yield once after
the entire shared ready block. Each guild has its own worker and at most one
pending request. Optional Opus uses the same bounded encoder writes and settings
as the earlier suite, drains output continuously, and includes final EOF/flush.

Fresh processes and rotated condition order reduce persistent history bias.
Reports include runtime/binary metadata, throughput, whole owned CPU when all
counters are available, parent peak RSS, IPC request/byte counts and observed
Node reply-data events. These are logical protocol counts, not syscall counts.
Direct mix invocations are reported separately from IPC requests. CPU probes
and their limitations follow the preceding process-CPU section.

`frameReadyLatency` measures each PCM frame's completion from the common
ready-block submission, including earlier work in that block. `callLatency`
measures a local mix or complete IPC request; requests with different frame
counts do different amounts of work and their tails must not be divided by N.
`blockLatency` covers the complete eight-frame block across guilds.
`framePipelineLatency` additionally includes accepted encoder stdin writes,
not encoded-packet or audible Discord latency.

### Latency tradeoff and live-input boundary

The measured ready-frame latency deliberately excludes waiting for future input.
For frames that arrive every 20 ms, gathering a full batch adds the following
delay before processing, independent of any IPC speedup:

| Batch size | Maximum added gathering delay | Delay by frame position |
| --- | ---: | --- |
| 1 | 0 ms | 0 |
| 4 | 60 ms | 60, 40, 20, 0 ms |
| 8 | 140 ms | 140, 120, 100, 80, 60, 40, 20, 0 ms |

The JSON reports this budget separately. It is not measured runtime latency and
is never added to a percentile as if it were an observed percentile. The harness
must not be described as improved 50 Hz or live playback: unknown future audio,
crossfade changes, volume changes and cancellation cannot simply be assumed
available ahead of time. Any production design would need an explicit buffering
policy, control latency limits and a separate owner-approved integration review.

### Ready-frame batch observations, 2026-10-17

The [45-run capture](../experiments/rust-audio/measurements/2026-10-17-batched-boundary.json)
contains three fresh-process repeats of all five conditions: PCM with 8,000
frames per guild at one and four guilds, then PCM-to-Opus with 4,000 frames per
guild at four guilds. Warmup was 512 frames per guild. The parent and sibling
agents paused heavy work during capture; host scheduling and thermal state were
not controlled. The artifact retains exact reports, commands, source hashes and
the actual Rust executable hash. It records Node 24.19.0, Rust 1.99.1 GNU,
Windows 10.0.26300, Intel Core Ultra 7 255H with 16 logical CPUs, and FFmpeg
9.0.2 for Opus. All conditions use the same input sequence and binary.

Ranges below are the minimum and maximum of three runs, not confidence
intervals. CPU is summed parent plus owned Rust plus optional FFmpeg time,
not wall time or a percentage. Windows counter units do not establish practical
measurement precision. Throughput is thousands of completed frames per second
across all guilds. Each p99 range contains the per-run p99, not a pooled p99.

PCM, one guild, 8,000 frames:

| Condition | Elapsed ms | kframes/s | Whole owned CPU ms | Ready-frame p99 ms | IPC requests |
| --- | ---: | ---: | ---: | ---: | ---: |
| TypeScript | 105.76–109.03 | 73.4–75.6 | 109.00–172.00 | 0.14–0.24 | 0 |
| Rust v1 | 354.69–377.35 | 21.2–22.6 | 422.00–483.75 | 0.75–0.80 | 8,000 |
| Batch 1 | 318.01–341.23 | 23.4–25.2 | 374.75–389.75 | 0.61–0.63 | 8,000 |
| Batch 4 | 204.43–240.77 | 33.2–39.1 | 219.50–327.50 | 0.55–1.07 | 2,000 |
| Batch 8 | 178.80–182.19 | 43.9–44.7 | 171.50–327.25 | 0.63–0.75 | 1,000 |

PCM, four guilds, 32,000 total frames:

| Condition | Elapsed ms | kframes/s | Whole owned CPU ms | Ready-frame p99 ms | IPC requests |
| --- | ---: | ---: | ---: | ---: | ---: |
| TypeScript | 392.92–425.91 | 75.1–81.4 | 405.00–563.00 | 0.57–0.70 | 0 |
| Rust v1 | 503.89–571.52 | 56.0–63.5 | 905.25–1156.38 | 1.35–1.49 | 32,000 |
| Batch 1 | 526.30–597.30 | 53.6–60.8 | 1157.50–1452.75 | 1.40–1.90 | 32,000 |
| Batch 4 | 451.28–483.11 | 66.2–70.9 | 859.00–1156.38 | 1.72–1.99 | 8,000 |
| Batch 8 | 386.22–414.94 | 77.1–82.9 | 655.00–811.75 | 1.67–1.82 | 4,000 |

PCM-to-Opus, four guilds, 16,000 total frames, including encoder startup and EOF:

| Condition | Elapsed ms | kframes/s | Whole owned CPU ms | Encoder-write frame p99 ms | IPC requests |
| --- | ---: | ---: | ---: | ---: | ---: |
| TypeScript | 630.65–647.16 | 24.7–25.4 | 3092.00–3295.00 | 1.83–1.87 | 0 |
| Rust v1 | 641.77–664.76 | 24.1–24.9 | 3720.38–4154.63 | 2.21–2.45 | 16,000 |
| Batch 1 | 645.37–674.43 | 23.7–24.8 | 3718.38–3952.00 | 1.93–2.33 | 16,000 |
| Batch 4 | 644.44–662.53 | 24.2–24.8 | 3453.75–3734.13 | 2.63–2.72 | 4,000 |
| Batch 8 | 640.91–684.04 | 23.4–25.0 | 3405.50–3813.38 | 2.70–3.30 | 2,000 |

The boundary change demonstrably reduces IPC requests by factors of four/eight
for ready inputs. At four-guild PCM, Node reply-data events fall from
32,010–32,038 for v1 to 4,001–4,003 for batch 8. This does not imply eight times
fewer syscalls: each request still transports the PCM, and Node events are not
syscalls. Request/reply bytes change only from 200,704,000/123,392,000 to
200,768,000/123,200,000. Extra batch framing adds some request bytes. Reported
direct TypeScript mix invocations remain 32,000. Batch 1 is a useful separate
protocol/control implementation comparison, not a pure Rust-kernel comparison;
it improves one-guild wall time here but worsens four-guild wall time and CPU.

Batch 8 improves ready PCM wall time and owned CPU relative to v1 in these
captures. It does not establish lower CPU than direct TypeScript: the
four-guild TypeScript CPU range is lower and does not overlap batch 8's, while
wall-time ranges overlap. One-guild CPU ranges overlap only narrowly. Ready-frame tails
at four guilds are also worse for batch 8 than v1 despite higher throughput.
Opus wall times overlap across every condition, and batch 8 retains more owned
CPU and worse encoder-write frame tails than TypeScript. Parent peak RSS at
four-guild PCM is 138.1–140.0 MiB for batch 8 versus 93.7–97.2 MiB for
TypeScript and 107.6–108.0 MiB for v1; this is process peak RSS, not a whole
pipeline memory total. Kernel-only cost, GC and parent protocol work are not
isolated by this comparison.

Retain TypeScript in production. The useful result is a bounded, byte-exact
offline path that lowers Rust crossing overhead when complete future work is
already available. The separate 60/140 ms gathering budget remains much larger
than these ready-frame tails and is absent from all measured tables. No live
playback, control-responsiveness or audible benefit is established. The fixture
mix differs from earlier fixed-control captures, so absolute numbers must not
be compared between those cohorts as a source-change speedup.

### Experimental patch notes for batching

- Added an explicit, separately framed batch worker for exactly 1/4/8 frames,
  preserving version-1 streaming and independent per-frame controls/IDs.
- Added bounded parent lifecycle, full-batch validation before publication,
  and byte-parity, ownership, fragmentation, malformed-last-frame and cleanup
  regressions. Invalid later input never publishes a successful partial batch.
- Added a five-condition ready-frame benchmark with owned CPU, tails and
  transport counts, keeping live accumulation costs separate from runtime.
- Added a stable-toolchain Linux/Windows batch diagnostic artifact alongside
  the existing suite artifact. Its 1,024-frame, one-repeat conditions validate
  the cross-platform harness; they have no performance threshold and do not
  establish repeatability or a production speedup.
- This remains an offline experiment stacked on the profiling work. No product
  version, production website patch note, release publication or deployment is
  part of the change.

Batch validation on the Windows development checkout passed Rust formatting,
Clippy with zero warnings, the locked release build, 26 library tests and six
CLI tests. Harness typechecking, lint with zero warnings and all 35 TypeScript
regressions passed, with no skips, including actual FFmpeg, both protocol
clients, OS CPU counters, fragmentation and child cleanup. The Rust CI matrix
retains Linux/Windows and minimum Rust 1.85 coverage; local execution used
Rust 1.99.1. Automated parity is not a listening result.

The required full `check:all` was also attempted on this branch. Repository-wide
lint passed with zero warnings, then the Python deployment suites stopped on
four import errors because Windows does not provide POSIX `fcntl`. Subsequent
steps in that command did not run; this is not a green full-suite result.
Those deployment tests require the Linux CI result. The focused Rust/harness
checks above ran independently and passed.

## Arrival-aware bounded batch experiment

The next offline stage supplies PCM at absolute `start + frame * 20 ms` arrival
times instead of assuming eight future frames are ready. `paced-client.ts`
owns at most eight queued inputs and one active request of at most eight frames.
It copies PCM and per-frame volume/crossfade controls at admission, publishes
independent output buffers only after backend validation, and rejects overflow.
No production Core module imports this adapter.

The target size is 1, 4 or 8. A full available target dispatches immediately;
otherwise the oldest queued frame's collection deadline permits the largest
supported available count. Remaining frames keep their own arrival deadlines.
`finish()` rejects new arrivals and drains existing tails as 8/4/1 without
padding or waiting for future input. `close()` rejects queued and active work,
aborts the active backend and suppresses late output. It waits at most one
second for backend settlement; the owner must independently close/reap a backend
that ignores cancellation. Tests exercise an actual Rust child and both fake
clock and stalled-backend controls.

`maxWaitMs` is a collection policy, not a hard end-to-end latency guarantee.
An active backend or a delayed event loop can exceed it. The hard memory bound
remains enforced; an overwhelmed run fails rather than silently dropping frames
or slowing its input clock. This models synthetic arrivals, not a real decoder.

```text
node experiments/rust-audio/paced-benchmark.ts 250 3 1,4 > paced-pcm.json
```

Five fresh-process conditions share the actual TypeScript reference mixer,
fixtures, bounded queue, absolute arrival grid, 16 single-frame warmup calls
and owned-process CPU probes: TypeScript; Rust v1; target 4 with an 80 ms
collection deadline; target 8 with 160 ms; and target 8 with a 10 ms deadline.
The longer deadlines allow full batches when scheduling permits; the short one
tests whether a responsive policy still amortizes crossings. Each synthetic
guild owns its own queue and Rust process. Repeats rotate condition order.

The report keeps scheduled-to-actual arrival lateness, actual arrival-to-dispatch
queue time, dispatch-to-validated-reply time and scheduled/actual arrival-to-reply
latency separate. It records actual 1/4/8 request counts, protocol bytes, Node
reply-data events, queue peaks, completed frames and missed 20 ms scheduled
completion targets per guild. Completion is a validated PCM reply through parent
dispatch; byte parity is checked immediately afterward for every frame in the
timed run. There is no encoder, provider or Discord output. The supplied
50 frames/s is offered load, not measured maximum throughput. Volume timing
measures completion of a new per-frame control snapshot; it cannot undo audio
already submitted and is not audible response latency.

CPU covers timed parent work and owned Rust counter deltas, with startup,
warmup and probe calls outside the parent interval. Child counters bracket that
interval and can include probe-edge work. Missing counters produce `null`;
nominal counter units do not establish practical precision. RSS is the parent
process's lifetime peak, not simultaneous whole-pipeline memory. Hardware,
runtime, source/binary hashes and exact command are included. Reports are
exploratory observations with uncontrolled host scheduling and thermal state.

### Experimental patch notes for paced arrivals

- Added an offline bounded arrival queue, per-frame control/buffer snapshots,
  supported partial draining and terminal cancellation with late-reply disposal.
- Added actual 20 ms input experiments separating collection, backend and
  scheduling delay, with exact PCM parity, owned CPU and observed batch counts.
- Added Linux/Windows, stable/minimum-toolchain regressions and short stable CI
  diagnostic artifacts without a performance threshold. CI samples are harness
  checks, not production capacity measurements.
- Production Core, Rust mixer/protocol source, product version and website notes
  are unchanged by this experimental step. Adoption still requires a separate
  owner decision and reviewed PR. No listening assistance, production account,
  merge, publication or deployment is part of this work.

### Paced PCM observations, 2026-10-18

The [30-run capture](../experiments/rust-audio/measurements/2026-10-18-paced-arrivals.json)
used clean implementation commit `093e247e75754f190bec745b05ed95881571c3f0`,
250 frames per guild, three fresh-process repeats and one/four guilds. It records
13 source hashes and the actual executable hash. All matched the measured files;
each run completed and verified every PCM frame, drained its queues, and stayed
within eight queued plus eight active frames per guild. A separate 100-frame
batch-8 smoke check completed before this capture and is not pooled into it.

The machine was Windows 10.0.26300, Intel Core Ultra 7 255H, 16 logical CPUs,
Node 24.19.0 and Rust 1.99.1 GNU. Other agents paused heavy work during capture;
host scheduling, power and thermal state were not controlled. Values below are
the minimum/maximum of three per-run values, not pooled percentiles or confidence
intervals. The scheduled input interval is 20 ms. CPU sums the timed parent and
owned Rust counters and excludes encoders and provider work.

Four guilds, 1,000 total verified frames per run:

| Condition | Actual arrival-to-reply p99 ms | Scheduled arrival-to-reply p99 ms | Owned CPU ms | IPC requests | Frames over 20 ms scheduled completion |
| --- | ---: | ---: | ---: | ---: | ---: |
| TypeScript | 0.68–1.04 | 15.74–16.30 | 235.00–485.00 | 0 | 0 |
| Rust v1 | 0.99–1.59 | 15.93–16.19 | 156.88–343.25 | 1,000 | 0 |
| Batch 4, 80 ms collection limit | 64.39–65.51 | 75.61–76.47 | 327.88–452.25 | 256 | 748 |
| Batch 8, 160 ms collection limit | 142.73–143.48 | 154.45–155.49 | 93.63–187.25 | 132 | 872 |
| Batch 8, 10 ms collection limit | 17.16–17.64 | 31.49–31.76 | 62.63–718.88 | 1,000 | 702–726 |

Each full-batch-4 run used 248 four-frame requests and eight single tail
requests across four guilds. Batch 8 used 124 eight-frame requests and eight
singles. The 10 ms policy used only singles in all six one/four-guild runs:
it did not amortize any IPC crossing. At one guild, actual-arrival reply p99
was 0.28–0.54 ms for TypeScript, 0.62–1.08 for Rust v1, 63.98–64.34 for
batch 4, 141.54–143.26 for batch 8 and 16.72–16.90 for the 10 ms policy.

Four-guild batch-8 dispatch-to-reply p99 was only 1.31–2.29 ms; most of its
observed delay was collection. The volume-snapshot reply p99 was 142.59–143.31
ms, compared with TypeScript's 0.63–0.97 ms. Scheduled/actual latency differences
also expose Windows timer scheduling: arrival-lateness p99 was roughly 15–16 ms,
and the 10 ms policy's queue-wait p99 was 16.63–16.83 ms. A nominal collection
limit must not be sold as a hard scheduler or completion guarantee.

Batch 8 had lower observed owned CPU than TypeScript in this four-guild cohort,
at the cost of about 140 ms accumulation. The shorter policy retained full
crossing count and still delayed delivery. Other CPU ranges are wide or overlap;
individual low-load counters can read zero. Counter granularity, scheduling and
five-second samples preclude precise savings or a general capacity claim. There
is no encoder, decoder or Discord/network transport in this experiment, and these values must
not be compared directly with the earlier saturated ready-block cohort.

Retain TypeScript in production. The new evidence establishes that a naive
short batch timer adds latency without batching this 50 Hz input, while larger
batches explicitly trade control/PCM responsiveness for fewer crossings. A
different integration design would need separately measured cost and latency
limits, longer observations and intended-host validation, not automatic adoption.

Local validation passed Rust fmt, zero-warning Clippy with incremental caching
disabled, the locked release build, 26 library tests, six CLI tests and all 50
Node experiment tests with zero skips, including real FFmpeg. Lint, the harness
and both application typechecks, all 108 website tests, release validation and
production build passed. The generated changelog needed local LF normalization
after checkout; regeneration made the three release tests pass without changing
tracked release content. The first experiment run omitted FFmpeg from PATH and
skipped two codec tests; the complete 50/50 rerun included it. Required
`check:all` stops at four existing Windows `fcntl` import errors. Independently
run Core tests passed 345/346, with the existing POSIX stalled-decoder fixture
unable to spawn on Windows. Exact submitted-PR Linux/Windows CI is reported in
the PR rather than inferred from these local limitations.
