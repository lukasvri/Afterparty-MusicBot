# Synchronization, radio and search review

[Architecture](ARCHITECTURE.md) · [Radio policy](RADIO.md) · [Catalog evidence](RADIO_REAL_CATALOG.md) · [Toolchain](TOOLCHAIN.md)

Research date: 30 October 2026. Source baseline: `231317df27c6c6bb82cfc0d3364d0e3084a943f8`.
This is a bounded implementation agenda for [#37][i37], [#146][i146],
[#92][i92] and [#117][i117], not evidence that those issues are complete.
Recommendations below are proposals; source observations are identified separately.

## Preserve the existing authority and discovery model

**Observed:** [LiveClock](../lib/live-clock.ts) uses a monotonic browser clock,
midpoint RTT estimation, sample rejection above five seconds and a renewable
minimum-RTT window. [Playback policy](../lib/playback-sync.ts) expires tracked
timelines, preserves newer same-epoch snapshots and requires sustained modest
drift before seeking. Stable mode permits 1.5 seconds of drift with a six-second
correction interval; precise mode uses 0.5 seconds and three seconds. Buffering
and unconfirmed local pauses inhibit automatic correction. These are current
product choices, not externally established optimal thresholds.

**Observed:** The [room client](../apps/web/src/lib/rooms/room-client.ts) combines
authenticated HTTP authority with calibrated public SSE timelines, revisions,
epochs, expiring leases and command receipts. Its stream cannot grant host
permissions. Reconnect retires old callbacks. Keep these boundaries and the
separate public-concert/private-Discord contracts in [architecture](ARCHITECTURE.md).

**External evidence:** W3C defines monotonic time as immune to system-clock
adjustments [S1]. WHATWG specifies EventSource reconnection, optional additional
backoff, `Last-Event-ID` and HTTP 204 termination [S2]. These transport mechanisms
do not establish application authorization or guarantee replay of missed room
state. Existing HTTP reconciliation remains necessary; replacing SSE with another
transport has no demonstrated benefit here.

**Observed:** [Radio selection](../services/core/src/radio-pipeline.ts) already
combines bounded catalog and search pools, checks relationship/content/recording
evidence before ranking, and preserves deterministic query-order tie-breaking
despite concurrent discovery. [Preference ranking](../services/core/src/recommendation-ranking.ts)
considers recent artist exposure and local favorites. [Room radio](../services/core/src/room-radio.ts)
rechecks prepared entries. Improve these owners rather than adding a parallel
recommendation service.

## Priority 1: qualify recovery and slow-provider behavior

### A. Reproduce suspend and delayed-frame recovery

**Evidence gap:** MDN records operating-system/browser differences in whether
`performance.now()` advances during sleep [S3]. The room client defaults to
`performance.now()` for lease aging. This warrants a recovery test; it does not
prove an existing audible defect. Timer throttling, OS sleep and ordinary network
delay must be separate cases.

**Next slice:** Extend existing [room-client tests](../apps/web/tests/room-client.test.ts)
with frozen monotonic time plus advanced server time, a delayed pre-suspend frame,
a changed epoch, permission loss and an explicit pause during recovery. If a
stale lease survives, invalidate calibration on the relevant lifecycle transition
and require a fresh authenticated read and clock sample before resuming. Use
wall time only as a discontinuity signal, never as replacement playback authority.

**Acceptance:** Old callbacks/epochs cannot advance playback or complete a new
command; expired authority cannot enable controls; a deliberate pause survives;
one lifecycle event triggers at most one recovery attempt. Record recovery time,
clock RTT, stale-frame rejection and corrective-seek counts in controlled tests.
Then qualify two-device Chrome/Safari/Firefox behavior, background/foreground and
actual sleep before changing the default correction thresholds.

**Iframe limit:** YouTube's official sample exposes discrete player state,
current-time reads, seeks and available playback rates [S4]. Browser autoplay may
require user activation [S5]. Neither source establishes sample-accurate or
cross-device audible synchronization. Retain an actionable local play/retry state,
device calibration and conservative correction. Do not infer successful sound
from a playing snapshot or replace user pause with repeated `playVideo` calls.

### B. Align the search deadline with provider work

**Observed:** The browser allows 35 seconds and suppresses retired search results.
[Providers.search](../services/core/src/providers.ts) has no caller signal;
its API request can take 12 seconds before extractor fallback and metadata
hydration. The [extractor](../services/core/src/extractor.ts) permits a 15-second
admission wait and a 30-second subprocess run. These staged limits can exceed
the browser deadline. This is a source-level latency risk, not a measured p95.
yt-dlp itself also has request/retry controls [S6]; an adapter call is not an
HTTP-request count.

**Next slice:** Instrument anonymous stage durations and API/extractor counts in
synthetic tests. Establish one end-to-end deadline and pass its remaining budget
through existing owners. Preserve shared-search coalescing: cancelling one browser
must not cancel another waiter's useful result. Avoid adding retries until their
cost and deadline fit are measured.

**Acceptance:** A timed-out search releases its own resources and cannot update a
new query/room; shared surviving callers succeed; exhausted admission fails with
retry guidance. Report warm/cold p50/p95, timeout rate and provider calls using the
same fixtures. Keep four active/sixteen waiting extractor limits and playback
priority. No cookies, accounts or paid quota are required for this slice.

## Priority 2: recover useful discovery without weakening policy

**Observed:** [Recommendations](../services/core/src/recommendations.ts) cache
positive catalog pools for 24 hours and successful empty pools for 60 seconds;
errors are not successful empties. Core search retains nonempty results for one
hour but does not retain empties. The [Worker fallback](../lib/server.ts) caches
successful empty search for 60 seconds. This asymmetry is directly testable;
[provider tests](../services/core/tests/providers.test.ts) explicitly preserve
recovery from old empty radio caches.

**Next slice:** Evaluate a 60-second negative cache for ordinary manual search
only, retaining validation, count/mode isolation and fresh per-caller entry IDs.
Preserve explicit radio retry semantics; do not apply a blanket cache change to
`musicOnly` requests. Extend provider/catalog tests with concurrent manual empty
results, expiry, failure-then-success and an independently recovering radio retry.

**Acceptance:** Repeated identical manual empty searches perform one provider
lookup within 60 seconds; expiry reaches the provider; transient errors remain
retryable; radio retries can discover newly available results; one caller cannot
mutate another caller's metadata. Measure request savings separately from relevance.

**Discovery hypothesis:** Long station histories can exhaust finite cached pools;
the [radio documentation](RADIO.md) already acknowledges this. Reproduce with a
deterministic 30-selection session before implementing replenishment. Compare
coverage, unique compositions/artists, longest same-artist run, rejection reasons
and actual adapter/HTTP counts. A candidate repair is one rate-limited exhausted-pool
refresh that replaces an existing lookup, followed by normal cooldown. Do not
clear shared caches globally or repeatedly rotate queries until something passes.

Keep [existing limits](../services/core/src/radio-pipeline.ts), original seed,
revisions, history/exclusion checks, music-category evidence, AI/content checks,
embeddability, safeSearch and conservative relationship admission. Provider
availability must be reported independently from filtered content: missing
Last.fm credentials disable catalog discovery; they do not establish that genre
or artist discovery is unavailable. Sanitized stage diagnostics already provide
a useful starting point. Do not log titles, visitor IDs, room codes, queries,
credentials or raw provider errors.

## Priority 3: measure relevance and finish failure journeys

**Observed:** [Manual ranking](../services/core/src/music-search.ts) reorders at
most 50 existing results using title/artist coverage, recording-format intent,
availability and stable ties, without extra lookups. Explicit live/remix/cover
requests remain possible. The official YouTube discovery schema supports bounded
`maxResults` up to 50, embeddable/category filters and moderate safeSearch [S7].
These filters do not guarantee recording identity or future playback availability.

**Immediate regression candidate:** Bare `live` in the query currently counts as
format intent. Test `Live Forever` against a studio remaster and a performance
when neither candidate earns an exact-title bonus. Contextual/trailing performance
intent should preserve genuine live/festival requests without treating a song's
ordinary title word as that request. The existing exact-title test alone does
not cover this remaster case; establish a failing regression before changing it.

**Next slice:** Extend [ranking fixtures](../services/core/tests/music-search.test.ts)
with short/ambiguous artist names, punctuation/diacritics, legitimate format words
in song titles, festival sets, unavailable exact matches and explicit alternate
versions. Label the intended top three before comparing changes. Track top-one
and top-three success separately from provider coverage and latency; local ranking
cannot recover a recording absent from the pool. Require no additional provider
calls and retain explicit manual choices.

For room and concert search, browser-test empty, busy, timeout and provider-error
responses, retry, query replacement and navigation. Acceptance: each outcome has
clear text and a keyboard-accessible next action; retry preserves useful query
text; stale completion cannot replace newer results; search never interrupts the
current player. Verify mobile and 1080p/QHD/4K layouts under #146.

## Evidence and release limits

All linked repository owners and external sources below were accessed during this
review. GitHub/raw GitHub reads succeeded through the permitted network path.
Direct provider documentation hosts are outside the configured allowlist and
were not contacted. No live YouTube playback, provider probes, production data,
accounts or audible Discord sessions were used. No tests were executed for this
research note; earlier [catalog captures](RADIO_REAL_CATALOG.md) remain dated,
bounded evidence, not current availability certification.

Use [approved tooling](TOOLCHAIN.md) and focused existing suites; no new framework,
provider dependency or language is justified by this review. #117 still requires
installed-host/runtime acceptance after source qualification in [PR #164](https://github.com/lukasvri/Afterparty-MusicBot/pull/164); #92/#37 still require real catalog/audio/playback
acceptance. Source tests cannot close those experiential gaps. There is no
comparative evidence here for a universally best sync or recommendation method.

### External sources accessed

- [S1: W3C High Resolution Time source](https://github.com/w3c/hr-time/blob/b18d15ec0dab02961a9e0b467a4632344fc7330e/index.html).
- [S2: WHATWG HTML source, server-sent events](https://github.com/whatwg/html/blob/404b3eb14a7a936dddefb2d78e224dbeb01d2358/source#L133949).
- [S3: MDN performance.now source](https://github.com/mdn/content/blob/9740186550ed818e727ecc9906b499cdbe951cfc/files/en-us/web/api/performance/now/index.md).
- [S4: Official YouTube iframe-player sample](https://github.com/youtube/api-samples/blob/07263305b59a7c3275bc7e925f9ce6cabf774022/player/demo.js).
- [S5: MDN autoplay guidance source](https://github.com/mdn/content/blob/9740186550ed818e727ecc9906b499cdbe951cfc/files/en-us/web/media/guides/autoplay/index.md).
- [S6: yt-dlp options source](https://github.com/yt-dlp/yt-dlp/blob/b77c9304e1c4220cca450c583491904daf8455af/README.md).
- [S7: Google's YouTube API discovery schema](https://github.com/googleapis/google-api-python-client/blob/c1bdb24533614d6fcffeb7b9a93b2fc836c4e4e0/googleapiclient/discovery_cache/documents/youtube.v3.json).

[i37]: https://github.com/lukasvri/Afterparty-MusicBot/issues/37
[i146]: https://github.com/lukasvri/Afterparty-MusicBot/issues/146
[i92]: https://github.com/lukasvri/Afterparty-MusicBot/issues/92
[i117]: https://github.com/lukasvri/Afterparty-MusicBot/issues/117

## Local implementation follow-up

The subsequent source candidate expands the existing `Live Forever` regression
with a studio remaster, establishes its failure, and limits live-performance
intent to a trailing qualifier or explicit venue/version context. Explicit live
and festival requests remain available. Core and Worker also share canonical
manual-search cache bounds. A successful empty manual query now reuses its result
for one minute; expiry reaches the provider again. The regression initially
observed two provider calls instead of one. Core radio still immediately retries
a successful empty result, and failed requests remain retryable. Only discovery
with zero valid video IDs establishes an empty manual result for caching.
Failed metadata hydration after discovery remains immediately retryable; the
actual hydration-path regression first failed and then recovered on the next
search after this distinction was retained.

Local validation passes 107 Python recovery, 237 shared/Worker, 804 Core with real
FFmpeg and 185 native web cases, lint/unused-file/type/format checks and production
build/dry-run. A generated-type check initially failed when the worktree borrowed
another checkout's dependency symlinks; installing its own locked dependencies
resolved that setup issue. After the hydration correction, a fresh complete
`npm run check:all` invocation passes with all 804 Core cases.
Eight focused search, cold-catalog and room browser cases and two isolated real
Worker/D1 stack cases also pass. An initial stack run collided with this task's
preview ports; a separate-port rerun passes after task-owned Docker cache cleanup
resolved a subsequent full-disk setup failure.
No live provider, installed host or audible listening result is inferred. The
suspend/deadline/replenishment slices above remain proposals requiring their own
reproduction and measurement.
