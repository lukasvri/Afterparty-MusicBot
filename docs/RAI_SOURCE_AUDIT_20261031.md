# Amsterdam RAI source audit, 31 October 2026

This audit finds **16 distinct official concert-recording links** for the existing
2018, 2019 and 2023 groups: one, seven and eight respectively. Three already
exist in `lib/concert-catalog.ts`; **13 STMPD RCRDS recordings are additional
catalog candidates**. This is an enumerated snapshot of the sources below, not
an archive of every RAI performance or every official upload anywhere.

The source work reads public metadata only. The 13 candidates also passed the
individual metadata checks described below. This does not establish actual
embedding, territorial access, current playable media, CDN reachability or
audible playback. Nothing in this audit changes queues or production; catalog
integration is a separate source edit.

## Sources and enumeration boundary

| Primary source | Returned inventory | Boundary and reconciliation |
| --- | ---: | --- |
| [Martin Garrix, THE ETHER playlist](https://www.youtube.com/playlist?list=PLOPmDfV0hAMbsTZQVTWiCNLcrErCDl_VO) | 7 entries, publisher count 7 | All seven have titles, IDs and durations; seven unique IDs. Six STMPD support recordings plus the existing Garrix recording. This is a complete snapshot of this playlist only. |
| [STMPD RCRDS channel search for RAI](https://www.youtube.com/@STMPDRCRDS/search?query=RAI) | 13 entries | Six titles identify 2019 and seven identify 2023. The signed-out browser showed the same 13 unique IDs, with no further results after reaching the end. The metadata enumeration also returned 13. Search ranking and matching are publisher/platform-controlled; this is not the full channel archive. |
| [Martin Garrix channel search for RAI](https://www.youtube.com/@MartinGarrix/search?query=RAI) | 29 entries | Includes the three existing RAI recordings, three playlists, aftermovies, a documentary episode, shorts and unrelated live shows. Only the three existing recordings qualify within the requested event/year scope. |
| [Martin Garrix, Liveshows playlist](https://www.youtube.com/playlist?list=PLOPmDfV0hAMZG1U05-KeLnpxEFGVTIXoD) | 48 entries, publisher count 48 | All 48 were enumerated. Within the requested RAI groups, it contains the same three existing recordings and the 2018 aftermovie. It supplies no additional distinct RAI concert recording. |
| [STMPD RCRDS channel search for RAI 2023](https://www.youtube.com/@STMPDRCRDS/search?query=RAI%202023) | 117 rows, publisher count 117; 112 unique IDs | Seven titles identify RAI 2023, matching the seven already found above. Other returned rows include unrelated years, music videos, shorts and playlists. This query is not a seven-entry event archive. |

All five public metadata enumerations completed successfully with a 501-entry
ceiling, zero retries and bounded timeouts; none reached that ceiling. The two
playlists returned their full published counts. No unvisited continuation or
truncated first-page result is being counted as a complete playlist. Channel
search results are explicitly bounded by the query and capture, even when the
extractor finishes successfully. Ordering differed between the browser and
metadata response; the STMPD ID sets matched.

The year-specific query also completed below the ceiling. Its 117 returned
rows must remain the raw source count if that URL is used as discovery evidence;
seven is the count selected for RAI 2023, not the query's full inventory count.
The broader 13-result RAI query likewise mixes two event years. Only the
seven-entry THE ETHER playlist is a verified single-year RAI recording index
in this audit. For the mixed 13-row source, preserve its actual count and
explicitly explain which returned records belong to the other event year.

The returned channel identities were `UCB-7IEpKGIdXkgGUObE5D5A` for STMPD RCRDS
and `UC5H_KXkPbEsGs0tFt8R35mA` for Martin Garrix. The public metadata captures
and candidate JSON are retained in private diagnostics, outside the repository.
No media was downloaded and no account was used.

## Recording inventory and catalog reconciliation

The displayed titles below are the current primary-source metadata titles.
The recording title supplies the performance year. Upload dates never replace
that year: the [DubVision upload](https://www.youtube.com/watch?v=-WVNVCDwZMw),
for example, was published in February 2024 while its title and description
identify the RAI/ADE 2023 support performance.

| Year | Artist | Exact source title and canonical video link | Publisher | Catalog action |
| --- | --- | --- | --- | --- |
| 2018 | Martin Garrix | [Martin Garrix Presents: ANIMA (Live @ Amsterdam RAI 2018)](https://www.youtube.com/watch?v=CwE-haZR2fc) | Martin Garrix | Retain existing `CwE-haZR2fc` |
| 2019 | Martin Garrix | [MARTIN GARRIX LIVE @ THE ETHER (Amsterdam RAI 2019)](https://www.youtube.com/watch?v=lGCo8ILvauI) | Martin Garrix | Retain existing `lGCo8ILvauI` |
| 2019 | Infuze | [INFUZE \| MARTIN GARRIX LIVE @ THE ETHER (Amsterdam RAI 2019)](https://www.youtube.com/watch?v=ZBKjHhgI7mI) | STMPD RCRDS | Add candidate `ZBKjHhgI7mI` |
| 2019 | Bart B More b2b Silque | [BART B MORE b2b SILQUE \| MARTIN GARRIX LIVE @ THE ETHER (Amsterdam RAI 2019)](https://www.youtube.com/watch?v=W-bAMAjNUBg) | STMPD RCRDS | Add candidate `W-bAMAjNUBg` |
| 2019 | Blinders b2b TV Noise | [BLINDERS b2b TV NOISE \| MARTIN GARRIX LIVE @ THE ETHER (Amsterdam RAI 2019)](https://www.youtube.com/watch?v=BJhRHlyLEQU) | STMPD RCRDS | Add candidate `BJhRHlyLEQU` |
| 2019 | Osrin | [OSRIN \| MARTIN GARRIX LIVE @ THE ETHER (Amsterdam RAI 2019)](https://www.youtube.com/watch?v=oxHRr60uIQk) | STMPD RCRDS | Add candidate `oxHRr60uIQk` |
| 2019 | LOOPERS | [LOOPERS \| MARTIN GARRIX LIVE @ THE ETHER (Amsterdam RAI 2019)](https://www.youtube.com/watch?v=jCwLMRd7tEM) | STMPD RCRDS | Add candidate `jCwLMRd7tEM` |
| 2019 | Brooks b2b Julian Jordan | [BROOKS b2b JULIAN JORDAN \| MARTIN GARRIX LIVE @ THE ETHER (Amsterdam RAI 2019)](https://www.youtube.com/watch?v=rl1qMd9BSq0) | STMPD RCRDS | Add candidate `rl1qMd9BSq0` |
| 2023 | Martin Garrix | [MARTIN GARRIX LIVE @ IDEM (Amsterdam RAI 2023)](https://www.youtube.com/watch?v=cWJV0DgMqEA) | Martin Garrix | Retain existing `cWJV0DgMqEA` |
| 2023 | DubVision | [DubVision Live @ RAI Amsterdam 2023](https://www.youtube.com/watch?v=-WVNVCDwZMw) | STMPD RCRDS | Add candidate `-WVNVCDwZMw` |
| 2023 | Julian Jordan | [Julian Jordan Live @ RAI Amsterdam 2023](https://www.youtube.com/watch?v=6MypJqE9Oss) | STMPD RCRDS | Add candidate `6MypJqE9Oss` |
| 2023 | Merow | [Merow Live @ RAI Amsterdam 2023](https://www.youtube.com/watch?v=zRtiz6pJOOY) | STMPD RCRDS | Add candidate `zRtiz6pJOOY` |
| 2023 | Blinders | [Blinders Live @ RAI Amsterdam 2023](https://www.youtube.com/watch?v=lM1YRKdANS4) | STMPD RCRDS | Add candidate `lM1YRKdANS4` |
| 2023 | Citadelle | [Citadelle Live @ RAI Amsterdam 2023](https://www.youtube.com/watch?v=QE_Xz_17Fyc) | STMPD RCRDS | Add candidate `QE_Xz_17Fyc` |
| 2023 | NUZB | [NUZB Live @ RAI Amsterdam 2023](https://www.youtube.com/watch?v=l8y0KXyk0fA) | STMPD RCRDS | Add candidate `l8y0KXyk0fA` |
| 2023 | Eleganto | [Eleganto Live @ RAI Amsterdam 2023](https://www.youtube.com/watch?v=KjuadJFaYZ8) | STMPD RCRDS | Add candidate `KjuadJFaYZ8` |

All 13 candidates are individually named live performances, with the title and
description associating them with the relevant Garrix RAI production. The
six 2019 candidates also appear in the artist-owned THE ETHER playlist.
The seven 2023 descriptions identify support, opening or closing sets for IDEM
during ADE 2023, rather than a separate concert at another Amsterdam venue.

## Separate shows and missing-performance boundary

[E&A's event archive](https://ea-events.com/concept/martin-garrix-ade/) identifies
two RAI events in each requested year: 19 and 20 October 2018, 18 and 19 October
2019, and 20 and 21 October 2023. The archive marks the first date as 18+ and
the second as all ages for 2018/2019. The
[2023 organiser page](https://ea-events.com/events/martin-garrix-ade-2023-saturday/)
does the same for 2023. The
[venue's 2023 notice](https://www.rai.nl/en/neighbourhood-news/amsterdam-dance-event-2023)
independently distinguishes Friday's event from Saturday's all-ages event.
These are event facts, not evidence that two videos were published.

The organiser publishes explicit 2019 running orders:

| Event | Scheduled performances | Recordings represented in the seven-link playlist |
| --- | --- | --- |
| [18 October, 18+](https://ea-events.com/events/martin-garrix-ade-2019-18/) | Infuze; Eauxmar; Bart B More b2b Silque; LOOPERS; Martin Garrix; Matisse & Sadko; Dyro | Infuze, Bart B More b2b Silque and LOOPERS have artist-specific links. No distinct Eauxmar, Matisse & Sadko or Dyro recording is in the enumerated playlist. |
| [19 October, all ages](https://ea-events.com/events/martin-garrix-ade-2019-all-ages/) | Todd Helder; Blinders b2b TV Noise; Osrin; Martin Garrix; Brooks b2b Julian Jordan | Blinders b2b TV Noise, Osrin and Brooks b2b Julian Jordan have artist-specific links. No distinct Todd Helder recording is in the enumerated playlist. |

The seven-link playlist contains one Garrix recording across these two events.
Its title and returned description identify 2019, without independently assigning
it to one exact show date. This audit therefore does not label that upload 18+
or all ages, and does not duplicate it to represent both. Matching unique
support artists to the organiser's running order establishes which scheduled
event those named acts belong to, but does not certify that an upload contains
every minute of the scheduled performance.

For 2018 and 2023, the two enumerated channel searches and the artist's
Liveshows playlist supply only one Garrix recording per year. **No additional
distinct Garrix all-ages/18+ recording was identified within these sources.**
That is a source-coverage limit, not a claim that such recordings do not exist.
The IDEM description refers to two hometown shows, which cannot turn its one
video ID into two separately published performances.

## Exclusions and remaining uncertainty

- [The official 2018 aftermovie](https://www.youtube.com/watch?v=QI9rV3kppiY)
  is a 91-second recap, not another full concert set. It is excluded.
- The returned documentary episode, other-year videos, unrelated venues, shorts
  and playlists themselves are not additional concert recordings. A playlist
  link is evidence for its members, not another playable set.
- The artist website, STMPD website, organiser pages, RAI venue notice and ADE
  discovery did not provide an additional enumerated recording archive in this
  pass. The linked organiser site `martingarrixade.com` timed out in the web
  reader. The 2018 event detail routes were rate-limited; their dates and age
  labels are supported by E&A's concept archive instead.
- Search results from fan archives, tracklist sites, mirrors and reuploaders are
  not accepted as official recording evidence. No guessed video ID, inferred
  missing performance or upload-date-based performance year enters the inventory.
- The 2019 timetable proves that the seven-video playlist is smaller than the
  scheduled program. The other years also have two events but only one Garrix
  video in these sources. Consequently, none of the three groups should be
  described as every performance or a complete event archive.

## Actionable integration

At 01:19 UTC, all 13 candidate URLs returned HTTP 200 from both public oEmbed
and watch endpoints. Parsed endpoint and player IDs matched the requested IDs;
titles and publisher matched the candidate inventory. Player metadata supplied
positive durations from 1,615 to 3,577 seconds, `playabilityStatus.status=OK`
and `playableInEmbed=true` for all 13. Those fields describe the returned
provider metadata, not a successful embedded playback or listening test.
The private `rai-video-status.json` retains the per-video results.

The source candidate preserves the three existing catalog records and their
original evidence. The 13 additions pass the public metadata gate and use each
canonical video ID once within its event/year. The audit and video evidence
identify STMPD RCRDS as their uploader. The catalog's `sourcePublisher` names
the owner of each discovery index: Martin Garrix for the 2019 playlist and
STMPD RCRDS for the 2023 channel query. It does not infer uploader identity from
index ownership. Performance metadata establishes 2019 or 2023.

With these additions, catalog coverage becomes **1 recording for
2018, all 7 links from the captured THE ETHER playlist for 2019, and 8 discovered
official links for 2023**. Document that bounded claim and protect the source
ID sets in focused inventory regression checks. Keep separate-show gaps and
the 2019 scheduled acts without matching published links explicit. Do not
describe metadata validation as listening, embedding or production acceptance.

The recommended source-to-catalog mapping is:

| Catalog group | Source ownership and invariant |
| --- | --- |
| 2018 | Keep the existing curated ANIMA record. Do not call the unrelated 48-entry Liveshows playlist a one-entry complete RAI index. |
| 2019 | Use the seven-entry THE ETHER playlist, owned by Martin Garrix, as the source index. The audit and linked video evidence retain STMPD uploader attribution for the six additions; `sourcePublisher` names the playlist owner. All seven returned IDs are represented once. |
| 2023 | Use the 13-row STMPD RAI channel search as the bounded discovery snapshot: seven matching 2023 recordings plus six explicit out-of-year exclusions. Keep the existing Garrix IDEM record outside this index, giving eight catalog recordings for the year. |

The six out-of-year IDs in the 2023 source are `BJhRHlyLEQU`, `W-bAMAjNUBg`,
`ZBKjHhgI7mI`, `jCwLMRd7tEM`, `oxHRr60uIQk` and `rl1qMd9BSq0`. Each exclusion
should say that the recording identifies Amsterdam RAI 2019 rather than 2023,
and keep its canonical watch URL. These remain cataloged under 2019 through
THE ETHER; they are not globally discarded. Thus `13 = 7 selected + 6
out-of-year` describes the actual captured source without inventing a
seven-result year-specific query or claiming all performances were published.
