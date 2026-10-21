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

- `components/party/room-dialog.tsx`: accessible room setup and joining.
- `components/party/start-evening.tsx`: explicit Discord versus browser playback choice.
- `components/party/social-queue.tsx`: requests, moderation, votes, ordering and approximate wait times.
- `components/party/room-sharing.tsx`: local QR generation, TV controls and authority management.
- `components/party/evening-library.tsx`: editable saved sets, favorites and import/export.
- `components/party/admin-seek.tsx`: live position with protected pointer/keyboard editing.
- `lib/browser-api.ts` and `lib/youtube-player.ts`: browser transport and player bootstrap.

The welcome page gives `components/concert-scenery.tsx` its own centred composition, with a larger DJ and console and responsive framing. Room scenery retains space for empty-state controls. Decorative SVG layers remain noninteractive, with lights behind the performer and hands above the decks. Both system reduced-motion preferences and the manual animation switch stop the scene's movement.

The evening library is device-local, with validated JSON import/export. It is not an account-synchronized cloud library. Room playback history is shared and bounded. Local storage failures retain host credentials and preferences for the current page and offer a private recovery-link download. Reloading a page with blocked storage still requires that recovery link.

Mobile controls keep player, search, queue and saved evenings reachable. Search moves focus into the visible input. Navigation uses browser history, and TV mode is a shareable URL state. TV mode keeps guest QR sharing visible while hiding editing panels. YouTube consent and autoplay restrictions still apply; the app does not bypass them.

Music search requests up to 30 results in one bounded lookup. The panel reveals ten at a time locally and preserves keyboard focus when more appear. Up to four suggestions use the already loaded current artist and listening history; they start a search only when selected. Known AI declarations are excluded from automatic suggestions. Cold searches have a 35-second browser deadline so responses within the Core bridge's 25-second window can arrive. Editing the input cancels and retires the previous request immediately, so old results or errors cannot replace the new query.

The website fallback separates radio music searches (20 candidates) from user searches (30), and radio does not spend the user's search allowance. Empty search results expire after one minute; global provider quota limits still apply.

## Validation

Run `npm run check:all` with Node.js 24.17+, Python and FFmpeg. Tests include isolated SQLite room clocks, radio races, moderation, vote privacy, single-use and cross-room invitations, ownership transfer, revoked cohosts and blocked browser storage.

The browser workflow uses synthetic API responses and a local preview only:

```bash
PREVIEW_URL=http://127.0.0.1:8787 \
CHROMIUM_PATH=/path/to/chromium \
node scripts/party.browser.ts
```

Run `PREVIEW_URL=http://127.0.0.1:8787 CHROMIUM_PATH=/usr/bin/chromium npm run test:search` against a local preview for the focused search, keyboard, pagination, cancellation and mobile scenarios. It uses synthetic APIs without provider requests.

The party workflow uses the locked Playwright dependency and exercises private setup, first-song search, focus and scrolling, adding tracks, moderation, saved evenings, favorites, QR generation, TV mode and browser back navigation. Welcome checks span 360, 390, 768, 1440 and 2560 pixel widths, including centring, performer visibility, overflow, motion preferences and dialog hit-testing above scenery. Automated audio and browser tests do not establish what people hear on a production Discord voice connection.

## Playback recovery and radio (2.0.1)

Tight synchronization remains the default. The player tolerates up to 0.5 seconds
of iframe reporting jitter and requires sustained drift before an automatic seek.
Room transport changes apply promptly; buffering never publishes a host seek.
YouTube is the only seek bar in browser rooms. A confirmed discontinuity updates
the shared room for hosts. Buffering and pending programmatic seeks are excluded.

Native seeks from room hosts and authorized Discord managers retain the latest
confirmed scrub while an earlier shared seek is awaiting acknowledgment. Commands
remain serialized and use the current permissions and revision when submitted,
without reloading the iframe. Deferred intent belongs to one navigation, guild
and playback instance. Leaving that scope, requesting an explicit resync or
receiving a failed command drops the deferred target; an older completion cannot
clear a newer operation.

Radio searches explicit genre labels across artists, favouring artists not heard
recently. It retries empty or failed searches. If the title has no reliable genre
label, artist matching remains a conservative fallback. Publisher channels alone
do not establish similarity.
If no eligible track is available, the room retains its listening history and
shows Retry radio. It does not fill the queue with unrelated search results.

Radio prepares one visible suggestion as soon as a track begins playing.
Manual queue additions replace that suggestion, and turning radio off removes it.
Live performances, remakes, recreations and covers are excluded by title as well
as provider flags. Search latency can still delay a suggestion when providers
are unavailable.

## Early skip handling (2.0.2)

Prefetch and skip share a provider lookup. Skip takes priority over inserting a
suggestion. Failed lookups preserve a song that has not finished yet. The browser
retries a stale skip once only if the track, playback instance and play state are
unchanged. Genre labels can come from explicit provider tags or genre fields in
descriptions; no audio classifier is implied.
