# Guess the song source foundation

The dedicated `/games` tab is independent of concert extras, Discord Activities,
shared queues and the concert clock. It reuses access to an existing private room
or a verified Discord server solely for authority and isolation. A room link can
open its game lobby through the Games navigation entry.

## Implemented contract

Participants choose bounded game nicknames. Signed anonymous grants recover the
same participant while valid; nicknames are not Discord identities or proof of
one human per player. Hosts configure a built-in category, 15 to 90 seconds per
round, 1 to 20 rounds, 100 to 2000 starting points, bounded minimum points and
optional late hints in the lobby. Defaults are 30 seconds, 5 rounds, 1000 to 100
points, hints enabled. Settings freeze for the game. Reset is an explicit new game,
not retroactive scoring.

The server chooses distinct eligible songs, owns answers and aliases, receives
and times guesses, awards each participant at most once per round, and releases
answers only on reveal/end. Points decrease linearly with elapsed server time;
a receipt at the deadline is rejected. Hints reveal an artist initial after two
thirds of the round and title word count after five sixths. Matching normalizes
case, accents, punctuation and spacing; it does not accept arbitrary substrings.
Sessions, participants, guesses and receipts are bounded and expire. Host
moderation has separate capacity from guesses. No public snapshot contains
private song IDs, media keys, aliases, raw guesses or real user identities.

## Catalog and audio are unresolved

`GuessCatalog` and `OperatorGuessCatalog` define an internal interface for a
separately reviewed, rights-cleared catalog. Automatic selection uses explicit
built-in category assignments. The default `UnavailableGuessCatalog` has no
recordings. The category examples 2010s and EDM classics are unavailable, not a
claim about a supplied music inventory. There is no public upload, custom list,
media endpoint, provider download or new operator configuration in this patch.

The test suite injects fictional songs and synthetic audio descriptors. Browser
audio objects are mocked to verify opt-in and cleanup, not decoding or audible sound. A clearly marked
short synthetic WAV descriptor exercises browser-local opt-in, errors and
cleanup; production returns no audio descriptor. Real catalog discovery,
licensing, answer-safe metadata and authenticated media delivery require a
separate scoped review before real music rounds can be enabled. This source
candidate must not be presented as a finished playable music catalog.

YouTube is not hidden, cropped or turned into audio-only playback for the quiz.
Spotify is not a game source. The normal concert player remains separate.

The Games link navigates to its own page, which unmounts the local concert
iframe. Game preview audio requires an explicit listener click and stops on
leave, round change/end, offline/hidden state, auth loss or errors. No audio
preference is persisted and no pause, mute, seek or queue command is sent to Core
music playback. Discord voice and audio in other tabs need local user muting.
Returning to music uses the latest saved listening preferences.

## Review gates

Require exact-tree source checks, synthetic model/HTTP/browser tests, room/guild
isolation, revoked role and canceled authentication coverage, server deadline and
hint boundaries, concurrency/replay and settings freeze checks. The current scoring timestamp is sampled when the model
accepts a valid authenticated request, after fresh guild membership validation;
transport and authorization latency can affect points. Live timing/fairness and
real audio decoding remain gates for the eventual catalog integration. Inspect desktop,
mobile, keyboard focus, overflow and reduced motion, plus ordinary player, queue,
TV, social extras and administration regressions. Automated fixtures establish
neither a real catalog nor what listeners hear in Discord. Merge, release and
host deployment remain separate owner decisions.
