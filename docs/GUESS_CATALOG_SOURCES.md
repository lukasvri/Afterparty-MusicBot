# Authorized Guess the Song catalog preparation

`prepareOperatorGuessInventory` is a provider-neutral, trusted server injection
for at most eight preapproved recordings. It returns the existing `GuessCatalog`
and `GuessMediaSource` interfaces plus `dispose()` to release the prepared bytes.
It does not configure the application, activate a provider, download media, read
files, expose an upload endpoint or supply a real-song inventory. The default
application catalog stays unavailable until a source is explicitly selected.
The bundled [EDM pack](#play-the-bundled-pack) can now be selected directly;
custom operator inventories retain the approval-aware path described below.

The release target requires recognizable commercial hits. A freely licensed
independent or classical catalog can support development, but does not replace
that product requirement. No provider agreement or playable commercial inventory
has been established.

The [music source investigation](MUSIC_SOURCE_INVESTIGATION.md) compares Jockie's
documented quiz behavior with an independently documented metadata/playback
architecture and Afterparty's actual resolver. Optional Deezer metadata matching
for ordinary music is separate from a playable quiz inventory.

## Deezer preview preparation adapter

`prepareDeezerGuessInventory` in `services/core/src/guess-deezer.ts` is a separate
trusted preparation function for up to eight explicitly approved Deezer track
IDs. A caller supplies category membership, the same private permission record
used by the operator inventory, and a cancellation signal. No browser uploads,
public URL input or automatic chart discovery is added. The normal catalog
remains unavailable unless the operator explicitly configures the separate
pilot below. `DEEZER_METADATA=1` does not activate this adapter.

The function requests fixed `api.deezer.com/track/{id}` metadata, verifies the
returned track identity, readability, title/artist and preview address, then
fetches the short MP3. The initial allowlist only accepts exact
`cdns-preview-0` through `cdns-preview-f.dzcdn.net` hosts and the legacy
`/stream/c-<32 lowercase hex>-<1 or 2 digits>.mp3` path, without queries,
credentials or redirects. Newer CDN formats fail closed and require review.
This is a conservative implementation boundary, not evidence that a particular
live API response still uses that format.

Metadata is limited to 512 KiB, MP3 input to 2 MiB, each I/O/decode step to ten
seconds, and the whole preparation to 45 seconds or earlier permission expiry.
Two preparations can run at once; each processes its tracks sequentially.
FFmpeg accepts MP3 bytes through a pipe only, with network/file protocols
disabled. A separate two-process limit, ten-second deadline and cancellation
kill the subprocess and retain its slot until it closes. Output is canonical
16 kHz mono 16-bit WAV, measured at 15 through 30 seconds, with a maximum of
960,044 bytes including the header. No title, artist or original MP3 tags are
included in the audio envelope.

Preparation is atomic: an invalid or unavailable track rejects the snapshot.
The existing operator inventory owns copied bytes and random media keys, expires
at the earliest approval expiry or five minutes from preparation start, and
supports explicit disposal. The caller's abort signal remains a lifetime signal:
aborting it after preparation also disposes the inventory. The existing private
round transport remains responsible for room, server and participant access.

Automated acceptance uses generated MP3 tones, controlled metadata/CDN responses,
real FFmpeg and the real two-participant HTTP transport. It does not contact
Deezer, retrieve commercial recordings, prove live availability, establish rights
or activate a provider in this work. Private rooms and a removal-contact page do not supply
music permissions. Live source verification and a recording inventory authorized
for the intended quiz use remain outstanding under the original task's scope.

### Local pilot configuration

The owner can opt into this five-minute pilot on their own test installation
after establishing permission for the selected recordings and quiz use. This
does not create a paid account. The startup factory reads an absolute private
JSON path only when `GUESS_DEEZER_PREVIEWS=1`; it rejects symlinks, non-regular
files, files above 32 KiB, empty inventories and malformed approvals before any
provider access. Do not enable `GUESS_SYNTHETIC_TEST` or `GUESS_YOUTUBE_CLIPS` at
the same time.

1. Keep `guess-deezer.local.json` outside the public source or in the ignored
   `.local` directory, readable only by the operator. Supply a JSON array with
   one to eight entries. Replace every placeholder below locally:

   ```json
   [
     {
       "trackId": "REPLACE_WITH_APPROVED_DEEZER_TRACK_ID",
       "categoryIds": ["2010s"],
       "permission": {
         "approved": true,
         "reference": "https://REPLACE_WITH_PRIVATE_PERMISSION_REFERENCE",
         "expiresAt": 0
       }
     }
   ]
   ```

   `expiresAt` is the actual permission expiry in Unix milliseconds, not zero.
   The `2010s`, `edm-classics` and `edm-festival-hits` category IDs are accepted. Membership is
   assigned explicitly; the provider does not infer it. The reference is checked
   for syntax, not legal validity. Do not treat an approval flag as a license.
2. On the local test installation set `GUESS_DEEZER_PREVIEWS=1` and
   `GUESS_DEEZER_INVENTORY_PATH` to that file's absolute path. Leave both unset
   for the default unavailable catalog. This option is separate from ordinary
   `DEEZER_METADATA` matching.
3. Start Core through the normal local test workflow. Failed preparation logs
   one generic warning and leaves the quiz unavailable; ordinary playback stays
   available. This cloud task does not run the production entry point.
4. Check capacity in the lobby, choose a duration and round count that fit, and
   verify with two devices. Test late join, seek alignment, reveal/skip audio
   cancellation, expired catalog rejection and unchanged ordinary queues. Each
   participant taps Listen because browsers may block autoplay.
5. The snapshot lasts at most five minutes from preparation start. There is no
   automatic refresh or fallback to another provider. Shutdown disposes it;
   an explicit [local reload](#reload-without-restarting-music) can prepare another snapshot without restarting music. Disable the option
   to return to the default behavior.

This is a limited pilot, not an always-on hit library. A later paid provider can
implement the same `GuessCatalog`/`GuessMediaSource` interfaces while keeping game
rules, player authorization and scoring. Its delivery, reporting and territory
requirements must be checked before assuming it can use this WAV transport.

### Check the configuration before startup

Use the isolated source check before changing a running Core. With the intended
quiz environment already loaded, run this from `services/core/`:

```sh
npm run guess:check
```

To load the existing private local environment file explicitly instead:

```sh
node --env-file=.env src/guess-check.ts
```

With all quiz modes disabled, the check reports disabled without reading the
inventory or contacting a provider. `GUESS_SYNTHETIC_TEST=1` checks only the
fictional generated-tone source. The Deezer mode uses the same private-file
validation, bounded metadata/CDN requests and FFmpeg normalization as startup;
it requires the configured approved inventory and a local FFmpeg installation.

The JSON result contains source readiness and bounded category capacities and
durations. It excludes song answers, recording IDs, preview addresses, permission
references and local paths. An unavailable or invalid source exits unsuccessfully
with a generic result. Successful and failed checks dispose temporary resources;
the command never starts a Discord client, opens a Core server, changes a queue
or installs/refreshes the snapshot in an existing process. A successful check is
evidence for that attempt, not a guarantee of later availability or verified
permissions.

## YouTube audio-clip pilot

`GUESS_YOUTUBE_CLIPS=1` selects a separate private quiz source using the bot's
yt-dlp and FFmpeg toolchain. A fixed public video ID is resolved to an audio-only
WebM or MP4 stream. A bounded download feeds FFmpeg through a pipe; the decoder
uses no network/file protocols and produces only the selected 15–30-second,
16 kHz mono WAV segment. Participants receive these answer-safe clips through
the existing private round transport. The quiz uses its audio player without a
YouTube iframe, and never plays through or alters the ordinary Discord queue.

For the bundled eight-song selection, use [direct pack setup](#play-the-bundled-pack)
instead of creating a private file. For a custom selection, leave
`GUESS_YOUTUBE_PACK` empty, keep a private inventory outside public source and point
`GUESS_YOUTUBE_INVENTORY_PATH` at its absolute path. The regular-file, symlink and
32 KiB limits are shared with the Deezer pilot. Supply one to eight records:

```json
[
  {
    "videoId": "REPLACE_WITH_11_CHARACTER_VIDEO_ID",
    "title": "REPLACE_WITH_SONG_ANSWER",
    "artist": "REPLACE_WITH_ARTIST_ANSWER",
    "aliases": [],
    "categoryIds": ["2010s"],
    "startSeconds": 30,
    "durationSeconds": 15,
    "permission": {
      "approved": true,
      "reference": "https://REPLACE_WITH_PRIVATE_PERMISSION_REFERENCE",
      "expiresAt": 0
    }
  }
]
```

Use the actual recording, answer and existing permission record locally.
Offsets run from zero through 3600 seconds; durations are whole seconds
from 15 through 30. Omitted values use offset zero and duration 30. Categories
are `2010s` and `edm-classics`. Duplicate video IDs are rejected before any
extraction. Do not commit the filled inventory, answers, recordings or agreements.

Enable only one of `GUESS_YOUTUBE_CLIPS`, `GUESS_DEEZER_PREVIEWS` and
`GUESS_SYNTHETIC_TEST`. Run `npm run guess:check` with the intended configuration
before starting Core; its `youtube` result reports capacity without answers or
source URLs. yt-dlp and FFmpeg must be installed locally, as they already are in
the Core image. The adapter ignores yt-dlp configuration and supplies no cookies,
login or account credentials. It rejects unavailable/live/mismatched recordings,
unsupported formats, external redirects and non-Googlevideo media endpoints.

Encoded input is capped at 8 MiB per recording; I/O steps have ten-second
deadlines and one preparation has a sixty-second deadline. At most two
preparations run concurrently. All providers share two FFmpeg decoder slots,
retained until each process closes. A long or large recording can fail these
limits even when its requested segment is short. Preparation is atomic, and the
snapshot expires at the earliest permission expiry or after thirty minutes from
preparation start. There is no automatic refresh of a running pilot.

This separate source avoids relying on YouTube's embedded player for the quiz.
It does not establish permission under YouTube or recording-rights terms, and
does not bypass login, age, regional or access restrictions. Automated checks use
generated encoded audio and controlled extractor/CDN responses. Actual YouTube
availability, sustained operation and real-device listening remain unverified.

Each private record supplies song metadata, explicit category membership,
canonical WAV bytes and an operator approval with an HTTPS evidence reference
and permission expiry. References receive syntax checks only. Neither approval
flags nor a successful preparation establish legal rights. Keep agreements,
recordings, deployment details and credentials out of the public repository.

Preparation copies and validates mono 16 kHz, 16-bit PCM WAV envelopes between
15 and 30 seconds. Actual decoded PCM length determines catalog duration. Input
metadata cannot supply duration or media keys; random opaque keys are generated
internally. Buffers and metadata are copied, and each read returns fresh bytes.
Generic and Deezer snapshots expire at the earliest permission expiry or after
five minutes. The YouTube adapter uses a bounded thirty-minute lifetime instead.
It cannot extend any recording permission. Expiration/disposal makes categories unavailable, rejects selection and
media access, and releases stored bytes. Authorization and cancellation are
checked before and after the asynchronous read boundary. Revocation before
expiry requires calling `dispose()` and preparing a new reviewed snapshot.

The existing authenticated media transport still owns room, guild, participant,
session and round authorization. Injected inventories do not grant those rights.
Host duration and round settings must fit the measured lengths and distinct
eligible inventory. This adapter cannot supply 31–90-second rounds or more than
eight distinct recordings. It does not alter existing game settings or routes.

Catalog summaries can include an ascending `durations` histogram of whole-second
clip lengths and recording counts. Lengths are floored and capped at 90 seconds;
each recording contributes to one bin. The sum equals the category count. The
lobby uses it to reject a duration or round count that exceeds the eligible
inventory before starting. Expired inventories report no available bins. This
public capacity information contains no recording IDs, titles, aliases, media
keys or permission references. The server remains authoritative and older
catalogs without histograms retain their existing compatibility.

## Prepared EDM festival hits pack

The Core-only `services/core/quiz-playlists.json` contains eight official-source
recordings: Janji, Lost Sky, Avicii, Martin Garrix, Zedd, Swedish House Mafia and
David Guetta. It supplies canonical answers and a 30-second segment starting at
30 seconds. The named `EDM festival hits` category becomes available when its
prepared inventory is loaded. The public festival catalog is separate and does
not import these answers, clip offsets or approval references into the browser.

### Play the bundled pack

On the intended local installation, select the pack in Core's private environment:

```dotenv
GUESS_YOUTUBE_CLIPS=1
GUESS_YOUTUBE_PACK=edm-festival-hits
GUESS_YOUTUBE_INVENTORY_PATH=
GUESS_DEEZER_PREVIEWS=0
GUESS_SYNTHETIC_TEST=0
```

With the existing private `.env` in `services/core/`, run the isolated check:

```sh
node --env-file=.env src/guess-check.ts
```

A successful result reports provider `youtube`, status `ready` and eight
30-second recordings in each supported category. The check disposes its temporary
audio; Core prepares its own snapshot on its next normal local startup. No
hand-built song or approval file is needed for this preset. It selects known
recording identities without inventing permission records or treating source
publication as a license. Custom approval-aware inventories remain supported
separately. Select exactly one pack or custom path; an unknown pack or both
selectors fails before provider access.

Once matching website/Core builds and this configuration are installed, open
**Games**, enter the existing room code or follow its Discord game link, and
join with a nickname. The host chooses **EDM festival hits**, **Classic
(30 seconds)**, and up to eight rounds, then saves settings and starts. Each
participant taps **Listen to preview** and answers; the host advances after
reveal. The pack's default five 30-second rounds also fit without editing.
The source is independent of ordinary music queues and their volume controls.

The source downloads and normalizes the selected clips using the existing
bounded yt-dlp/FFmpeg pipeline. A provider failure leaves the source unavailable
and does not claim playback succeeded. Opening the game or reading the catalog
never starts a provider download or enables a source. This source change is not
an installation or deployment.

### Custom approval-aware inventory

The existing export command remains available for operators who use a private
per-record approval inventory. Run from the repository root:

```sh
npm --prefix services/core run guess:pack -- --list
mkdir -p .local
npm --prefix services/core run guess:pack -- \
  --pack edm-festival-hits \
  --out /absolute/path/to/Afterparty/.local/guess-youtube.local.json
```

This creates an inactive template, never fabricated permission. The file is
created with mode `0600`, and an existing file is never overwritten. Review and
complete the existing per-record approval fields locally. Alternatively provide
`--approval-file /absolute/private/guess-approvals.local.json` to generate a
complete inventory from existing approvals. That private file must contain all
eight exact video IDs, each once, with this shape:

```json
[
  {
    "videoId": "REPLACE_WITH_ONE_PACK_VIDEO_ID",
    "permission": {
      "approved": true,
      "reference": "https://REPLACE_WITH_PRIVATE_PERMISSION_REFERENCE",
      "expiresAt": 0
    }
  }
]
```

Use actual existing references and a future Unix-millisecond expiry for each
record. Missing, duplicate, foreign or expired approvals reject the entire
operation before output. The manifest's source verification is metadata evidence,
not an approval record. The CLI does not download audio, connect to Discord or
activate a source. Paths and answers are omitted from its status output.

Leave `GUESS_YOUTUBE_PACK` empty. Set `GUESS_YOUTUBE_CLIPS=1` and the absolute generated file path as
`GUESS_YOUTUBE_INVENTORY_PATH` on the intended local installation. Disable other
quiz modes and run `npm --prefix services/core run guess:check` before Core starts.
An inactive template deliberately fails this check. Actual media/provider
availability is determined during preparation, not by the playlist file.

The bounded YouTube snapshot lasts at most thirty minutes from preparation start,
or less if a recording approval expires. An eight-round, two-player generated
30-second match with lobby and reveal pauses is tested across the former
five-minute boundary. Expiry and disposal still revoke pending and future media
reads. There is no automatic refresh or promise of uninterrupted indefinite play.

## Reload without restarting music

On a matching updated Core, an explicit local `SIGHUP` retries an unavailable or
expired quiz source. For the supplied Compose control script, run:

```sh
services/core/core-control.sh guess-reload
```

This uses the existing selected Compose file, including an ignored local override.
For a directly managed Node process, send `SIGHUP` to that Core process using its
normal process manager. Use this only after installing the build with the reload
handler; older builds may terminate on that signal.

A healthy snapshot is kept unchanged, so a reload cannot replace active round
keys. Concurrent signals share one bounded preparation. Failed preparation stays
unavailable, and shutdown cancels pending work and prevents late publication.
The manager changes only private quiz catalog/media references, without restarting
the bot, logging into Discord again, changing queues or touching playback.

An expired match cannot resume its old media keys: end it and start a new game
after a successful reload. The same selected configuration is retried. Private
inventory files are reread, but environment variables remain those of the running
process. Changing the selected mode or pack still requires a normal locally
managed configuration update. There is no timed/background refresh and no public
reload endpoint. `guess:check` remains an isolated check and does not reload the
running source.

## Source choices and unresolved rights

- Prefer operator-owned or expressly licensed recordings when permission covers
  the recording, underlying composition, quiz delivery, processing, audience,
  territories and duration of use. Possessing a file or subscription is not
  evidence of these permissions.
- Individually reviewed CC0/public-domain recordings can support a small pilot.
  [CC0](https://creativecommons.org/publicdomain/zero/1.0/) permits broad reuse
  but does not warrant a particular recording's status or clear every other
  right. Check both recording and composition and applicable jurisdictions.
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) requires appropriate
  credit, license links and change notices. Resolve attribution during hidden
  answer rounds before admitting such media. Metadata removal alone does not
  satisfy attribution. [Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
  requires checking each media file's actual terms and provenance.
- [Spotify's Developer Policy](https://developer.spotify.com/policy), section
  III.2, prohibits games including trivia quizzes. Section V limits preview use.
  Standard Spotify access is not a supported authorization route for this quiz.
- [YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies#i.-additional-prohibitions)
  prohibit separated audio and hidden/background players. A visible embed is a
  different integration; it does not authorize a PCM extraction/proxy adapter.
  The [official player parameters](https://developers.google.com/youtube/player_parameters#revision_history)
  no longer support hiding video titles with `showinfo`. A visible player on
  each remote participant's device can reveal the answer. A presenter-only
  player with shared speakers would instead require everyone to be in the same
  room, which does not satisfy the current remote-play requirement. Neither
  approach is implemented or claimed to clear music rights here.
- [Deezer's developer terms](https://developers.deezer.com/termsofuse) restrict
  standard use to noncommercial/private family contexts and require approval
  for other purposes. A reachable preview does not authorize public quiz use.

## Commercial-hit candidates and launch requirements

[Feed Clips explicitly describes music trivia and multiplayer rounds](https://blog.feed.fm/dont-miss-a-beat-why-music-trivia-apps-need-licensed-music-clips).
However, its [current geographic requirements](https://clips.feed.fm/docs/Licensing%20Requirements/Geographic%20Restrictions/)
limit the standard catalog to the United States and its territories. That is
not a ready launch solution for listeners in Norway. Its
[pricing page](https://www.feed.fm/pricing-page) requires a customized proposal;
no price, account, agreement or territory extension has been approved here.

Songclip has historical partnerships covering music in gaming apps, documented
by [Warner Music Group](https://www.wmg.com/news/warner-music-group-partners-songclip-power-music-feature-35511)
and [Universal Music Group](https://www.universalmusic.com/songclip-announces-multi-year-agreement-with-universal-music-group-and-universal-music-publishing-group/).
Those announcements do not establish current onboarding, pricing, Norway
coverage or permission for this application. No Songclip adapter is enabled.

Before selecting any provider, obtain an agreement covering the intended
countries, multiplayer quiz use, hidden answers, sample lengths, delivery,
permitted caching/processing, usage reporting and rights expiry/revocation.
Confirm whether the provider requires its own player or direct streams before
assuming the existing private PCM transport is permitted. A subscription or a
successful preview API response is not a substitute for these terms. Do not
proxy through another territory to evade a provider's geographic restrictions.

These source comparisons are implementation guidance, not verification of any
recording's rights. No public playable music inventory or provider permission
was established. Provider activation, real inventory ingestion and live release
remain separate approval boundaries under [AGENTS.md](../AGENTS.md) and
[the v3 readiness issue](https://github.com/lukasvri/Afterparty-MusicBot/issues/92).
