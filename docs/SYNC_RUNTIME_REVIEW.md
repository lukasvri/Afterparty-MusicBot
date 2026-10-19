# Synchronization and runtime review, 16 October 2026

[Architecture](ARCHITECTURE.md) · [TypeScript conventions](TYPESCRIPT.md) · [Host readiness](HOST_READINESS.md)

This review starts from freshly fetched `main` commit
[`4d0b798`](https://github.com/lukasvri/Afterparty-MusicBot/commit/4d0b7984404811751d4529e1fd13ac22a9698d78)
and examines the Rust experiment at `dev` commit
[`9d02b04`](https://github.com/lukasvri/Afterparty-MusicBot/commit/9d02b04e1f1e29929e34c9a723be4cc6f2d8da3e).
It records a source review and an engineering recommendation. It does not
establish production deployment, audible quality or live server capacity.

## Runtime recommendation

Keep the active website and Core in TypeScript, with the existing native FFmpeg
audio processes. Retain the isolated Rust experiment until comparable evidence
justifies integrating it. A full Core rewrite is not supported by the current
measurements or the maturity of the prototype.

| Option | Project-specific assessment |
| --- | --- |
| TypeScript Core and native FFmpeg | Existing Discord, provider, queue, permission, persistence and recovery integration. Best-supported route for the current synchronization fixes. |
| TypeScript control service and a Rust audio worker | A reasonable experiment if measured audio scheduling or CPU limits remain after targeted fixes. It needs a bounded streaming protocol, lifecycle handling and equivalent playback tests before adoption. |
| Full Rust Core rewrite | Would also replace administration, providers, radio, persistence, commands and transport. No measured requirement currently justifies that scope. |

The existing [`audio.ts`](../services/core/src/audio.ts) launches FFmpeg for
decoding and Opus encoding. TypeScript handles orchestration, PCM volume and
crossfade, and the authoritative playback timeline. Calling this a wholly
JavaScript audio codec would be incorrect. FFmpeg documents these native
[transcoding components](https://ffmpeg.org/ffmpeg.html#Detailed-description).

The Rust prototype contains one 3,840-byte PCM-frame mixer, ten unit tests and an
offline benchmark. All ten tests passed in this review. It has no Discord
connection, FFmpeg integration, streaming interface, IPC, persistent queue or
recovery integration. Its presence on `dev` does not mean a Rust replacement
engine exists.

Rust's ownership model can manage memory without a garbage collector, which is
relevant to latency-sensitive processing. That does not make network delivery,
iframe buffering or stale-state ordering correct automatically. See the
[Rust ownership documentation](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html).
Node also supports [worker threads](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html)
for CPU-intensive JavaScript. Moving work between threads or processes introduces
a boundary that must be measured, regardless of the language chosen.

## Measured PCM workload

Run the reproducible reference:

```bash
node services/core/benchmarks/pcm.ts
```

It imports the actual Core mixer and matches the Rust benchmark's two constant
PCM frames, changing crossfade progress, 85% volume, 30,000 iterations and output
checksum. TypeScript uses 3,000 warm-up iterations and five measured rounds in
one process. Rust uses five invocations of its existing benchmark; its internal
timing excludes process startup. Both ran on the same Linux x64 development
host, which reports an AMD EPYC 9V74 CPU.

| Measurement | TypeScript | Rust |
| --- | ---: | ---: |
| Runtime/compiler | Node 24.19.0 | rustc 1.99.1 |
| Build | Current Core mixer, native type stripping | `--edition=2024 -C opt-level=3` |
| Median time for 30,000 mixed frames | 691.78 ms | 197.60 ms |
| Mean time per frame in the median round | 23.06 microseconds | 6.59 microseconds |
| Audio represented by each frame | 20 ms | 20 ms |
| Checksum in every round | 3,780,300 | 3,780,300 |

The Rust prototype was approximately **3.5 times faster for this mixing
workload**. That supports investigating a small audio worker, but does not
establish the benefit of rewriting Core. Matching this checksum and passing ten
Rust tests is not exhaustive cross-runtime output equivalence.

The complete samples, environment and limitations are recorded in
[`pcm-runtime-review-20261016.json`](../services/core/benchmarks/results/pcm-runtime-review-20261016.json).
Rust source was copied from the pinned `dev` commit above without merging it
into `main`. With that Git object fetched and `rustc` available, reproduce the
optimized native build in a temporary directory:

```bash
pcm_review_dir="$(mktemp -d)"
git show 9d02b04e1f1e29929e34c9a723be4cc6f2d8da3e:experiments/rust-audio/src/lib.rs > "$pcm_review_dir/lib.rs"
git show 9d02b04e1f1e29929e34c9a723be4cc6f2d8da3e:experiments/rust-audio/src/main.rs > "$pcm_review_dir/main.rs"
rustc --edition=2024 --crate-name afterparty_rust_audio --crate-type=rlib -C opt-level=3 "$pcm_review_dir/lib.rs" -o "$pcm_review_dir/libafterparty_rust_audio.rlib"
rustc --edition=2024 -C opt-level=3 "$pcm_review_dir/main.rs" --extern "afterparty_rust_audio=$pcm_review_dir/libafterparty_rust_audio.rlib" -o "$pcm_review_dir/pcm"
for round in 1 2 3 4 5; do "$pcm_review_dir/pcm" --bench; done
rustc --edition=2024 --test "$pcm_review_dir/lib.rs" -o "$pcm_review_dir/tests"
"$pcm_review_dir/tests"
```

The earlier `audio-store.ts` benchmark measures full-volume pass-through, while
the existing Rust benchmark measures crossfade at reduced volume; those earlier
numbers are not comparable. The new measurements still exclude FFmpeg, IPC,
source extraction, Discord, real-time scheduling and browser playback. They give
no p95/p99 latency or concurrent-server capacity. A low average PCM processing
time does not rule out event-loop stalls. Do not interpret frames per second as
the number of supported voice sessions. No other task tests or builds were
intentionally run during the final comparison, but the host remains shared.

Before adopting a Rust worker, compare release builds on the same test host and
workload, then measure the complete audio path under representative concurrent
load. Include process-tree or container CPU and memory, dropped frames, deadline
misses, event-loop p95/p99, seeks, pause/resume, crossfade, cancellation and recovery.
The existing [`Metrics`](../services/core/src/metrics.ts) reports the Node process's
CPU and memory, not total FFmpeg child-process usage; it cannot by itself establish
the whole service's resource savings. Require output compatibility and no
regression in guild isolation or persistence. Keep those tests isolated from
production playback.

## Synchronization contract

Core remains the single owner of the Discord playback clock. Browsers project a
timestamped position locally between authoritative updates. Explicit control
changes and buffering transitions arrive immediately; full snapshots need not
arrive at the audio-frame rate.

The direct live connection is the primary timeline. HTTP polling supplies
fallback and metadata, and the durable website bridge preserves commands,
history and results across temporary transport failures. Each source has a
different revision and freshness boundary. A later response is not necessarily
a newer playback state.

The accompanying changes address these concrete problems:

- Preserve source timestamps when compensating delivery delay. Reusing a cached
  projection must not renew its playback lease or advance it a second time.
- Reject older revisions and responses for a previous room or guild. A delayed
  fallback response must not overwrite a newer live timeline.
- Expire live leases independently of incoming messages, so a quiet failed
  connection cannot leave the interface indefinitely marked live.
- Let the clock estimator accept a new low-latency sample window after network
  conditions change instead of retaining one historical best RTT forever.
- Send periodic live snapshots at 1 Hz while retaining immediate control updates
  and unthrottled buffering changes on the next engine tick. The same loopback
  fixture counted 16 to 5 Discord WebSocket snapshots and 25 to 5 room SSE
  snapshots across five simulated seconds. Connection and control messages are
  excluded; this is not a measurement of total production bandwidth.
- Keep the durable bridge single-flight, coalesce rapid changes, and back off
  failed requests. Validate replies before acknowledging stored results, compare
  command deadlines using the website clock, abort the HTTP request on shutdown
  and ignore callbacks after the store can close. Already executing commands are
  not cancelled by Publisher; unfinished journal entries remain recoverable as
  unknown outcomes rather than being replayed automatically.
- Apply the selected guild boundary to fallback command receipts. Legacy
  unscoped receipts remain limited to the authenticated default-guild mapping.

## TypeScript scope

The active application, first-party Node utilities, benchmarks, unit and
integration fixtures, and browser automation use strict TypeScript. SQLite and
Playwright boundaries are typed, the normal checks cover the migrated sources,
and `allowJs` is disabled. No strict-checking rules are disabled.

The Rust experiment is preserved. Python deployment/backup/recovery tools,
system shell entry points and configuration adapters retain their current
languages. Two tiny JavaScript installer adapters preserve existing caller paths;
the obsolete optional Core dashboard has since been removed. This is not a claim that every
file in the repository is TypeScript. Replacing installed Python deployment tools
requires its own CLI, journal, backup and recovery compatibility validation and
would not establish a playback performance improvement.

## Validation and rollout boundary

Run `npm run setup:cloud` and `npm run check:all`, plus the relevant synthetic
browser suites against a local production preview. The PR records the exact
checks, counts and remaining limitations for its final commit. Tests use isolated
databases, generated media and synthetic credentials.

After `npm run build`, start `npm run start` in a separate terminal, restarting
an existing preview after each rebuild so it serves the current assets. Run
`npm run test:sync` against the resulting local preview. Playwright is a pinned
development dependency; install its Chromium browser or point `CHROMIUM_PATH`
to an available Chrome/Chromium binary. `PREVIEW_URL` defaults to
`http://127.0.0.1:8787`. The synthetic fixtures refuse non-local preview URLs.

Review and merge are separate from production updates. Follow
[`AGENTS.md`](../AGENTS.md), [cloud development](CLOUD_DEVELOPMENT.md) and
[operations](../services/core/PUBLIC_RELEASE.md) for host-side backups, active
playback checks, deployment and live listening verification.
