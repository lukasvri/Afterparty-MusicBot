# Runtime optimization review

Reviewed on 17 October 2026 against `main` commit
`43763193185df799c5f59739f5c1fcc09d1c4791`. This is a scoped source audit with
synthetic operation counts and a paired microbenchmark. It does not establish
that every line, production workload or host has been profiled.

A TypeScript-focused follow-up on 18 October 2026 is recorded below. Earlier
measurements remain dated evidence from their original review.

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

## TypeScript follow-up, 18 October 2026

Baseline: `5be83a8459e6e67c906e7957e49600500230a33a`, the reviewed head of
PR #65. The owner merged it during this work; refreshed `main` `cde5afc` has
the identical source tree and is incorporated before submission. This pass
keeps its venue/Beatles safeguards and release entry. The owner paused Rust research;
see [the recorded decision](AI_CONTEXT.md#architectural-boundaries). No Rust
source is changed or promoted by this product work.

### Radio discovery and metadata

An observed regression test held the first discovery reply and found only one
of the two independent searches had started. They now start concurrently but
are admitted in original query order after both settle. All music, relationship,
history, visibility and request/candidate limits remain in the shared selector.
Provider failures remain independent, without private query/error data in logs.

Three initial cold-provider tests reproduced duplicate metadata requests for
overlapping IDs, distinct search queries and unavailable fallback. Core now
coalesces pending outcomes per ID, keeping strict/tolerant caller interpretation
outside the shared operation and cloning returned entry/genre/catalog data.
The nine new tests also cover actual `Providers.radio`, failure/retry, successful
API omissions, capacity/recovery, 131 IDs in sequential 50/50/31 batches and
three-worker extractor limits. An additional red test during review exposed a
whole-batch completion barrier: a fast shared ID waited for an unrelated slow
fallback. Per-ID completion removes that barrier as well.

The [paired timing harness](../services/core/benchmarks/radio-discovery.ts)
loads the exact baseline selector from its local Git object and compares it
with the changed selector using the same unchanged policy helpers. Specific
seed metadata and no catalog callbacks isolate only the two discovery pools.
Each call injects 25/35 ms provider waits, checks the same selected track/source
and two calls, and records peak concurrent calls. Two warmup pairs precede five
alternating measured pairs. The [raw capture](../services/core/benchmarks/results/radio-discovery-20261018.json)
includes source hashes, exact baseline, runtime, hardware and all observations.

| Controlled operation | Before | After |
| --- | ---: | ---: |
| Discovery calls per selection | 2 | 2 |
| Peak independent discovery calls | 1 | 2 |
| Median controlled discovery elapsed, ms | 78.4082 | 46.2744 |
| Cold metadata work for one ID shared by two queries | 2 | 1 |

The first three rows use the controlled timing fixture; the last is a separate
actual provider counter regression, not a timing claim. Windows timer
quantization means injected 25/35 ms waits need not complete in exactly those
durations. The measurements demonstrate critical-path overlap on one development
host, not real YouTube/Last.fm latency, provider quotas, end-to-end audio or
audible quality. Metadata learning and catalog matching remain outside this
timing fixture and retain their existing sequencing.

### Startup recovery

Four isolated startup failures reproduced three retained intervals, one bound
sibling HTTP server and engine/guild listeners when the other bind failed.
The server now waits for all attempted binds to settle before rolling back the
same owned resources as normal shutdown. Startup rollback terminates upgraded
clients and HTTP connections; normal shutdown retains its existing close
semantics. The original bind/invalid-port error is preserved. Repeated close
calls share the same cleanup promise rather than returning early.

Eight new cases cover either/both occupied ports and synchronous invalid-port
errors in single-engine and multi-guild mode, exact freed-port reuse, listener
and interval baselines, room/WebSocket disposal, private access after recovery
and repeated close. This strengthens the constructor/recovery contract; it is
not a measured CPU saving or a claim that a fatal process would retain ports
after exiting.

### Interface scope and remaining limits

The UI pass uses the canonical black/white/red identity, shared self-hosted
typography and control/focus tokens across music, rooms, administration and
service pages. The stage uses matched decks and one projected mixer plane;
SVG geometry is verified by actual local renders, not described as photographic
realism. Player, clock and permission logic is unchanged by these visual edits.
See [branding](BRANDING.md#shared-interface-language) and the PR for actual
desktop/mobile and language checks, screenshots and final submitted-head CI.

Deferred opportunities remain explicit: cancelling stale engine lookups and
autocomplete work needs subscriber-safe provider cancellation; long-station
cache replenishment needs request-cost evidence; the decoder fragment deadline
needs its own reproduction. No broad timeout or music-policy change is hidden
in this pass. PR #65 is already merged into refreshed main, and its 2.2.4 release
entry is preserved below this patch's 2.2.5 entry. No production access, merge, publication or deployment
is performed here.

### Validation for this pass

Locked setup, zero-warning lint, both application typechecks, all 112 website
unit tests, release/diff validation and the production build passed locally.
Core passed 380/381 tests including local FFmpeg; its existing POSIX
stalled-decoder executable cannot spawn on Windows. Required `check:all` stops
at four existing Python import errors requiring POSIX `fcntl`. Remaining checks
ran explicitly. The PR records Linux CI on the exact submitted head, rather
than treating those local platform limits as a green full-suite result.

Actual Chromium-family browser checks passed all 27 video-start/playback cases
and four synchronization cases, including local Core/FFmpeg integration, plus
party, admin, admin-seek, concert-queue and service-page workflows. All synthetic
checks used isolated API/transport data. The design audit captured 24 genuine
before contexts and 36 after contexts: nine surfaces, both UI language settings,
390 px mobile and 1440 px desktop. The extra install/privacy/terms contexts are
after-only, and those service pages retain their existing English content.
Keyboard/dialog focus, 44 px mobile navigation/actions, reduced motion, equal
projected deck dimensions and player identity across tabs/settings passed.

Latest-release navigation and the 2.2.5 patch-notes title, date and all four
bullets were rendered and visually inspected at both widths. Selected sanitized
[DJ before](assets/dj-console-before-20261018.png)/[after](assets/dj-console-after-20261018.png)
and [mobile admin before](assets/admin-mobile-before-20261018.png)/[after](assets/admin-mobile-after-20261018.png)
are retained with [provenance](assets/README.md). Authenticated administration
uses synthetic fixtures; no real account, live listening or production health
claim follows from these checks.

The raw Node preview logged an unsupported `cloudflare:` module request for a
Worker-only server route. That preview has no Cloudflare bindings: browser API
responses were intercepted fixtures, and D1 handlers were checked separately
through the isolated SQL adapter. The visual checks do not validate real Worker
routes, OAuth or a deployed website backend.

### Stage and welcome-page review follow-up

The previous speaker group used 90 percent opacity, allowing rear beams to
show through the cabinets. It now has opaque flown PA modules, rigging,
grille faces and ground subwoofers, painted after the rear lighting. Narrower
red/neutral-white beams keep their origins at the fixtures. The halo radius
fits the LED display and its complete graphic group is clipped inside the
screen, including while the rings rotate. Matching decks and mixer geometry
remain unchanged.

The broad patch-notes banner above the welcome hero is removed at the owner's
request. The footer retains a versioned link from canonical release data;
the `/patch-notes` page and release history remain available. Updated notes
are part of the same unmerged 2.2.5 patch.

An isolated local browser rendered 20 stage frames across welcome/room,
390/1440 px, application motion off, system reduced motion, and enabled motion
at 0/3500/7000 ms. Representative frames were visually inspected independently
by the lead and both review agents. PA faces have no rear-light bleed and the
halo stays inside the screen. Off/reduced-motion frames have no running stage
animations; their corresponding images are byte-identical. Enabled-motion
frames retain animation. No horizontal overflow, uncaught browser error or API
write occurred. The versioned footer link and all four updated release bullets
were rendered at both widths. New sanitized [stage](assets/stage-pa-lighting-after-20261018.png)
and [mobile welcome](assets/welcome-footer-mobile-20261018.png) screenshots
preserve the earlier images for comparison. These are decorative local-preview
checks with synthetic API responses, not production or listening validation.

The follow-up also passed 16 design contexts (home, room, admin and patch notes
in both language settings at both widths), the party browser workflow,
zero-warning lint, website types, 112 website unit tests, release validation
and the production build. Required `check:all` again reached the same four
Windows `fcntl` import failures; the PR records Linux CI for the final head.
