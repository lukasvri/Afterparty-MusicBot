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
| Enter Sandman | Zero frames before decoder timeout | Same check: 250 frames |
| I Walk the Line | 250 frames | Not needed |
| Three Little Birds | 250 frames | Not needed |

This used official yt-dlp 2026.08.19 with its published SHA-256 verified and
FFmpeg 9.0.2. Local config, cookies and API credentials were disabled. No media
files, signed playback URLs, headers, lyrics or provider descriptions are stored
in the repository. The one transient decode failure is retained as a limitation;
one successful repeat does not establish sustained availability or audible quality.

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
