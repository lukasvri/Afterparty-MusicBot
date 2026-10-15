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

The evening library is device-local, with validated JSON import/export. It is not an account-synchronized cloud library. Room playback history is shared and bounded. Local storage failures retain host credentials and preferences for the current page and offer a private recovery-link download. Reloading a page with blocked storage still requires that recovery link.

Mobile controls keep player, search, queue and saved evenings reachable. Search moves focus into the visible input. Navigation uses browser history, and TV mode is a shareable URL state. TV mode keeps guest QR sharing visible while hiding editing panels. YouTube consent and autoplay restrictions still apply; the app does not bypass them.

## Validation

Run `npm run check:all` with Node.js 24.17+, Python and FFmpeg. Tests include isolated SQLite room clocks, radio races, moderation, vote privacy, single-use and cross-room invitations, ownership transfer, revoked cohosts and blocked browser storage.

The browser workflow uses synthetic API responses and a local preview only:

```bash
PREVIEW_URL=http://127.0.0.1:8787 \
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROMIUM_PATH=/path/to/chromium \
node scripts/party.browser.mjs
```

It exercises private setup, first-song search, focus and scrolling, adding tracks, moderation, saved evenings, favorites, QR generation, TV mode, browser back navigation and mobile overflow. Automated audio and browser tests do not establish what people hear on a production Discord voice connection.
