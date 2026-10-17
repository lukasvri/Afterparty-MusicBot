# Runtime optimization review

Reviewed on 17 October 2026 against `main` commit
`43763193185df799c5f59739f5c1fcc09d1c4791`. This is a scoped source audit with
synthetic operation counts and a paired microbenchmark. It does not establish
that every line, production workload or host has been profiled.

## Scope and decisions

| Area inspected | Selected work or retained contract |
| --- | --- |
| Browser application and components | Room acceptance, admin refresh, queues, discovery, saved evenings, settings, sharing, fullscreen and player lifecycle. Remove repeated preference reads/writes and quadratic evening-list scans. |
| Client hooks and helpers | Browser values, audio preferences, live room/Discord subscriptions, concert queues, clocks, commands, playback correction, native seeks and diagnostics. Preserve transport ordering, lease expiry, stored keys, host permissions and the existing player instance. |
| Website backend and routes | Admin context, Discord session/grant forwarding, anonymous concert reads, room fallback and API boundaries. Avoid redundant application discovery for an explicitly selected guild; retain fresh authorization. |
| Core | Radio selection/queue filtering and existing playback, store, provider, extraction and transport boundaries. Reuse history analysis within one synchronous radio-selection pass. |
| Operations | Deployment/backup/health scripts and recovery documentation. Preserve deployment locks, verified per-database backups, compatible-image rollback and private configuration. No production operation or operational behavior change. |
| Rust research | Separate `dev` experiment and offline worker/process measurements. Its work remains isolated from this product branch and does not replace production TypeScript audio. |

Four focused changes were selected:

1. **Observed browser preferences.** Cache unchanged snapshots, including missing
   values, only while subscribed. Share storage-event invalidation for subscribers
   of one key. Same-page writes still notify subscribers; cross-tab edits and
   clears invalidate the cache. Unobserved keys retain their prior storage and
   in-memory fallback behavior, including blocked-storage credentials. Remove
   the duplicate nickname and animation-setting writes in their UI handlers.
2. **Saved-evening rendering.** Deduplicate history plus current/queued tracks with
   one Set scan, preserving first occurrence, ordering and YouTube-ID validation.
   Build one favorite-ID Set instead of repeatedly scanning favorites per row.
3. **Explicit-guild administration.** Skip `/v1/application` when a Discord request
   explicitly names the target guild, or an anonymous public reader supplies it.
   Core still verifies each grant on the target operation. Owner fallback still
   checks the configured default guild, and implicit selection still fetches it.
   Avoid bridge-key digests when the request supplies no bearer credential.
4. **Radio queue validation.** Prepare seed, history and exclusion identities once
   per synchronous filtering pass, then remember accepted automatic suggestions
   before validating later ones. Reuse the parsed recording title. There is no
   cross-call cache: later room changes rebuild the context. Ranking, manual
   priority, recording exclusions and candidate order retain parity coverage.

## Operation counts

These deterministic counters measure repeated work, not elapsed page or API
latency. Storage counts cover an already subscribed key; initial mount work can
include reads before subscription.

| Synthetic operation | Baseline | Changed |
| --- | ---: | ---: |
| 100 unchanged reads of an observed saved preference: storage `getItem` calls | 100 | 1 |
| 100 unchanged reads of an observed missing preference, including legacy fallback | 200 | 2 |
| Nickname or animation UI event: preference writes | 2 | 1 |
| Deduplicate 151 distinct evening tracks: ID-property reads | 23,103 | 151 |
| Explicit-guild Discord admin read: Core requests | 2 | 1 |
| Explicit-guild anonymous public queue read: Core requests | 2 | 1 |
| Anonymous admin check with a configured bridge key: bridge-comparison digests | 2 | 0 |

The hashing count excludes independent rate-limit, participant and authenticated
session hashing. No permission result or user session is cached.

## Paired Core measurement

The reference loads the exact old `radio.ts` from the baseline Git object and
uses the old per-entry queue orchestration retained in a test fixture. Output
arrays are compared before timing, and selected lengths are checked in each
timed iteration. Each case uses 10 warmup calls and five rounds of 30 calls,
alternating baseline/current execution order. Other task agents were quiescent
during the recorded run.

Environment: Windows, Node v24.19.0, Intel Core Ultra 7 255H. Values below are
median **milliseconds per 30 queue-filter calls**, not per request.

| Automatic suggestions | Manual tracks | History entries | Baseline ms | Changed ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 100 | 11.6776 | 6.6473 |
| 1 | 20 | 100 | 13.7143 | 7.1518 |
| 20 | 0 | 100 | 259.5992 | 16.0094 |

The 20-suggestion case is a stress case; normal rooms usually prepare one.
Manual-only and history-free cases have tiny totals and do not support a strong
speedup claim. Five rounds on one host are not confidence intervals or evidence
of endpoint latency, provider throughput, voice capacity or audible improvement.
See the [benchmark](../services/core/benchmarks/radio-queue.ts) and
[raw paired samples](../services/core/benchmarks/results/radio-queue-runtime-review-20261017.json).

## Deferred work

| Candidate | Priority | Risk / effort | Required evidence or constraint |
| --- | --- | --- | --- |
| D1 `visitors(room, until)` index | Next profiling pass | Medium / medium | Inspect real query plans and cardinality, measure read/write cost, then review a migration. No index added speculatively. |
| Merge live room and Discord hooks | Low | High / medium | Their guild scope, epochs, leases, authentication and recovery differ. A shared abstraction needs explicit behavior tests before consolidation. |
| Reduce the 100 ms client synchronization cadence | Profile first | High / medium | Measure browser work while preserving native scrub detection, buffering recovery, scheduled starts and stale-clock handling. |
| Cache administrative permissions | Do not introduce without fresh authorization | High / medium | Never reuse a stale authorization decision to bypass Core's current guild-grant check. |
| Decoder, codec or kernel replacement | Profile first | High / high | Measure whole-pipeline CPU, memory and scheduling on an isolated intended host. Faster isolated PCM mixing does not prove a Discord improvement. |
| Broad component memoization | Low | Medium / medium | Capture a rendering profile first. Stable player identity and correct permission/state updates take precedence over speculative caching. |

Rust measurements remain offline research on `dev`, with bounded synthetic
workers, process cleanup and optional FFmpeg stages. Parent-only CPU excludes
Rust/FFmpeg execution; individual RSS peaks are not a simultaneous process-tree
peak. No Rust adoption or live hearing result is implied.

## Validation and release boundary

Locked dependency setup, zero-warning lint, website and Core typechecks, all
99 website unit tests, release validation and the production build passed.
All 31 playback/synchronization browser tests passed, including real local
Core/FFmpeg integration, fresh storage, cross-tab audio, host/guest settings,
fullscreen, native seeks and player identity. The party and concert-queue
browser workflows also passed. Patch notes and the current-release link were
rendered and visually inspected at 390 and 1440 px: version 2.1.6, title,
date and all three bullets matched the canonical data with no horizontal overflow.

The full local Core suite passed 254 of 255 tests. Its existing POSIX shebang
stalled-decoder fixture cannot spawn on Windows. The required local
`npm run check:all` was attempted: lint passed, then four existing POSIX
`fcntl` deployment-test modules failed to import. Those platform-specific
checks remain unchanged and require the Linux GitHub CI run on the PR head.
Automated audio and browser fixtures do not establish audible live Discord quality.

Product notes follow the shared [release policy](RELEASING.md). Production data,
configuration, deployment locks and recovery procedures are unchanged. No live
Discord account, production database, merge or deployment was used for this
audit. Owner approval remains required before merge, publication or deployment.
