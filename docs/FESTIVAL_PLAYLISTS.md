# Festival concert playlists

The source candidate contains **1,036 source-backed recordings across five event families
and 17 event/year groups**. Open **Library & playlists**, choose **Festival
concerts**, then select the festival and performance year. Search by artist,
recording title or stage, and browse 20 sets per page. Every indexed set remains
reachable; the page limit is not an inventory limit.

[The canonical catalog](../lib/concert-catalog.ts) owns recording links,
performance years, attribution and evidence. This document records source
coverage instead of duplicating the full recording inventory.

## Source coverage checked on 25 and 31 October 2026

| Festival | Year | Catalog recordings | Coverage |
| --- | --- | ---: | --- |
| EDC Las Vegas | 2026 | 116 | All 116 video links in the [official source index](https://lasvegas.edc.com/2026-sets/) |
| EDC Las Vegas | 2025 | 86 | All 86 video links in the [official source index](https://lasvegas.edc.com/2025-sets/) |
| EDC Las Vegas | 2023 | 26 | All 26 embedded videos in the [official source index](https://lasvegas.edc.com/2023-sets/) |
| Creamfields | 2024 | 24 | All 23 matching-year videos in the [24-entry official index](https://creamfields.com/2024_live/all-streams/), plus the official Beatport CAMELPHAT upload |
| Tomorrowland Belgium | 2026 | 137 | All 134 named source entries plus three existing uploads outside the playlist |
| Tomorrowland Belgium | 2025 | 109 | All 108 named source entries plus one existing upload; one unresolved source entry omitted |
| Tomorrowland Belgium | 2024 | 124 | All 123 unique named source entries plus one existing upload; 17 duplicate occurrences deduplicated and three unresolved entries omitted |
| Tomorrowland Belgium | 2023 | 97 | All 96 named source entries plus one existing upload; three unresolved entries omitted |
| Tomorrowland Belgium | 2022 | 134 | All 133 named source entries plus one existing upload; ten unresolved entries omitted |
| Ultra Miami | 2026 | 47 | All metadata-backed YouTube entries from the [48-row official year page](https://ultramusicfestival.com/live-sets/season/2026); one unresolved video omitted |
| Ultra Miami | 2025 | 32 | All unique YouTube entries from the [34-row official year page](https://ultramusicfestival.com/live-sets/season/2025); two repeated links listed once |
| Ultra Miami | 2024 | 46 | All YouTube entries from the [47-row official year page](https://ultramusicfestival.com/live-sets/season/2024); one SoundCloud audio source is outside this browser video catalog |
| Ultra Miami | 2023 | 33 | All YouTube entries from the [33-row official year page](https://ultramusicfestival.com/live-sets/season/2023) |
| Ultra Miami | 2019 | 22 | All YouTube entries from the [28-row official year page](https://ultramusicfestival.com/live-sets/season/2019); six SoundCloud audio sources are outside this browser video catalog |
| Amsterdam RAI | 2023 | 1 | Official Martin Garrix IDEM recording; not a complete event archive |
| Amsterdam RAI | 2019 | 1 | Official Martin Garrix THE ETHER recording; not a complete event archive |
| Amsterdam RAI | 2018 | 1 | Official Martin Garrix ANIMA recording; not a complete event archive |

A checked source index is a bounded snapshot of that publisher's linked videos,
not every performance at the festival or every official upload elsewhere.
Named uploaders remain explicit where individually checked. New festival-index
records identify the festival that links the recording, without inventing the
YouTube uploader's identity. Distinct performances are retained; repeated links
to the same recording are deduplicated within an event/year.

The [31 October Tomorrowland audit](FESTIVAL_SOURCE_AUDIT_20261031.md) independently
enumerates all five publisher playlists: 628 returned entries, including 17
duplicate occurrences and 17 entries without title/duration. The 594 unique named
recordings all identify the matching performance year. Existing curated entries
take precedence, including seven recordings outside those lists. All 290 earlier
catalog records and their evidence remain unchanged; 573 recordings are added.
Missing metadata leaves current availability unresolved. Playback,
embedding and territory remain runtime checks, not claims from the playlist.

The [Ultra audit](ULTRA_SOURCE_AUDIT_20261031.md) follows the official season
routes rather than the first page of the unfiltered archive. It reconciles 190
rows with 180 metadata-backed YouTube recordings, two repeated occurrences,
seven unsupported SoundCloud audio sources and one unresolved video-metadata
response. All seven earlier Ultra records remain unchanged; 173 recordings are
added. Edition evidence comes from the explicit season and returned performance
title/date, never an upload date. The source-audio URLs remain in the audit and
source omissions without implying support in the YouTube room player.

Creamfields' [Eli Brown 2024 page](https://creamfields.com/2024_live/friday/steel-yard/eli-brown/)
embeds [a recording identifying 2023](https://www.youtube.com/watch?v=Bz3StgzmGos).
It is excluded from the 2024 inventory. The additional
[CAMELPHAT recording](https://www.youtube.com/watch?v=bVF_7IiTAsI) is published by
Beatport and describes its Creamfields 2024 Steel Yard performance. Source-count
and sorted-video-ID digest tests protect the fourteen enumerated snapshots against
accidental lost, replaced or misplaced links.

## Browse the larger Tomorrowland source playlists

Each existing Tomorrowland year has **Preview source playlist** in the festival
browser. It starts the existing [metadata importer](PLAYLIST_IMPORT.md), fills
its URL and moves focus to the import form. Loading never enqueues or autoplays.
Choose available entries explicitly after the preview completes.

| Year | Playlist reference | Discovery evidence |
| --- | --- | --- |
| 2026 | [Liveset playlist](https://www.youtube.com/playlist?list=PLeeZgE3_zp1w) | 134 returned entries; Tomorrowland channel metadata and matching edition title |
| 2025 | [Liveset playlist](https://www.youtube.com/playlist?list=PLoSIOFPSXQoN-uoi-Bn6R4JA8C4beRJsU) | 109 returned entries; Tomorrowland channel metadata and matching edition title |
| 2024 | [Liveset playlist](https://www.youtube.com/playlist?list=PLoSIOFPSXQoO6Y2EaUcVcBXQm7pkkY0n3) | 143 returned entries; Tomorrowland channel metadata and matching edition title |
| 2023 | [Liveset playlist](https://www.youtube.com/playlist?list=PLoSIOFPSXQoOZSSYZtdmZzagDK9kNfUsu) | 99 returned entries; Tomorrowland channel metadata and matching edition title |
| 2022 | [Liveset playlist](https://www.youtube.com/playlist?list=PLoSIOFPSXQoNFQ1nzaPy90MAt94vqJDb4) | [Official Tomorrowland press announcement](https://press.belgium.tomorrowland.com/tomorrowland-2022-full-sets-now-available), whose Livesets link resolves to this matching-year playlist |

The linked audit records title, publisher, entry counts and the returned ID
inventory as captured on 31 October. These bounded snapshots do not establish
every performance or continued availability. The importer still requests up to
500 fresh entries through bounded pagination, shows 20 per page and labels
partial results. It does not silently promote new imports into the catalog.

## Queue and playback behavior

Add one set, the complete listed year when it fits, or an explicitly labeled
capacity-sized batch. Existing current, queued and pending tracks are skipped.
Browser rooms reserve their 50-entry capacity for queued tracks and pending
requests. Website additions retain a 50-track selection budget; Discord also
enforces the selected server's configured playlist limit. Larger festival
inventories remain available for later batches.

Additions preserve current playback and saved evenings, use fresh queue revisions
and stop on errors or a room/server switch. A partial result is visible; retrying
is explicit. Adding to an empty connected Discord queue retains its existing
behavior of starting the requested music.

Amsterdam RAI IDEM belongs to 2023 although its official upload appeared in 2024.
Upload dates never substitute for performance years. No duration, embedding,
regional access or audible playback guarantee is inferred from a source link.
The game pack remains separate: see [private quiz setup](GUESS_CATALOG_SOURCES.md#prepared-edm-festival-hits-pack).

## Remaining inventory work

Three Amsterdam RAI groups still lack an enumerated complete official archive.
Tomorrowland has enumerated playlist snapshots, with 17 unresolved entries
retained as explicit omissions. Ultra has enumerated official season-page
snapshots, with one unresolved metadata entry and seven SoundCloud audio sources
outside the current browser video contract.
These lists are not evidence of all performances or all separate official
uploads; the seven existing outside-playlist recordings illustrate that limit.
Amsterdam RAI has verified named full shows, without a complete archive of every
performer or separate all-ages performance.

Complete those source inventories before claiming every set from every existing
festival/year. Metadata checks and synthetic browser tests do not establish
provider/CDN reachability or real-device listening on the intended installation.
