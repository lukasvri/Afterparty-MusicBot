# Tomorrowland source inventory audit, 31 October 2026

This audit supports [issue #146](https://github.com/lukasvri/Afterparty-MusicBot/issues/146).
It compares five publisher playlist snapshots with the 28 individually curated
Tomorrowland recordings in [the catalog](../lib/concert-catalog.ts) at base
`f619049e4695d4520483dceb49115a150f5b80d0`. The previous coverage statement in
[Festival concert playlists](FESTIVAL_PLAYLISTS.md) described those 28 recordings
as a curated selection whose source playlist contents had not been enumerated.
The audited candidate union contains 601 recordings, including all 28 existing
recordings. This is a bounded source inventory, not a complete festival archive.

## Evidence and reproducibility

Five anonymous, metadata-only captures were obtained on 31 October 2026 UTC with
`yt-dlp --flat-playlist --dump-single-json --skip-download --playlist-end 501 --retries 0 --extractor-retries 0 --socket-timeout 8`.
The local evidence files are `tomorrowland-2022.json` through
`tomorrowland-2026.json`; the sanitized derivative is
`tomorrowland-source-audit-sanitized.json`, stamped
`2026-10-31T00:01:30.706Z`. These private diagnostic files are not repository
artifacts. No raw logs, request headers or forwarding/IP fields belong in this
document or the catalog.

Counts, titles, attribution and digests below were independently recomputed from
the five raw captures, rather than copied from the proposed runtime catalog.
Every sanitized named record's ID, title, duration, channel name and channel ID
matches its raw capture. The sanitized unique-ID sets also match the raw named
entry sets. Public source links identify the owning playlists; their current
contents can change after this snapshot.

All five captures identify the playlist channel as `Tomorrowland`, channel ID
[`UCsN8M73DMWa8SPp5o_0IAQQ`](https://www.youtube.com/channel/UCsN8M73DMWa8SPp5o_0IAQQ).
The playlist titles identify the corresponding Belgium edition and year:

| Year | Primary source playlist |
| --- | --- |
| 2022 | [Tomorrowland Belgium 2022 - Livesets](https://www.youtube.com/playlist?list=PLoSIOFPSXQoNFQ1nzaPy90MAt94vqJDb4) |
| 2023 | [Tomorrowland Belgium 2023 - Livesets](https://www.youtube.com/playlist?list=PLoSIOFPSXQoOZSSYZtdmZzagDK9kNfUsu) |
| 2024 | [Tomorrowland Belgium 2024 - Livesets](https://www.youtube.com/playlist?list=PLoSIOFPSXQoO6Y2EaUcVcBXQm7pkkY0n3) |
| 2025 | [Tomorrowland Belgium 2025 - Livesets](https://www.youtube.com/playlist?list=PLoSIOFPSXQoN-uoi-Bn6R4JA8C4beRJsU) |
| 2026 | [Tomorrowland Belgium 2026 - Livesets](https://www.youtube.com/playlist?list=PLeeZgE3_zp1w) |

Tomorrowland's [3 August 2022 press announcement](https://press.belgium.tomorrowland.com/tomorrowland-2022-full-sets-now-available)
links [tomorrow.land/Livesets](https://tomorrow.land/Livesets). Following that link
from the announcement during this audit resolved to the 2022 playlist above.
Its historical announcement of more than 70 sets is not a current playlist count.
The playlist-channel metadata supplies first-party publisher evidence for the
other four lists; secondary discovery articles are not used to establish their
contents or ownership.

## Enumeration and inclusion

"Named" means an entry has a nonempty title and video ID. Duplicate occurrences
are repeated IDs within one event/year. An unresolved entry has an ID but no
usable title. The inclusion candidate is the union of unique named playlist IDs
and that year's existing curated recordings.

| Year | Raw entries / reported count | Unique named | Unresolved | Duplicate occurrences | Existing curated | Curated outside playlist | Included union |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022 | 143 / 143 | 133 | 10 | 0 | 1 | 1 | 134 |
| 2023 | 99 / 99 | 96 | 3 | 0 | 3 | 1 | 97 |
| 2024 | 143 / 143 | 123 | 3 | 17 | 2 | 1 | 124 |
| 2025 | 109 / 109 | 108 | 1 | 0 | 1 | 1 | 109 |
| 2026 | 134 / 134 | 134 | 0 | 0 | 21 | 3 | 137 |
| Total | 628 / 628 | 594 | 17 | 17 | 28 | 7 | 601 |

All captures returned their reported entry count and remained below the
501-entry capture bound. This supports a full snapshot of the returned flat
playlist sequence, including unresolved entries and duplicates. It does not
establish that YouTube exposed every hidden entry or that these playlists contain
every performance, stage, weekend or official upload from each festival.

All 594 unique named titles contain `Tomorrowland` and their matching edition
year; none contains a conflicting `20xx` year. Year attribution uses those
performance labels and the matching playlist, not an upload date. No named ID
occurs in more than one captured year. Distinct IDs remain distinct recordings,
including different weekends or stages by the same artist.

The 2024 playlist has 140 named occurrences representing 123 unique IDs. Its 17
repeats have matching title, duration, channel and channel-ID metadata, so they
do not justify additional catalog recordings. All other years have no repeated
IDs. Every named occurrence supplies a channel name, uploader name and duration;
these fields are metadata, not a playback or full-performance verification.
Among unique named entries, channel IDs are missing for 0, 0, 1, 4 and 100
entries in 2022 through 2026 respectively.

All 17 unresolved IDs have `title: null`, `duration: null` and
`availability: null`, with no channel/uploader name. These observations do not
identify why metadata is absent. Calling the videos private, deleted, region
blocked or playable would require evidence that this audit did not obtain.
They are excluded from named catalog candidates, with the unresolved count
retained explicitly.

## Preservation and attribution

Seven existing curated recordings are outside their captured playlist's named
inventory. They retain their prior individual evidence and remain in the union:

| Year | Existing recording retained outside the playlist |
| --- | --- |
| 2022 | [Alesso, `9cWsoVKpNjw`](https://www.youtube.com/watch?v=9cWsoVKpNjw) |
| 2023 | [Martin Garrix B2B Alesso, `raOVXUB13vw`](https://www.youtube.com/watch?v=raOVXUB13vw) |
| 2024 | [Alesso, `_KWuiCtWyNA`](https://www.youtube.com/watch?v=_KWuiCtWyNA) |
| 2025 | [Martin Garrix, `RmxWqo83MO4`](https://www.youtube.com/watch?v=RmxWqo83MO4) |
| 2026 | [David Guetta, `GSnPwle4FOE`](https://www.youtube.com/watch?v=GSnPwle4FOE); [Hardwell, `Py-GG74lLU8`](https://www.youtube.com/watch?v=Py-GG74lLU8); [Martin Garrix, `sqxFW3RXGdo`](https://www.youtube.com/watch?v=sqxFW3RXGdo) |

The other 21 existing recordings overlap named playlist entries. Their existing
catalog objects and individual evidence should take precedence over generated
playlist rows. Playlist enumeration is not a reason to replace their uploader,
title, stage or evidence. The union adds 573 distinct recording IDs to the prior
28 without removing any existing recording.

The playlist's source publisher and a video's uploader are separate facts.
Captured entries also identify uploader/channel names including Dimitri Vegas
& Like Mike and Lost Frequencies; the 2026 list additionally contains Marlon
Hoffstadt aka DJ Daddy Trance. A Tomorrowland-owned list does not make every
linked video a Tomorrowland upload. New index rows can identify Tomorrowland as
`sourcePublisher` without inferring individual uploader ownership from playlist
membership. Existing individually checked uploader attribution remains valid
on its own evidence.

## Independent ID digest fixtures

For each set below, deduplicate the exact case-sensitive video IDs, sort them
using JavaScript's default string ordering, join with `\n` and hash the UTF-8
bytes using SHA-256. Do not add a trailing newline. These fixtures were derived
from the captures and base curated inventory independently of runtime output.
The playlist fixture guards source enumeration; the union fixture also guards
preservation of the seven curated recordings absent from the lists.

| Year | Unique named playlist ID SHA-256 | Included union ID SHA-256 |
| --- | --- | --- |
| 2022 | `4de17af9d18f3d1305833df9546c1295559539c3ae2b2aa2b16d854cb63b00a3` | `c6ddebc684deb7446bdbe0a979cf1b448a59a3eeff4a95a46269f52b43cdf750` |
| 2023 | `77688c05b7d800198026f5b7ecad493f9c18593d7b1f937300358c685ad6f963` | `5a1d477b1230e805576f87685cb39acfa25d00b434c1b43ee6735961af6f5dc9` |
| 2024 | `74bb1b9bd3ce114a466900e0516bfe94203bb7f9700eeab53317e26272870d82` | `3f10fdb5467ca7df0461da2bf488507d57ade4d12f5bf750f6c515570f8d27ed` |
| 2025 | `29708fc5e24b63e75d2b182987466188bd42314f45a75132aacccccd9a55f2d0` | `b366cff0f04c9e8e56811dd628b2889c80bd772ebca507dbbe2a5623f19d1f85` |
| 2026 | `f28d441384786e709d9c857fa9b2a962c4a07909012d218f843e3fb3b6eedf06` | `291be4aa89a39b5e01f4779387e6bbce812f084e71a3935c7533c14a836a1a4e` |

## Verification boundary

This audit checks source provenance, flat metadata, duplicate handling, title
year consistency and preservation against the base catalog. It does not certify
embedding permission, regional access, provider/CDN reachability, a full live
performance's editorial completeness, browser audio or real Discord playback.
The audit read retained metadata captures. Capture collection used isolated
metadata-only containers without accounts, media downloads, Discord connections
or production data. No production service changed. Runtime and real-device
acceptance remain separate checks.
