# Core reliability validation, 15 October 2026

Baseline: `c8050d08f1130f6b200182c18ce1f2cf0d80628a`. The checkout was clean;
work used `codex/core-reliability`. Node.js 24.19.0 and FFmpeg 7.1.5 were available.
The locked dependencies were already installed by `npm run setup:cloud` in the
same workspace. No dependency changes were needed.

## Confirmed problems and fixes

| Trigger | Previous consequence | Change |
| --- | --- | --- |
| A paused seek finishes after another track starts, or after a newer resume | The old seek restores its captured pause state onto newer playback | Supply initial pause intent to `startTrack` before preparation; completion uses the current intent without a second pause operation |
| An add lookup completes after `Engine.close()` | The closed engine can accept the result, write its queue and attempt playback | Mark the engine disconnected and invalidate pending add generations before stopping |
| FFmpeg closes stdout and then exits unsuccessfully | Decoder or encoder failure can appear as normal end of track | Wait for subprocess completion before treating stdout EOF as success; handle signal exits as failures |
| A decoder stops supplying data, or its mixer is destroyed during preparation | The frame deadline rejects without killing the decoder; mixer cancellation can leave the encoder waiting for input | Kill the decoder on frame failure and propagate mixer cancellation through encoder pipes and subprocess cleanup |
| At least 20 older completed local command jobs precede website jobs | The result query limits local jobs first and filters them out, so website results never reach the publisher | Filter bridge jobs in SQL before applying the batch limit; use a partial pending-bridge index |

Tests use deferred promises for replacement races, a mocked deadline with a
synthetic stalled subprocess, real FFmpeg failures and generated tones, and
isolated SQLite data. The new tests fail against the baseline source. Existing
queue-ordering, stale-command, radio, transaction, guild isolation, authorization,
public-concert separation, playback-clock and slash-command tests continue to pass.

## Validation

| Check | Baseline | Final |
| --- | --- | --- |
| `npm run check:all` | Passed: 29 website tests, 60 Core tests, both typechecks and website build | Passed: 29 website tests, 69 Core tests, both typechecks and website build; no skipped tests |
| Core Docker `validation` target | Not run for baseline | Passed Core typecheck and all 69 tests |
| FFmpeg crossfade checks | Passed | Passed at 96 and 192 kbit/s, including decoded stereo frame counts and segment timing |

The Docker build used the repository's pinned base and validation instructions
with temporary BuildKit CA mounts for pip and npm in this managed environment.
The repository Dockerfile was not changed. Validation built an image only.
Existing build notices about the proxy and vinext route classification remain.

## Bounded query measurement

Reproduce with `node services/core/benchmarks/bridge-results.ts` from the repository
root. This uses an in-memory SQLite database with 10,000 older completed local
jobs and 40 completed bridge jobs. Each operation warms up 25 times, then runs
five rounds of 250 lookups. Statements are prepared on each lookup, matching
`Store.bridgeResults()`. Reported times are medians of round means.

Environment: Linux x64, Intel Xeon Platinum 8573C, Node.js 24.19.0, SQLite 3.53.3.

| Query | Results per lookup | Median milliseconds per lookup |
| --- | --- | --- |
| Previous limit-then-filter implementation | 0, incorrect | 0.030 |
| Corrected filter-before-limit using the pre-existing `jobs_pending` index | 20 | 0.935 |
| Final query using `jobs_bridge_pending` | 20 | 0.026 |

The index avoids scanning the older local jobs when returning a correct batch.
The comparison with the corrected scan isolates the index benefit; the original
query's time does not represent successful result delivery. These are synthetic
query measurements, not disk, network, concurrent-load or production guarantees.
The additional index consumes storage and adds maintenance work when pending
bridge jobs are inserted, finished or acknowledged. First startup scans existing
jobs to create it; large database startup time was not measured.

## Compatibility and remaining checks

The database change adds one index with `CREATE INDEX IF NOT EXISTS`. It does not
rewrite payloads, queues, settings, saved playlists, favorites or recovery records.
A regression test opens an existing jobs table and verifies that its payload is
preserved. No audio format, bitrate policy, crossfade calculation, queue revision,
command definition or per-server database path changed.

The tests did not connect Discord or real media providers. They do not establish
audible Discord playback, reconnect behavior under a real network partition,
production disk-full behavior or production load capacity.

Before a local update, follow [operations](../PUBLIC_RELEASE.md):

- [ ] Review the PR and check active playback before interrupting the bot.
- [ ] Preserve the rollback image and back up the complete data directory and private configuration locally.
- [ ] Re-run local validation and confirm existing mounts and environment-file references before updating.
- [ ] In a controlled Discord check, verify pause, resume, overlapping seek and skip, stop, crossfade, disconnect and reconnect, and graceful restart recovery.
- [ ] Verify audible playback and website command results, plus server isolation and the separation of ordinary music from public concerts.

No production credentials, services, private network, deployment configuration or
production data were accessed or changed during this work.
