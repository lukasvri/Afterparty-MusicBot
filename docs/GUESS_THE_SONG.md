# Guess the song and private preview development

The dedicated `/games` tab is independent of concert extras, Discord Activities,
shared queues and the concert clock. Existing private-room or ordinary Discord
membership supplies authority only. The default catalog remains empty, so real
music rounds are unavailable in the standard application.

## Game contract

Participants use bounded anonymous game nicknames, with signed grants preserving
identity while valid. Hosts configure category, 15 to 90 seconds, 1 to 20 rounds,
100 to 2000 starting points, minimum points and late hints. Defaults are 30 seconds,
5 rounds, 1000 to 100 points, hints enabled. Settings freeze for the game. The
server chooses distinct eligible songs and owns the clock, matching and scores.
Each participant can score once per round. Points decrease with authenticated
server receipt time; receipt at the deadline is rejected. Artist-initial and
word-count hints arrive after two thirds and five sixths of the round. Answers
appear only on reveal/results. Transport and fresh membership latency can affect
scores; live timing fairness is not established.

Sessions, scopes, participants, receipts and action budgets are bounded. Host
moderation has reserved capacity. Game responses omit private song/media keys,
provider URLs, aliases, raw guesses and real Discord identities. This reduces
accidental answer exposure; it is not an absolute anti-cheat guarantee.

## Catalog and media extension points

`GuessCatalog` remains synchronous and private: `categories()`,
`select(categoryId, {exclude, durationSeconds})`, and `media(mediaKey)`.
`GuessMediaDescriptor.durationSeconds` is the **measured available clip length**,
not the full recording duration. A 30-second preview cannot start a 31 to 90 second
round. Metadata-only duration fields must never populate that descriptor.

`GuessMediaSource.read(privateKey, signal)` returns an answer-safe canonical PCM
WAV. Sources are trusted server injections, never URLs or lists supplied by a
browser. Core validates the fixed envelope again before returning it. No source
is selected by default in `createServers` or production bootstrap.

`prepareDeezerGuess` is an experimental programmatic factory for isolated private
development. It is **disabled by default**, with no environment switch or public
configuration endpoint. The operator must supply all of these independently of
metadata availability:

- Explicit enablement and private-development scope.
- A reference recording the applicable provider permission for this quiz,
  preview delivery and metadata-removing processing.
- Per-recording permission identities and server-curated artist/title/year seeds.
  Curatorial original-release evidence must be reviewed by the operator; an API
  date merely cross-checks it and does not prove the original release.

The factory does not infer permission from an HTTP 200, a preview URL, another
quiz website, a title match or a full-song duration. These inputs are operator
attestations, not automatic legal verification. No approved live inventory is
bundled. There is no client search, personal playlist/upload or unknown-music
fallback. Category assignments are explicit, including the 2010 to 2019 constraint.

The [Deezer developer terms](https://developers.deezer.com/termsofuse) limit use to
non-commercial/private family contexts and require prior review for other purposes.
This code and its gates do not approve an Afterparty public music quiz. Do not
activate provider use without the necessary permission. No credentials, account,
subscription, production setting or paid service is created by this change.

## Bounded delivery and privacy

Metadata resolution is serial, capped at 8 curated recordings and 5 search results,
with bounded JSON and request/batch deadlines. Artist/title matching is exact after
normalization; ambiguous, mismatched, missing, reissued-year or unreadable results
fail the batch. Only the reviewed HTTPS API and exact preview CDN host are accepted.
Redirects, userinfo, non-default ports, encoded/path ambiguity and arbitrary hosts
are rejected. Region/authentication/provider errors are not bypassed.

After the explicit gates, preparation reads only bounded standard preview bytes,
not full songs. FFmpeg is locked to an explicit input format and pipe protocol,
with input/output/time limits. It decodes at most 30 seconds and strips container
metadata into mono 16 kHz PCM WAV. Overlong clips are rejected rather than relabeled.
Actual measured duration controls eligibility. The ceiling is strict: encoder padding
can make a nominal 30-second MP3 exceed it and be rejected. This conservative
provider-compatibility limitation remains open; no automatic trimming or duration
relabeling hides it. Prepared previews remain in bounded
memory for at most five minutes, are not committed or persisted, and expire closed.

The browser POSTs to `/api/guess/media` with fresh room/session authority and its
anonymous participant grant, session, round and one-use event ID. The Core bridge
rechecks authority, participant and active round before and after asynchronous work.
Countdown, reveal, end, stale rounds, expired grants and replay are rejected. Two
concurrent reads and separate media quotas bound work; cancellation releases
capacity even if an injected dependency ignores its signal. Responses are fixed
`audio/wav`, private/no-store and nosniff, without provider headers or filenames.

Browser audio requires an explicit click, uses an object URL and normal decoding,
and supports an extra gesture after mobile autoplay rejection without downloading
again. Stop/cancel, reveal, round changes, reconnect/auth loss, hidden/offline state
and leaving abort requests, stop the element and revoke URLs. Late responses cannot
resume an old round. The game issues no shared playback or audio-preference writes;
Discord/other-tab sound requires local user muting.

## Validation and remaining gates

Tests use fictional metadata and owned generated tones, including encoded MP3,
real FFmpeg decoding and a real browser Audio element. No music clip is committed.
Security checks cover bad URLs/formats, oversize/stalled responses, permissions,
replay, cross-scope/stale state, membership and authorization races, cancellation,
mobile gesture retry, clock/score authority and existing playback preservation.

Synthetic decoding establishes implementation behavior, not permission, regional
provider availability, a playable default catalog, live listening quality or real
Discord audio. Provider/network/browser acceptance and actual listening remain
unverified. No merge, restart or deployment is implied.
