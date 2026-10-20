# Authorized Guess the Song catalog preparation

`prepareOperatorGuessInventory` is a provider-neutral, trusted server injection
for at most eight preapproved recordings. It returns the existing `GuessCatalog`
and `GuessMediaSource` interfaces plus `dispose()` to release the prepared bytes.
It does not configure the application, activate a provider, download media, read
files, expose an upload endpoint or supply a real-song inventory. The default
application catalog stays unavailable.

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
- [Deezer's developer terms](https://developers.deezer.com/termsofuse) restrict
  standard use to noncommercial/private family contexts and require approval
  for other purposes. A reachable preview does not authorize public quiz use.

These source comparisons are implementation guidance, not verification of any
recording's rights. No public playable music inventory or provider permission
was established. Provider activation, real inventory ingestion and live release
remain separate approval boundaries under [AGENTS.md](../AGENTS.md) and
[the v3 readiness issue](https://github.com/lukasvri/Afterparty-MusicBot/issues/92).
