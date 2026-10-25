# Afterparty experience architecture

This update keeps Discord audio in its existing per-guild engine and gives browser rooms an independent playback lifecycle. Production rollout still follows `AGENTS.md` and the local backup/update procedure.

## Room playback

`services/core/src/room-state.ts` contains the shared queue rules. Core and the Worker fallback use the same validation, moderation, voting, queue undo and history logic. `Rooms` owns persistence and compare-and-swap revisions. A Core timer advances finished videos even when the host or every browser disconnects. Live streams require an explicit skip. Radio lookups recheck revisions after awaiting results; a newer pause, queue edit or room closure wins. Failed automatic radio ends the completed track cleanly.

The Worker fallback advances expired tracks when a room is read. Unattended progression without any connected clients requires Core. Core and the website must be updated together for the new commands. Existing room records and database tables are reused; missing fields get backward-compatible defaults.

## Authority and privacy

The website verifies owner and cohost credentials before forwarding commands. Guests can request tracks, vote for queued tracks and vote to skip. Three distinct browser participant votes skip a track; this is casual browser participation, not verified-person voting. Votes do not automatically reorder the queue. Owners and cohosts retain manual ordering controls.

Invitations are single-use, room-specific capabilities. Only owners can issue or revoke invitations or transfer ownership. Transfer revokes old cohosts and outstanding invitations. Invitation hashes stay in D1; immutable Core authority remains separate from transferable website ownership. Public snapshots use an explicit field allowlist and never contain invitation hashes, vote identities or host credentials.

Invitation and recovery credentials use URL fragments, are consumed locally, and are removed from browser history before API calls. Recovery links must be treated as private credentials. Ordinary QR codes and copied room links contain only the room code. Rooms created from the website default to link-only access.

## Client responsibilities

The [source map](ARCHITECTURE.md#source-map) identifies the canonical native Svelte
owners. Classic is retired; there is no second frontend.

- `apps/web/src/routes/+page.svelte` composes browser rooms and their music workspace.
- `apps/web/src/lib/rooms/` owns room discovery, lifecycle, shared-clock audio, queue
  commands, QR invitations and native player intent.
- `apps/web/src/lib/concert/` owns the public Discord concert, scoped command
  confirmation and the fresh Core audio stream.
- `apps/web/src/lib/library/` owns saved evenings, favorites, playlist preview and
  festival browsing. This feature is loaded only after an explicit library action.
- `apps/web/src/lib/admin/` owns server administration and the DJ desk.
- `apps/web/src/lib/ui/` owns the shared theme, public-page frame, icons, decorative
  concert scenery and local motion preference.
- `lib/browser-api.ts`, `lib/playback-sync.ts` and `lib/youtube-player.ts` retain
  shared transport, clock rules and official player bootstrap.

The familiar horizontal navigation and one player card are composed in native
Svelte. `ui/MusicWorkspace.svelte` keeps Queue, Search and Library in one tabbed
side panel, stacked below the player on narrow screens. Hidden panels are inert,
while searches, unfinished library fields and metadata jobs retain their state.
The library mounts only after its first explicit visit. Room and device settings
share the player disclosure; optional social extras stay within the player card.
A mobile dock returns directly to player, search, queue and library. One room
invitation panel groups QR and public-link copying, with selection after clipboard
failure. The library groups collection, import and festival sections under local jump links.
`rooms/RoomQueue.svelte` owns compact native track disclosures and keyboard focus;
existing clients retain command authority and revision checks. Room discovery
filters the loaded list locally, preserves good cards after a failed refresh and
aborts pending reads when its view is retired.

The evening library is device-local, with validated JSON import/export. It is not
an account-synchronized cloud library. Room playback history is shared and bounded.
Local storage failures retain host credentials for the current page and offer a
private recovery-link download; reloading still requires that recovery link.

## Native player and the shared clock

The official YouTube iframe owns visible playback, volume, captions, quality and
fullscreen controls after explicit audio activation. The app retains one queue-next
action. The app does not add its own play/pause, seek, volume or fullscreen controls,
including before activation or after a source error. Reload and explicit audio
activation recover the official player; the server DJ desk remains the separate
advanced administration surface. Device calibration, resync, reload and diagnostics
live under Room settings (Playback settings for public concerts).

`rooms/player-intent.ts` observes state changes and bounded position discontinuities.
YouTube supplies no explicit user-intent flag or seek event. Shared commands require
a recent browser activation, focus in the current iframe, an identified current
video, current transport permission and the existing command revision/receipt checks.
State callbacks inspect native position changes immediately, including buffering
after a scrub. The 250 ms position sampler remains a fallback for seeks without a
state transition; pause and queue-next already dispatch from their events.
Programmatic load/play/pause/seek writes are tracked and consumed rather than echoed.
A native pause without provable activation can pause this device but cannot control
the room. An unproven play event cannot resume deliberately paused audio.

Hosts can use native play/pause/seek for browser rooms. Public concert play/pause
uses its existing permissions; concert seeking requires administrator access.
Guest pause remains local and survives incoming clock samples. Guest resume returns
to the shared timeline. Volume, mute and calibration remain device-local. A paused
room cannot be resumed globally by a guest.

Command receipts do not optimistically replace the shared clock. A pending native
seek stops local playback until confirmation and a fresh matching timeline; delayed
playing seeks allow elapsed progress. Pending state is bounded and belongs to one
room, source and playback instance. It cannot survive a source replacement or
player disposal. Browsers never advance the queue from an ENDED callback. Core or
the D1 fallback owns progression.

Core and the fallback share `roomPlaybackPosition` and start scheduling. Resume,
new-track and playing seek commands establish the agreed future start; duplicate
play commands preserve progress and the original deadline. Seek extraction keeps
its intended offset frozen until an audible segment exists. Core pause intent
survives radio discovery and source failure; crossfade recovery checkpoints the
recording actually consumed by the audio sink.

## Correction stability and Discord transitions

Automatic video corrections keep the existing precise/stable tolerances and
cooldowns. Moderate drift must stay outside tolerance in the same direction for
750 ms (precise) or 1500 ms (stable). One stale reading or alternating jitter no
longer triggers a hard seek that discards healthy video buffering. Large drift
retains its existing fast path after cooldown; explicit alignment and native
transport are immediate. Pause behavior is unchanged. Evidence is retired on
buffering, local pause, source replacement, reload, mode changes and sample gaps.
The current source does not inherit the previous source's correction cooldown.

Core's mixer uses one effective fade duration for readiness and mixing. A
transition can start once its overlap frames are ready; the original bounded
reservoir continues filling in the background. Promotion transfers its captured
queue and any single in-flight read. The main source waits only for that retiring
read when needed, never for an entire reservoir, and never reads the same decoder
concurrently. Queue invalidation cannot discard the promoted source's frames. Early outgoing
EOF during a fade retains incoming progress and its original clock segment.

The configured fade is honored whenever the remaining source tail can cover it,
including the canonical six-second default. Shorter tails retain the quarter-tail
fallback; incoming-source eligibility and per-server saved values remain intact.
Real FFmpeg regressions cover six seconds of overlap, seeked tails, paced reads,
reserve retention, late cancellation, failures and disposal. These improvements
remain separate from real Discord voice/provider listening acceptance.

## Radio and discovery

Music search requests a bounded candidate pool and ranks title, artist and recording
format without extra provider searches. Explicit remix, cover and live-set searches
remain available. Editing the input cancels and retires the previous request, so
old results or errors cannot replace a newer query. Cold searches have a 35-second
browser deadline. Concert results page locally; browser-room results use a bounded
scroll region.

Radio retains its stricter independent admission policy, original manual seed and
room history. Related candidates rotate through less recently exposed artists.
Declared AI production, vlogs, instructional uploads and song recreations are
filtered; matching music videos are preferred within the selected recording.
Metadata is not proof of human authorship or provider availability. See [radio
selection](RADIO.md) and [festival coverage](FESTIVAL_PLAYLISTS.md).

Prefetch and early skip share an in-flight lookup. Failed lookups preserve a song
that has not finished. Empty results use bounded cooldowns. Async results recheck
revisions, so newer user intent wins. No unrelated result is inserted merely to
fill a queue.

## Verification

Run `npm run check:all` with the supported Node toolchain, Python and FFmpeg.
Use the built local Worker preview for browser checks:

```bash
PREVIEW_URL=http://127.0.0.1:5438 \
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

`npm run test:stack` creates isolated Worker/D1/Core fixtures; give it a different
preview port if another preview is running. Playback/browser fixtures use synthetic
credentials, APIs and media. Native control tests use a local sandboxed iframe,
real clicks and message delivery to exercise cross-origin focus and activation.

Review screenshots at 3840×2160, 2560×1440 and 1920×1080 plus mobile. Confirm
readability, overflow, invitations, fullscreen and retained player identity.
Automated fixtures do not establish regional provider availability, browser-specific
YouTube behavior or what people hear on a real Discord voice connection. These
remain live acceptance checks before stable release.
