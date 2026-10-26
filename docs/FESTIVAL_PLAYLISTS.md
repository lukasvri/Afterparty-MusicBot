# Festival concert playlists

The library contains **290 source-backed recordings across five event families
and 17 event/year groups**. Open **Library & playlists**, choose **Festival
concerts**, then select the festival and performance year. Search by artist,
recording title or stage, and browse 20 sets per page. Every indexed set remains
reachable; the page limit is not an inventory limit.

[The canonical catalog](../lib/concert-catalog.ts) owns recording links,
performance years, attribution and evidence. This document records source
coverage instead of duplicating the full recording inventory.

## Source coverage checked on 25 October 2026

| Festival | Year | Catalog recordings | Coverage |
| --- | --- | ---: | --- |
| EDC Las Vegas | 2026 | 116 | All 116 video links in the [official source index](https://lasvegas.edc.com/2026-sets/) |
| EDC Las Vegas | 2025 | 86 | All 86 video links in the [official source index](https://lasvegas.edc.com/2025-sets/) |
| EDC Las Vegas | 2023 | 26 | All 26 embedded videos in the [official source index](https://lasvegas.edc.com/2023-sets/) |
| Creamfields | 2024 | 24 | All 23 matching-year videos in the [24-entry official index](https://creamfields.com/2024_live/all-streams/), plus the official Beatport CAMELPHAT upload |
| Tomorrowland Belgium | 2026 | 21 | Curated selection; source playlist contents not enumerated |
| Tomorrowland Belgium | 2025 | 1 | Curated selection; source playlist contents not enumerated |
| Tomorrowland Belgium | 2024 | 2 | Curated selection; source playlist contents not enumerated |
| Tomorrowland Belgium | 2023 | 3 | Curated selection; source playlist contents not enumerated |
| Tomorrowland Belgium | 2022 | 1 | Curated selection; source playlist contents not enumerated |
| Ultra Miami | 2026 | 2 | Curated selection; full official inventory not enumerated |
| Ultra Miami | 2025 | 2 | Curated selection; full official inventory not enumerated |
| Ultra Miami | 2024 | 1 | Curated selection; full official inventory not enumerated |
| Ultra Miami | 2023 | 1 | Curated selection; full official inventory not enumerated |
| Ultra Miami | 2019 | 1 | Curated selection; full official inventory not enumerated |
| Amsterdam RAI | 2023 | 1 | Official Martin Garrix IDEM recording; not a complete event archive |
| Amsterdam RAI | 2019 | 1 | Official Martin Garrix THE ETHER recording; not a complete event archive |
| Amsterdam RAI | 2018 | 1 | Official Martin Garrix ANIMA recording; not a complete event archive |

A checked source index is a bounded snapshot of that publisher's linked videos,
not every performance at the festival or every official upload elsewhere.
Named uploaders remain explicit where individually checked. New festival-index
records identify the festival that links the recording, without inventing the
YouTube uploader's identity. Distinct performances are retained; repeated links
to the same recording are deduplicated within an event/year.

Creamfields' [Eli Brown 2024 page](https://creamfields.com/2024_live/friday/steel-yard/eli-brown/)
embeds [a recording identifying 2023](https://www.youtube.com/watch?v=Bz3StgzmGos).
It is excluded from the 2024 inventory. The additional
[CAMELPHAT recording](https://www.youtube.com/watch?v=bVF_7IiTAsI) is published by
Beatport and describes its Creamfields 2024 Steel Yard performance. Source-count
and sorted-video-ID digest tests protect all four enumerated indexes against
accidental lost, replaced or misplaced links.

## Browse the larger Tomorrowland source playlists

Each existing Tomorrowland year has **Preview source playlist** in the festival
browser. It starts the existing [metadata importer](PLAYLIST_IMPORT.md), fills
its URL and moves focus to the import form. Loading never enqueues or autoplays.
Choose available entries explicitly after the preview completes.

| Year | Playlist reference | Discovery evidence |
| --- | --- | --- |
| 2026 | [Supplied playlist](https://www.youtube.com/playlist?list=PLeeZgE3_zp1w) | Owner-supplied URL; matching playlist title exposed by YouTube |
| 2025 | [Liveset playlist](https://www.youtube.com/playlist?list=PLoSIOFPSXQoN-uoi-Bn6R4JA8C4beRJsU) | [EDM Identity's embedded reference](https://edmidentity.com/2025/07/31/tomorrowland-2025-livesets/), matching YouTube title |
| 2024 | [Liveset playlist](https://www.youtube.com/playlist?list=PLoSIOFPSXQoO6Y2EaUcVcBXQm7pkkY0n3) | [EDMTunes' playlist reference](https://www.edmtunes.com/2024/07/tomorrowland-over-100-liveset-videos-youtube/), matching YouTube title |
| 2023 | [Liveset playlist](https://www.youtube.com/playlist?list=PLoSIOFPSXQoOZSSYZtdmZzagDK9kNfUsu) | [Guettapen's embedded reference](https://www.guettapen.com/2023/07/31/tomorrowland-publie-45-sets-de-son-edition-2023-sur-sa-chaine-youtube/) |
| 2022 | [Liveset playlist](https://www.youtube.com/playlist?list=PLoSIOFPSXQoNFQ1nzaPy90MAt94vqJDb4) | [Official Tomorrowland press announcement](https://press.belgium.tomorrowland.com/tomorrowland-2022-full-sets-now-available), whose Livesets link resolves to this matching-year playlist |

These references do not establish every playlist entry, ownership, total count,
recording eligibility or continued availability. The source reader exposed titles
or embed URLs, not complete contents. The importer requests up to 500 entries
through bounded pagination, shows 20 per page and labels partial results. It does
not silently promote imported entries into the curated catalog.

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

The 13 non-indexed groups above remain incomplete as festival archives. Ultra's
[current official live-set page](https://ultramusicfestival.com/live-sets) exposes
artist cards through the available reader, but did not provide the complete
canonical recording links and historical-year mapping needed for an inventory.
Discovered third-party playlists and an unverified 2026 playlist reference are
not treated as an official full archive. Tomorrowland playlist contents still
need enumeration and comparison against individually eligible recordings.
Amsterdam RAI has verified named full shows, without a complete archive of every
performer or separate all-ages performance.

Complete those source inventories before claiming every set from every existing
festival/year. Metadata checks and synthetic browser tests do not establish
provider/CDN reachability or real-device listening on the intended installation.
