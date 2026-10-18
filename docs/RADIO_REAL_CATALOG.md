# Radio 2.0 public catalog checks

[Radio policy](RADIO.md) · [Source matrix](../services/core/tests/fixtures/radio-real-tracks.json)

These checks ran on 18 October 2026 against anonymous public YouTube sources,
separately from Discord and production. They assess provider metadata, selection
policy and short local decoding. They do not assess listening quality, personal
taste, a natural Discord transition or the deployed version.

## Evidence and controls

The source matrix records twelve real recordings, official artist/label uploads
and primary catalog URLs. Reference categories retain their original scope: an
album category is not a verified track subgenre. These reference labels are never
injected into the metadata returned by the live provider.

| Recording | Reference evidence | Role |
| --- | --- | --- |
| The Weeknd, Blinding Lights | R&B/Soul album category | Public discovery and decoding |
| Dua Lipa, Levitating (solo) | Pop album category | Public discovery and decoding |
| Daft Punk, One More Time | Dance single category | Public discovery |
| Elektronomia, Sky High | Exact label upload says Progressive House | Specific-genre discovery |
| Metallica, Enter Sandman | Heavy Metal video category | Public discovery and decoding |
| John Coltrane, My Favorite Things | Jazz label catalog | Long-recording control |
| Johnny Cash, I Walk the Line | Label's country-chart evidence | Public discovery and decoding |
| Eminem, Lose Yourself | Hip-Hop/Rap album category | Public discovery |
| Bob Marley & The Wailers, Three Little Birds | Roots Reggae album category | Public discovery and decoding |
| Oasis, Live Forever | Indie Rock album category and artist single page | Legitimate-title regression |
| Beethoven, Symphony No. 9, movement I, Karajan/Berlin (1984) | Classical recording catalog | Long-recording control |
| The Beatles, Her Majesty | Official artist song entry | Short-recording control |

The original Coltrane recording (821 seconds), Karajan movement (936 seconds)
and Beatles song (23 seconds) deliberately fail the automatic-candidate duration
policy. Those are not relevance failures; manual playback remains available.
The Sun upload of I Walk the Line disagrees internally about its remaster year,
so the fixture preserves that uncertainty instead of inventing an exact edition.

## Reproduced corrections

On unchanged radio policy from `28ab6fd`, nine of nineteen real-name policy
tests failed. Two actual D1 room-handler regressions also returned HTTP 422:
Oasis Live Forever was rejected as live content, and Oasis Hello was rejected
after Adele Hello appeared in history. The tests use controlled API responses
and in-memory SQL, not captured live playback.

The corrections preserve comma-containing artist names, distinguish known
artists' same-title recordings, recognize R&B and DnB aliases, and interpret live
or cover upload labels by their format context rather than every title word.
Same-artist remasters and alternate uploads remain repeats; actual live flags,
unsafe upload labels, non-music categories, style conflicts and duration limits
remain rejection grounds.

A separate public capture of Starboy (`Rif-RTvmmss`, 14:45:24 UTC) contained the
artist tag `Daft Punk`, no Genre:/Style: line, and incorrectly parsed as `punk`.
Only complete genre tags, optionally ending in `music`, or explicit Genre:/Style:
lines now supply provider genre evidence. The regression retains only that
triggering public tag. Core search/video and website search/video cache keys
are versioned so older parsed genres do not survive the correction.

## Short decoding check

The actual `Providers.stream` and `PcmDecoder` paths resolved and decoded a
five-second window starting at 30 seconds for each of these public recordings.
PCM was measured in memory and discarded. Each successful result supplied 250
complete stereo 48 kHz, 20 ms frames with nonzero samples.

| Recording | First attempt | Repeat |
| --- | --- | --- |
| Blinding Lights | 250 frames | Not needed |
| Levitating | 250 frames | Not needed |
| Enter Sandman | Zero frames, unknown decoder reason | Same check: 250 frames |
| I Walk the Line | 250 frames | Not needed |
| Three Little Birds | 250 frames | Not needed |

This used official yt-dlp 2026.08.19 with its published SHA-256 verified and
FFmpeg 9.0.2. Local config, cookies and API credentials were disabled. No media
files, signed playback URLs, headers, lyrics or full provider descriptions are stored
in the repository. The one transient decode failure is retained as a limitation;
one successful repeat does not establish sustained availability or audible quality.

## Live discovery capture and corrections

The first two-seed check on the original radio policy completed 31 extractor calls
and reproduced exactly offline. A subsequent ten-seed check on clean commit
`8ae629d835ed215e4681e3609a43717f0fe481a1` completed 145 extractor calls in about
361 seconds. All ten seed metadata lookups succeeded; nine selections were made.
One later candidate returned invalid JSON and was skipped while selection continued.
There were no recorded provider-blocked or network failures. Offline replay
matched the full captured result and consumed all 145 recorded calls.
The retained full snapshot's SHA-256 is
`e8d9cf8eb52ed4b7bc7dd13d434aceae2ac38c5cc64ed81c582afc498aad17f8`.

| Seed | Captured initial selection | Assessment |
| --- | --- | --- |
| Blinding Lights | The Weeknd, Out Of Time | Eligible different song |
| Levitating (solo) | Levitating Featuring DaBaby | Bug: seed composition returned as another song |
| One More Time | Daft Punk, Crescendolls | Eligible different song |
| Sky High | Elektronomia, Energy | Eligible explicit progressive-house song |
| Enter Sandman | None | Bug: uploader-confirmed colon artist prefix was unknown |
| My Favorite Things | John Coltrane, My Ideal | Eligible shorter candidate; a long manual seed is allowed |
| I Walk the Line | Johnny Cash, Folsom Prison Blues | Eligible different song |
| Lose Yourself | Eminem, The Real Slim Shady | Eligible different song |
| Three Little Birds | Bob Marley & The Wailers, Stiff Necked Fools | Eligible different song |
| Live Forever | Live Forever (Demo), rare promo upload | Bug: demo/promo annotations hid the repeated song |

Eligibility here is a metadata/policy verdict, not a musical-taste assessment.
Search ranking varied between captures, so live before/after order alone does not
prove a code effect. The three actual problematic input pairs, capture time,
source hashes and public video URLs are retained in
[the minimal provider regression fixture](../services/core/tests/fixtures/radio-provider-regressions.json).
Four of its first six tests failed before the colon/Featuring/live-year fixes;
two additional demo-format tests then failed before their correction.

Colon splitting now requires the prefix to match a named uploader or catalog
artist, preserving colons inside song names and excluding generic publishers.
Featuring, feat. and ft. share song identity, while featured recording credits
remain distinct during metadata refinement. Explicit demo formats are rejected,
and promotional upload annotations cannot create a new composition. Dated live
performance labels remain excluded even if the video is no longer streaming live.

A three-seed live retest on clean `31f88e3100d324dcb24860e9b59afe897a4eabac`
completed 51 calls in 121.731 seconds without provider failures. Dua Lipa then
selected Training Season, and Metallica selected Halo On Fire. Both actual
recommendations also supplied 250 nonzero PCM frames in the short decoder check.
Oasis stopped selecting the demo, but returned a filtered result. Offline replay
again matched exactly with no unconsumed calls. That filtered result was not
treated as successful coverage: its five ordinary Oasis suggestions exposed a
further artist-credit parsing error.

A public Wonderwall capture at 15:08:54 UTC reports `artists: ["Oasis", "Noel
Gallagher"]`, the display string `Oasis, Noel Gallagher`, and uploader `Oasis`.
The [minimal credit fixture](../services/core/tests/fixtures/radio-artist-credits.json)
reproduced the same-artist fallback failure through actual Providers parsing.
Validated structured credits now supply a private catalog artist only when there
is one listed artist, or the named uploader confirms an exact list member. The
full public display credit stays intact. Missing, malformed, oversized or
unconfirmed multi-artist lists keep the original string. An actual comma inside
one name, such as Tyler, The Creator, is never blindly split.

The final Oasis live retest on clean
`7083fc96e170b765796d6828324dec2a4d3f7963` completed sixteen calls in 39.844
seconds without provider failures, using the same five-result search limit.
It selected Champagne Supernova (`VGfDg7wju6M`, 448 seconds), retaining music,
non-live and embedding checks. Relationship rejections fell from six to zero;
content, excluded-ID and repeated-recording rejections remained active. Offline
replay matched and consumed every call. The snapshot SHA-256 is
`bdd368eb39dd9c6e1b5ed6bf4e9532cc4b82dc9bfa0339299338717bf1888151`.
That actual recommendation also decoded 250 nonzero frames in the five-second
window. Together with the five original-seed windows and two earlier corrected
recommendations, eight distinct real recordings passed short local decoding.
These bounded tests do not establish sustained playback or audible transitions.

An additional upgrade regression used a controlled older private-history shape
with the captured combined artist string. It demonstrated an unwanted replay
after refinement, and a second test demonstrated a blocked legacy seed. Both
were observed failing before the compatibility correction. A private exact
full-credit alias now preserves those identities only when validated structured
credits agree with the original full string. Controls retain unrelated artists'
same-title songs and reject identity based on one overlapping collaborator. No
existing history is rewritten, and private catalog proof remains absent from
public playback state.
Fresh and cached catalog hydration retain that proof only when the freshly
validated primary artist exactly matches the requested catalog artist. Incoming
catalog aliases and contradictory artists cannot supply it. This boundary also
has an observed failing-then-passing regression.

The diagnostic interruption path was exercised separately using a programmatic
SIGINT event: it aborted the single active metadata request, retained an
`interrupted` checkpoint, returned exit 130 and rejected full replay with exit 1.
This checks the handler lifecycle, not delivery of an operating-system console signal.

## Repeating metadata checks

`scripts/radio-catalog-probe.ts` does no network work without an explicit mode.
Use `--live` only for a reviewed manifest of public video IDs and a controlled
absolute yt-dlp executable path. It uses an empty provider environment, fresh
in-memory stores, serialized metadata extraction and explicit time/request bounds.
Search pools contain five results, compared with twenty in production. Last.fm,
API-key paths and audio decoding are outside this metadata probe.

```text
node scripts/radio-catalog-probe.ts --live --manifest=manifest.json --out=snapshot.json --ytdlp=ABSOLUTE_PATH --limit=2 --max-calls=50 --max-seconds=240
node scripts/radio-catalog-probe.ts --replay --snapshot=snapshot.json
node --test services/core/tests/radio-real-policy.test.ts services/core/tests/radio-metadata-evidence.test.ts
node --test scripts/rooms.test.ts
```

Snapshots distinguish their captured commit, dirty status, relevant source hashes,
provider outcomes and selection diagnostics. Replay is offline evidence from a
dated capture, not a new live-provider check. Keep raw transient provider output
outside Git. Consult the PR for exact submitted-head checks and remaining limits.
