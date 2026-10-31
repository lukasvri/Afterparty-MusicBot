# Ultra Miami source inventory audit, 2026-10-31

## Finding and scope

Ultra publishes usable, year-filtered recording inventories for all five Ultra Miami editions already represented in Afterparty: **2019, 2023, 2024, 2025 and 2026**. The correct source is the official site's `/live-sets/season/{year}` route. Each of these routes returned HTTP 200, an explicit matching `activeSeasonSlug`, and a server-rendered media `items` array on 2026-10-31. This is stronger year evidence than inferring a year from upload dates or position in the unfiltered list. [Official live-set archive](https://ultramusicfestival.com/live-sets), [official archive route implementation](https://ultramusicfestival.com/_next/static/immutable/chunks/2nhib9fnyhzow.js).

The table below enumerates the **entire returned inventory of each official year page at capture time**. It does not establish that Ultra's editorial inventory includes every festival performance, every official recording ever released, or every recording published separately by an artist. No source inspected makes that stronger completeness guarantee.

| Performance edition | Official inventory | Returned rows | YouTube rows | Unique YouTube IDs within year | SoundCloud rows |
| --- | --- | ---: | ---: | ---: | ---: |
| 2019 | [Ultra 2019](https://ultramusicfestival.com/live-sets/season/2019) | 28 | 22 | 22 | 6 |
| 2023 | [Ultra 2023](https://ultramusicfestival.com/live-sets/season/2023) | 33 | 33 | 33 | 0 |
| 2024 | [Ultra 2024](https://ultramusicfestival.com/live-sets/season/2024) | 47 | 46 | 46 | 1 |
| 2025 | [Ultra 2025](https://ultramusicfestival.com/live-sets/season/2025) | 34 | 34 | 32 | 0 |
| 2026 | [Ultra 2026](https://ultramusicfestival.com/live-sets/season/2026) | 48 | 48 | 48 | 0 |
| Total | Five year pages | **190** | **183** | **181 globally unique** | **7** |

Counts refer to source rows, not verified playable recordings. In particular, successful metadata lookup does not prove duration, embedding permission, regional availability, full-set content or browser playback.

## Archive routing and enumeration

The public site's `SeasonSelect` receives `basePath="/live-sets"` and `yearSegment="season"`. Its navigation joins those values with the selected season slug. `ArchivePagination` uses the base path for page 1 and joins the base path with `page/{number}` for later pages. Consequently the unfiltered second page is `/live-sets/page/2`, not a guessed `?page=2` query. [Public client implementation](https://ultramusicfestival.com/_next/static/immutable/chunks/2nhib9fnyhzow.js).

The unfiltered [archive](https://ultramusicfestival.com/live-sets) returned 100 `items` and pagination `{page: 1, totalPages: 5}`. The actual [second page](https://ultramusicfestival.com/live-sets/page/2) returned HTTP 200 and `{page: 2, totalPages: 5}`. Its contents include 2024 and 2023 entries. A capture of the first 100 unfiltered rows therefore cannot serve as the complete archive or establish that earlier years are absent.

All five filtered year pages returned fewer than 100 rows and no pagination component. Requests to `/live-sets/season/{year}/page/2` returned HTTP 404 for each of 2019, 2023, 2024, 2025 and 2026. Together with the matching active season and the complete returned `items` arrays, this supports a one-page inventory for each requested year at this capture time. The 404 results are a measured boundary, not a claim about unpublished or future records. [2019 boundary](https://ultramusicfestival.com/live-sets/season/2019/page/2), [2023 boundary](https://ultramusicfestival.com/live-sets/season/2023/page/2), [2024 boundary](https://ultramusicfestival.com/live-sets/season/2024/page/2), [2025 boundary](https://ultramusicfestival.com/live-sets/season/2025/page/2), [2026 boundary](https://ultramusicfestival.com/live-sets/season/2026/page/2).

Enumeration must decode the inline `self.__next_f.push(...)` payloads and read the media component's `items` array. Its relevant fields are `title`, `type` and `embed`; the row type is `embed` for both providers. Reading HTML `data-src` values alone misses SoundCloud entries. Image update timestamps and image filenames are not performance-year evidence. [2019 source containing six SoundCloud entries](https://ultramusicfestival.com/live-sets/season/2019), [2024 source containing a direct SoundCloud URL](https://ultramusicfestival.com/live-sets/season/2024).

## Provider and duplication boundaries

The seven SoundCloud entries are part of Ultra's recording inventory but do not have YouTube video IDs. Afterparty's current concert recording contract and browser playback path use YouTube IDs. Record these seven entries as unsupported source omissions in this YouTube catalog expansion. They need an explicit provider decision and appropriate playback support before inclusion as playable catalog records; they must not receive fabricated YouTube IDs. See `ConcertRecording` in [the catalog](../lib/concert-catalog.ts).

| Edition | Ultra row title | Officially linked SoundCloud target |
| --- | --- | --- |
| 2019 | Dombresky | [Track 599966097](https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/599966097) |
| 2019 | Young Bombs | [Track 599942802](https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/599942802) |
| 2019 | 3LAU | [Track 600103470](https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/600103470) |
| 2019 | Galantis | [Track 601490961](https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/601490961) |
| 2019 | Frank Walker LIVE | [Track 601938501](https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/601938501) |
| 2019 | LSDREAM | [Track 601997184](https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/601997184) |
| 2024 | 3LAU | [ultra2024](https://soundcloud.com/3lau/ultra2024) |

Source ownership for these links is established by the [official 2019 page](https://ultramusicfestival.com/live-sets/season/2019) and [official 2024 page](https://ultramusicfestival.com/live-sets/season/2024). This audit did not certify the individual SoundCloud targets' current availability, duration or uploader metadata.

The [2025 inventory](https://ultramusicfestival.com/live-sets/season/2025) repeats two videos with different YouTube sharing parameters: Miss Monique, [`7dpUz_M3kp8`](https://www.youtube.com/watch?v=7dpUz_M3kp8), and KSHMR, [`HnSTnffuRRs`](https://www.youtube.com/watch?v=HnSTnffuRRs). Normalize supported YouTube URL forms to their video ID and deduplicate by recording identity rather than raw URL or artist display name. Different videos by the same artist can represent separate sets and must remain distinct. The [2019 page](https://ultramusicfestival.com/live-sets/season/2019), for example, lists two Armin van Buuren video IDs.

## Provenance, year and uploader attribution

Use Ultra Music Festival as the publisher of this source index. Preserve the exact filtered year page as evidence for the edition and the linked video as evidence for the recording. Artist display names on Ultra's page are not uploader names. The official footer identifies [UMF TV](https://www.youtube.com/umftv), but that channel link does not make every linked recording an UMF TV upload. [Ultra footer](https://ultramusicfestival.com/live-sets).

Public YouTube oEmbed responses already captured during this investigation illustrate the distinction: [Martin Garrix B2B Alesso 2026](https://www.youtube.com/watch?v=vBvZaydcCzc) reports author `Martin Garrix` and [Amelie Lens B2B Sara Landry 2026](https://www.youtube.com/watch?v=PmYE3d0GeLQ) reports author `Sara Landry`. Their titles identify the performance as 2026, agreeing with [Ultra's 2026 inventory](https://ultramusicfestival.com/live-sets/season/2026). Preserve the returned author name and author URL separately from the index publisher. oEmbed metadata is attribution evidence, not a verified-channel badge or a playback test.

The full five-year oEmbed pass covered all 181 globally unique YouTube IDs: **180 returned HTTP 200 with title and author metadata, and one returned HTTP 401**. The unresolved ID is [`QuW1fTqxXwk`](https://www.youtube.com/watch?v=QuW1fTqxXwk), listed as `Black Tiger Sex Machine Presents Connected Fighters` by [Ultra's 2026 page](https://ultramusicfestival.com/live-sets/season/2026). The 401 is a metadata lookup failure only. It does not establish whether the video is private, deleted, region-restricted or unplayable. Keep it as one unresolved metadata omission; do not invent a title, uploader or failure reason.

The title review found no conflicting performance year or event among the 180 metadata responses. Of those titles, 178 contain the expected four-digit year as a separate numeric token. Two require explicit handling rather than a strict word-boundary year expression:

- [Marshmello, `5yBSJ2Z6pjY`](https://www.youtube.com/watch?v=5yBSJ2Z6pjY): `MARSHMELLO - LIVE at Ultra Music Festival Miami #ULTRA2019`. The year is in the `#ULTRA2019` hashtag, agreeing with [Ultra's 2019 season](https://ultramusicfestival.com/live-sets/season/2019).
- [Dubfire B2B Ilario Alicante, `coJzawYORs0`](https://www.youtube.com/watch?v=coJzawYORs0): `Dubfire B2B Ilario Alicante @ Ultra Miami 23.03.24`. The performance-date suffix agrees with [Ultra's explicit 2024 season](https://ultramusicfestival.com/live-sets/season/2024); the route and matching active season establish the full year.

No performance year is derived from an upload date. Preserve source-page edition evidence and video metadata together, and do not overwrite an explicit conflict with source-page grouping.

## Reconciliation and reproducible inventory digests

An independent recount of the five season captures matched the initial enumeration. The saved HTML SHA-256 matched its capture manifest for all five years. All 181 source YouTube IDs have exactly one metadata result. Deduplicating the 2025 repeats and holding back the unresolved 2026 ID leaves the following metadata-backed candidate set:

| Edition | Unique source YouTube IDs | Metadata-backed candidates | Unsupported SoundCloud entries | Unresolved YouTube metadata |
| --- | ---: | ---: | ---: | ---: |
| 2019 | 22 | 22 | 6 | 0 |
| 2023 | 33 | 33 | 0 | 0 |
| 2024 | 46 | 46 | 1 | 0 |
| 2025 | 32 | 32 | 0 | 0 |
| 2026 | 48 | 47 | 0 | 1 |
| Total | **181** | **180** | **7** | **1** |

The seven existing Ultra IDs are all present in the metadata-backed set: `i_BPdQ-FidY`, `vBvZaydcCzc`, `hQ6k0_Iura0`, `3-ELBiUkUWc`, `w3zCxh-70Ms`, `uPhsq1msjl8` and `fz-3arJT8fc`. Preserve those existing catalog objects rather than replacing them from regenerated metadata. The net candidate addition is **173 recordings**, calculated as 180 metadata-backed IDs minus the seven existing IDs. These counts describe source reconciliation; catalog implementation and runtime verification are separate checks.

For each digest below, deduplicate IDs case-sensitively, sort with ordinal string ordering, join with LF without a trailing newline, encode as UTF-8 without a BOM, and compute SHA-256. The source column includes every YouTube ID linked from that year's official inventory. The candidate column includes only IDs whose oEmbed lookup returned HTTP 200.

| Edition | Source YouTube ID SHA-256 | Candidate ID SHA-256 |
| --- | --- | --- |
| 2019 | `ed06d7bb2f617c1886b26f0680e1dd9ad872699afa9f59daa1ac6f82cdb2cc33` | `ed06d7bb2f617c1886b26f0680e1dd9ad872699afa9f59daa1ac6f82cdb2cc33` |
| 2023 | `da45de32b9c23fc2964c4a55e412e49ebeb0850a65db3311f058600a7972888c` | `da45de32b9c23fc2964c4a55e412e49ebeb0850a65db3311f058600a7972888c` |
| 2024 | `230d1ef92a90925f1d3c4c1452e6f09a6104c57e8d8585325582de4ac506ff7b` | `230d1ef92a90925f1d3c4c1452e6f09a6104c57e8d8585325582de4ac506ff7b` |
| 2025 | `59d94f7b16fc2764c12098f55fddbac54b0200ed923c33770b14c94ce109bd59` | `59d94f7b16fc2764c12098f55fddbac54b0200ed923c33770b14c94ce109bd59` |
| 2026 | `842165c4685209bf9027efb5ad2ece6866ea68cecb06ced2be413fab3d93a291` | `cd0f8b2dccdf82336a2d441c48de59772281b74233abce4ab09bdab3f960ea89` |

The 173 new candidate IDs have SHA-256 `6a3ef9491bc496bb178b0330ca039249613354c00aada627fd80121101895238` under the same algorithm. Their `(videoId, title)` reconciliation digest is `f7bb519bb47fb3f7284d97ad4e72ace237bf07487393df39af2ca362d00e820e`: sort by ordinal video ID, serialize each line as the exact ID, one tab and the exact returned oEmbed title, join lines with LF without a trailing newline, then hash UTF-8 without a BOM. None of these titles contains a tab or newline.

## What is verified and what remains separate

Verified in this audit:

- The official year route and pagination contract, through the site's own public JavaScript and server-rendered payloads.
- HTTP 200 for the five requested year pages and the unfiltered second page.
- The matching active season, all returned media rows, provider counts and two duplicate video IDs in 2025.
- HTTP 404 for page 2 of each requested filtered year.
- All 181 unique source IDs reconciled against metadata, including 180 successful responses and one unresolved HTTP 401.
- Title/year review, both exceptional year formats, all seven existing IDs, the 173 net additions and independently calculated ID/title digests.

Still separate from this source enumeration:

- Checking content eligibility, duration, embedding restrictions, region restrictions and actual browser playback.
- Deciding whether SoundCloud belongs in the product's playback contract.
- Proving completeness beyond Ultra's currently published editorial inventory.

No primary-source-owned annual YouTube playlist was established during this audit. This is a discovery limit, not evidence that such playlists do not exist. Third-party playlists and articles were not used as recording or completeness evidence. The verified official year pages supply the bounded source inventories directly.

No media was downloaded. No production service, credentials, runtime, deployment or database was accessed. Raw HTML, response headers and private diagnostic captures are intentionally excluded from this document.
