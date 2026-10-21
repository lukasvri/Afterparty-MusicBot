# Music source investigation and quiz direction

Checked on 21 October 2026 against official public documentation and Afterparty
source. This record distinguishes advertised behavior from an inspected media
implementation. It is not evidence of live playback or provider authorization.

## What Jockie documents

The [official FAQ](https://www.jockiemusic.com/faq) advertises Spotify and Deezer
tracks, albums, artists and playlists, alongside other sources. Its music quiz
uses 30-second rounds with separate title, artist and collaborator scoring.

The [quiz command reference](https://www.jockiemusic.com/commands?q=guess+the+song&selected=guess+the+song)
adds genre/year selection, custom Spotify playlists, seeds, configurable rounds
and victory score, round timing and answer-match options. It describes ending a
round when its answer components are found and voting to skip without a score
penalty. Custom games are excluded from its global rankings.

These are documented product capabilities. The pages do not disclose the
deployed audio resolver, credentials, provider agreements or cache/delivery
pipeline. A Spotify playlist input and a short round alone do not identify the
audio origin. Neither direct previews nor alternative-source matching can be
asserted as Jockie's implementation from those facts.

The public [Jockie Music GitHub organization](https://github.com/Jockie-Music)
exposes configuration and TLS libraries, while
[Jockie-Utils](https://github.com/21Joakim/Jockie-Utils) is a command framework.
Those repositories do not expose the deployed quiz/media backend. Direct web
page reads returned JavaScript shells; indexed official command text supplied
the feature details above. No deployed JavaScript bundle, authenticated bot
session, media transfer or real listening session was inspected. Conflicting
third-party descriptions were not used to infer the private backend.

## A concrete, separately documented architecture

[LavaSrc](https://github.com/topi314/LavaSrc#what-is-mirroring) explicitly separates
metadata sources from playable sources. It labels Spotify as mirrored playback
and Deezer as direct playback; mirroring resolves recording metadata and finds
playable audio through another source. Its current direct Deezer configuration
requires provider authentication and decryption configuration. An open-source
plugin's capabilities do not supply accounts, agreements or media rights for
another application. This is an independently documented example, not evidence
that Jockie runs LavaSrc.

Afterparty already implements a comparable separation for ordinary Spotify
links in [`Providers.resolve` and `matchSong`](../services/core/src/providers.ts):
load metadata, prefer an ISRC search, check recording version, artist and duration,
and reject unreliable matches. That existing Node.js/FFmpeg path can be extended
without introducing a second Java/Lavalink service or changing queues.

## This candidate's additions

| Capability | Afterparty behavior |
| --- | --- |
| Title or artist answers | Host selects one target per game. Artist mode requires the normalized full artist; title aliases cannot answer it. |
| Skip voting | One vote per joined actor and round; strict roster majority reveals the answer without rescoring or advancing. |
| Round presets | Quick 15-second and classic 30-second choices fit category capacity, then require the host to save. |
| Deezer links for ordinary music | Optional metadata lookup for canonical track, album and playlist links, followed by the existing strict source matcher. |
| Music quiz delivery | Existing private, authenticated per-device WAV transport with source expiry and cancellation checks. |
| Prepared Deezer quiz previews | Default-off local pilot for at most eight explicitly approved tracks. Fixed metadata/CDN requests, bounded MP3 decoding and the existing private transport are exercised with generated audio only. |
| YouTube audio-only quiz clips | Separate default-off pilot using yt-dlp and FFmpeg with curated video IDs, clip offsets and 15–30-second WAV output. Private per-participant audio uses the existing game transport without an embedded video player. Tests use generated WebM/M4A and controlled responses. |

Skip quorum counts the current joined anonymous roster, including disconnected
tabs. It does not establish unique people or online listeners. The host's reveal
control remains available. Round/session identity, replay limits, server receipt
times and strict host revision checks continue to apply.

`DEEZER_METADATA=1` is an explicit Core opt-in for ordinary link matching. It is
off by default. Requests use fixed public API endpoints, bounded pages/bytes and
deadlines; provider pagination URLs are never followed. Returned metadata excludes
preview URLs and Deezer IDs from the Spotify-specific enrichment contract. This
does not stream from Deezer or populate the game catalog. Provider reachability,
availability and live matching have not been established by synthetic fixtures.

Ordinary link matching also recognizes bounded `link.deezer.com/s/…` shares and
the five standard `utm_*` tracking fields on canonical Deezer links. Share
resolution follows at most three manual redirects within the supported Deezer
share/canonical paths, with per-request and total deadlines, fixed concurrency
and response-body cancellation. It never follows an external redirect or reads
a share page's HTML. Tracking is discarded before requests, and a track lookup
must return the requested recording ID. These additions remain separate from
quiz previews and do not add provider credentials or audio extraction.

The separate `prepareDeezerGuessInventory` function can prepare approved short
previews without making each player select local files. Startup requires the
separate `GUESS_DEEZER_PREVIEWS=1` opt-in and an absolute private inventory path;
`DEEZER_METADATA` does not enable it. Its strict legacy CDN
allowlist is deliberately conservative; current live URL formats, availability
and provider permission have not been verified. See the
[adapter contract](GUESS_CATALOG_SOURCES.md#deezer-preview-preparation-adapter)
for limits and the synthetic end-to-end acceptance boundary.

`GUESS_YOUTUBE_CLIPS=1` selects the separate audio-only source with a private
`GUESS_YOUTUBE_INVENTORY_PATH`. It shares the existing inventory expiry and
private round authorization while retaining independent decoding/resource limits.
Only one quiz source can be selected. This source does not establish live
YouTube availability or recording/provider permissions. See the
[YouTube pilot setup](GUESS_CATALOG_SOURCES.md#youtube-audio-clip-pilot).

## Remaining work

The remote quiz still needs a playable recognizable-hit inventory. Catalog
selection and playback authorization are separate from answer matching. See the
[catalog source comparison](GUESS_CATALOG_SOURCES.md) for the current boundary.

Further parity needs independently claimable answer components, explicitly
reviewed aliases/collaborator metadata, bounded playlist/genre/year preparation,
and completion/victory rules. Global rankings would additionally need durable
identity, custom-game separation and abuse controls. Those features are not
implied by the current title/artist selector or temporary scoreboard.

No account cookies, provider keys, Java plugin, actual recordings or third-party
implementation code were imported. The copyright request flow is a removal
contact channel, not permission to use a music source.
