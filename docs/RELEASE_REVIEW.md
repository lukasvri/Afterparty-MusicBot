# Release review, 16 October 2026

Source review and isolated validation on `codex/release-smooth-ap`, based on the latest fetched `main` commit
`740c65e32f568036d9e7fabb40e8b2a22dec5faa`. This records source changes, not a
production deployment or a live Discord listening test.

The review covered Core playback, PCM mixing, subprocesses, music providers and
radio, guild isolation and authorization, SQLite persistence, command delivery,
room progression, website API routes, browser playback and transport hooks,
branding, production builds and deployment recovery tests.

## Resulting changes

| Area | Previous behavior | Result |
| --- | --- | --- |
| PCM decoding and mixing | Every full-volume frame was copied and processed sample by sample; an empty pending buffer still caused a concatenation | Full-volume frames without crossfade pass through intact; the decoder reuses complete incoming chunks. Gain and fade arithmetic are preserved |
| Long-running playback | One continuous mixer retained every historical segment | Keep the audible segment and prepared future segments; consumed history no longer accumulates in the playback clock |
| SQLite | Repeated reads, checkpoints and room/command operations compiled identical SQL again | Reuse a bounded set of prepared statements. A partial expiry index filters playing rooms for the scheduler. Queue/settings data and full synchronous writes are preserved |
| Media extraction | Output strings could grow beyond the limit; cancellation/deadlines could release a slot before the process exited; separately decoded stdout chunks could damage UTF-8 | A separate extractor module limits output to 8 MB, drains stderr, retains admission until process closure and decodes the completed byte stream. Playback priority remains, with FIFO order within each priority |
| Concurrent search | Identical requests before the cache was populated repeated source lookups | Share one in-flight lookup per provider, return independent queue entry IDs, and remove failed lookups so retries can recover |
| Command bridge | Core sent up to 20 results, but the Worker processed only 10 while Core acknowledged the full batch | Process all 20 results before the batch is acknowledged. Regression tests include commands belonging to another server |
| Browser transport | Separate clock implementations duplicated sampling logic; requests continued after cleanup; delivery age advanced the buffered Discord snapshot | Share a monotonic clock with bounded age and coalesced samples, cancel requests on cleanup, preserve buffered positions, and show stream status for the current server |
| Client work | Discord streaming/polling remained active in browser rooms; the QR library loaded with the initial player; the scenery rendered on unrelated updates | Disable the unused Discord transport in browser rooms, load QR generation when sharing opens, memoize static scenery and extract music discovery into its own component |
| Branding | Text-only wordmark, waveform favicon, condensed display type and remote Google Fonts stylesheet | Lowercase white `ap` with the red dot, matching favicon and wordmark, and a self-hosted 48,256-byte Inter variable Latin font. Inter 900 follows the supplied reference; the exact source font cannot be established from a raster image |
| Dependencies | The production dependency audit reported one critical, two high and one moderate affected package | Patch Next and its ESLint configuration to 16.3.8, update Sharp to 0.35.5 and refresh the affected source-map/browser-mapping dependencies. Both production dependency audits report zero findings |

Runtime files touched by the refactor were formatted for readable review and
maintenance. Compression belongs to the production build; source code remains
readable. Vite still minifies the client output, and QR generation is a separate
client chunk.

## Verification

`npm run setup:cloud` installs both locked dependency trees. `npm run check:all`
passes the following checks with synthetic credentials and isolated data:

- 37 Python deployment and recovery tests.
- 58 website unit/handler tests, including full bridge batches and clock cleanup.
- Both TypeScript checks.
- 148 Core tests, including real FFmpeg stereo decoding and crossfade at 96 and
  192 kbit/s, process failure/cancellation, long-running clocks, concurrent
  searches, room scheduling, stale commands, guild isolation and queue recovery.
- The website production build.

The local production preview also passes `party.browser.mjs`,
`concert-queue.browser.mjs` and all 13 tests in `video-start.browser.mjs` using
Chromium and synthetic API/player fixtures. These cover mobile layout, private
setup, search/add, moderation, clear/undo, favorites, QR sharing, TV mode,
autoplay recovery, radio progression, stale revisions and stable playback.
Desktop and mobile previews load the font locally without Google Fonts requests.
The video fixture uses the same default port as `npm run start` and closes its
browser if setup fails.

To rerun browser validation, start `npm run start` after a production build, then
run the three browser scripts with `PREVIEW_URL=http://127.0.0.1:8787`.
Playwright and Chromium must be available; `PLAYWRIGHT_MODULE` and
`CHROMIUM_PATH` can point to installed tooling.

## Performance evidence

Run `node services/core/benchmarks/audio-store.ts` for the bounded synthetic
comparison. It checks matching outputs and consumes results in the timed loop.
This run used Node 24.19.0, SQLite 3.53.3 and an AMD EPYC 7763, with 10,000
operations per round, five rounds and 1,000 warm-up operations.

| Operation | Median total time for 10,000 operations |
| --- | ---: |
| Former full-volume PCM sample loop | 213.58 ms |
| Full-volume pass-through | 0.26 ms |
| SQLite read compiling SQL each time | 69.69 ms |
| SQLite read reusing SQL | 20.00 ms |

These are microbenchmarks of the affected paths, not end-to-end playback latency,
voice-server capacity, network performance or disk-write benchmarks. Source
extraction, encoding, Discord and browser buffering still determine much of the
user experience.

## Remaining release evidence

The repository-wide ESLint command still fails on existing typing and React hook
issues. The latest upstream source has 115 errors and 31 warnings with the same lint
toolchain; the final snapshot has 109 errors and 29 warnings. This review does not hide
those rules or claim that lint is green.

Live listening, real Discord reconnects, concurrent load across multiple real
servers, third-party source availability, host-specific container validation and
production update/rollback remain to be verified on the deployment host.
Automated tone and packet tests establish frame correctness, not what a listener
hears. Follow [operations](../services/core/PUBLIC_RELEASE.md) for backups and
local validation before updating production.
