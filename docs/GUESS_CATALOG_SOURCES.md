# Authorized Guess the Song catalog preparation

`prepareOperatorGuessInventory` is a provider-neutral, trusted server injection
for at most eight preapproved recordings. It returns the existing `GuessCatalog`
and `GuessMediaSource` interfaces plus `dispose()` to release the prepared bytes.
It does not configure the application, activate a provider, download media, read
files, expose an upload endpoint or supply a real-song inventory. The default
application catalog stays unavailable.

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
provider access. Do not enable `GUESS_SYNTHETIC_TEST` at the same time.

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
   Only `2010s` and `edm-classics` are accepted category IDs. Membership is
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
   a new reviewed preparation is needed for another pilot. Disable the option
   to return to the default behavior.

This is a limited pilot, not an always-on hit library. A later paid provider can
implement the same `GuessCatalog`/`GuessMediaSource` interfaces while keeping game
rules, player authorization and scoring. Its delivery, reporting and territory
requirements must be checked before assuming it can use this WAV transport.

Each private record supplies song metadata, explicit category membership,
canonical WAV bytes and an operator approval with an HTTPS evidence reference
and permission expiry. References receive syntax checks only. Neither approval
flags nor a successful preparation establish legal rights. Keep agreements,
recordings, deployment details and credentials out of the public repository.

Preparation copies and validates mono 16 kHz, 16-bit PCM WAV envelopes between
15 and 30 seconds. Actual decoded PCM length determines catalog duration. Input
metadata cannot supply duration or media keys; random opaque keys are generated
internally. Buffers and metadata are copied, and each read returns fresh bytes.
The entire snapshot expires at the earliest permission expiry or after five
minutes. Expiration/disposal makes categories unavailable, rejects selection and
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
