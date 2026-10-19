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

## Validation

### Concert activities preview (3.0.0-alpha.1)

The optional **Concert together** panel offers reactions, a shared nine-square
bingo card and timestamp highlights. Hosts create and manually mark bingo prompts;
there is no automatic song-boundary detection. Highlights contain short text and
external YouTube timestamp links, never recordings. Opening a highlight in a new
tab does not seek the shared player. The panel is collapsed initially, stays out
of TV/fullscreen layouts, and respects reduced motion.

This first v3 slice requires matching Core and website builds. Browser guests
join with the existing room link and receive a signed, room-scoped activity
session, valid for 30 minutes. It is casual link-based participation, not verified
personhood. Website room-owner and cohost credentials are checked on every request.
Discord participation requires OAuth sign-in and verified membership of the exact
selected guild. Only its owner, administrators or managers can moderate. A website
owner recovery login does not grant Discord social membership or cross-guild access.

`services/core/src/social.ts` owns a separate SQLite table and revision. It reads
the canonical playback key and position without calling playback commands,
advancing the queue, resetting clocks or invalidating playback revisions. Stale
keys and repeated event IDs are rejected. Highlights and bingo reset when the
playback instance changes; host enable/disable remains scoped to the room or guild.
Hosts can remove highlights even while activities are disabled.

Authenticated POST streams carry snapshots separately from playback events. A
stream starts with the current snapshot and closes after 60 seconds so reconnection
rechecks access. Hiding or closing the panel stops the stream. Failed social writes
are never queued or replayed after reconnect. Reactions expire after six seconds
and are memory-only; slow consumers lose reaction updates before durable updates.
The fallback uses bounded reads and backoff. Core unavailability disables activities
without introducing a second persistence authority.

Limits deliberately favor playback: 64 social streams within the existing 128
HTTP-stream ceiling; 120 social HTTP requests per minute globally before the
existing 600-per-peer request protection; 30 reaction events per scope and six per
activity session per minute; three highlights per session per minute. Storage holds
at most 128 active scopes, 30 highlights per scope, nine bingo prompts and 20 recent
reactions. Durable social records expire after 24 hours without a durable write;
rate-limit and deduplication maps are bounded. Durable event receipts survive
Core restart for 24 hours, with 128 guest actions and a separate reserve of 128
host-control actions per scope. Guest activity cannot consume that moderation
reserve. Reaction receipts are intentionally ephemeral across a process restart. These are preview ceilings, not a
claim of production capacity. A shared proxy peer can still couple playback clients
under the existing global protection. No arbitrary forwarded headers are trusted
by Core and that protection has not been removed.

The current source tests are synthetic. Live Discord continuity, multi-server
capacity, licensing and the remaining cases in issue #37 are separate launch gates.

#### Preview installation and rollback boundary

Activities require the Core room service even for private, link-only browser rooms.
A private room using only the website/D1 playback fallback has no social fallback.
Device-local saved evenings remain local and do not acquire shared activity state.
Rooms imported without a playback key cannot send activity events until a new
playback instance starts. The shared bingo card is called by the host; it is not
an individual randomized card or an automatic concert recognizer.

Core creates two additive tables in its initial store: `concert_social` and
`concert_social_receipts`, plus an expiry index. An existing preview receipt table
without `kind` receives that column with a guest default. No D1 migration, existing
playback-table rewrite, credential rotation or production migration is performed by
this PR. Durable social writes and their receipts commit in one SQLite transaction.
The 24-hour retention window is enforced on subsequent social requests. It is
logical expiry, not an unattended physical purge; dormant rows can remain on disk
until another activity request performs cleanup.

Before any separately authorized installation, back up Core SQLite and the normal
room/website data using the host's established procedure. Rolling website and Core
back together to the preceding reviewed build leaves the additive tables unused;
older code does not expose activities. An already-open preview panel will report
unavailability and must not replay pending actions. Do not delete tables during
rollback. Restoring an older full backup also discards newer social records and
playback data, so that recovery requires the normal host backup/restore review.
These are source compatibility implications, not a tested production rollback.

Run `npm run check:all` with Node.js 24.17+, Python and FFmpeg. Tests include isolated SQLite room clocks, radio races, moderation, vote privacy, single-use and cross-room invitations, ownership transfer, revoked cohosts and blocked browser storage.

The browser workflow uses synthetic API responses and a local preview only:

```bash
PREVIEW_URL=http://127.0.0.1:8787 \
CHROMIUM_PATH=/path/to/chromium \
node scripts/party.browser.ts
```

It uses the locked Playwright dependency and exercises private setup, first-song search, focus and scrolling, adding tracks, moderation, saved evenings, favorites, QR generation, TV mode and browser back navigation. Welcome checks span 360, 390, 768, 1440 and 2560 pixel widths, including centring, performer visibility, overflow, motion preferences and dialog hit-testing above scenery. Automated audio and browser tests do not establish what people hear on a production Discord voice connection.

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
