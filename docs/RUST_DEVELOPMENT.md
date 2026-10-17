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
node --test --test-timeout=30000 experiments/rust-audio/stream-parity.test.ts
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
the child. These are explicit experiment limits, not a production recovery
strategy.

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

This establishes an inspectable process boundary for further measurement. It
does not establish a full Discord audio improvement. Process startup, IPC
copies, scheduling, FFmpeg children, Opus encoding, concurrent guilds, tail
latency and failure recovery still need whole-pipeline measurements before a
Rust adoption decision. Keep the TypeScript implementation as the production
path until that separate review.
