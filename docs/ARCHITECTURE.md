# How Afterparty fits together

[Documentation](README.md) · [Installation](INSTALLATION.md) · [Configuration](CONFIGURATION.md)

Afterparty has a self-hosted Core service and a website. The services share state through an authenticated HTTPS connection; they do not share a database file.

```mermaid
flowchart TB
    subgraph Browser[Browser]
        UI[Afterparty interface]
        Video[Official YouTube embed]
        Local[Device-local evenings and preferences]
        UI --> Video
        UI --> Local
    end
    subgraph Website[Native Worker / D1]
        Routes[Pages and API routes]
        D1[(Room data and bridge jobs)]
        Routes --> D1
    end
    subgraph Host[Your Core host]
        Core[Discord and room services]
        Audio[FFmpeg decode / mix / Opus]
        Guilds[(SQLite per Discord server)]
        Core --> Audio
        Core --> Guilds
    end
    UI <-->|HTTPS| Routes
    Routes <-->|Authenticated HTTPS| Core
    UI <-->|Ticketed live transport| Core
    Audio --> Voice[Discord voice channels]
```

## Source map

The native SvelteKit website in `apps/web` is the only interface. Shared API handlers live in `lib/api/` and retain their existing public URLs, data and authorization contracts. Classic, its service-binding fallback and its React build have been removed at the owner’s request.

| Responsibility | Canonical location | Entry point |
| --- | --- | --- |
| Website routes and page composition | `apps/web/src/routes/` | `+page.svelte`, `discord/+page.svelte`, `games/+page.svelte` |
| v3 feature implementations | `apps/web/src/lib/` | Feature folders below |
| Shared website API handlers | `lib/api/` | `route.ts` adapters into `lib/` |
| Website room persistence and catalog | `lib/` | `server.ts`, `concert-catalog.ts` |
| Website visitor counts, heartbeat and directory SQL | `lib/room-visitors.ts` | `server.ts` owns access; `db/schema.ts` and `drizzle/` own the index; `scripts/measure-room-visitors.ts` measures isolated read/write/space cost |
| Public room discovery UI | `apps/web/src/lib/rooms/RoomDirectory.svelte` | Local name/code filtering and counts, single-flight visible-page refresh, retained last-good results on failure and abort on unmount; `apps/web/tests/directory.browser.ts` covers recovery and navigation |
| Shared persistent music workspace | `apps/web/src/lib/ui/MusicWorkspace.svelte` | Room and public concert routes supply queue, search and library snippets; owns tab visibility, inactive-panel isolation, focus and first-open library mounting |
| Browser-room queue UI | `apps/web/src/lib/rooms/RoomQueue.svelte` | Host action disclosures, guest votes and Escape/action focus recovery; scoped commands and queue revisions remain in `room-client.ts` |
| Website auth and scoped Core proxy | `lib/` | `discord-auth.ts`, `admin-session.ts`, `core-server.ts` |
| Native YouTube user intent | `apps/web/src/lib/rooms/player-intent.ts` | Current iframe focus/activation, programmatic echo suppression and fresh-timeline confirmation; `RoomAudio.svelte` owns player lifecycle and permission callbacks |
| Shared room position and future start | `services/core/src/room-state.ts` | `roomPlaybackPosition` and `changeRoom`, reused by Core and Worker |
| Shared browser storage and playback rules | `lib/` | `browser-storage.ts`, `live-room.ts`, `playback-sync.ts` (canonical drift thresholds and sustained-correction evidence; `RoomAudio.svelte` resets evidence with its player lifecycle) |
| Optional browser error privacy and initialization | `lib/error-reporting.ts` | Native root layout; [policy](OBSERVABILITY.md) |
| Shared bot settings, bounds and UI fields | `services/core/src/settings.ts` | Imported by Core and the native website |
| Concert links and legacy room resolution | `services/core/src/concert-links.ts`, `apps/web/src/lib/server/legacy-concert.ts` | Explicit guild URLs and bounded, exact-room compatibility redirects |
| Shared bridge checkpoint wire contract | `services/core/src/bridge-checkpoint.ts` | Core publisher and Worker presence negotiation, intent validation and bounded authority reads; no runtime services or credentials |
| Shared social messages and validation | `services/core/src/social-protocol.ts` | Browser-safe; no database, token signing or Node imports |
| Device-local reaction expiry | `lib/social-reactions.ts` | Used by the native social client |
| Discord/Core startup | `services/core/src/` | `main.ts`, `guilds.ts`, `server.ts` |
| Playback and source extraction | `services/core/src/` | `engine.ts`, `audio.ts`, `providers.ts`, `extractor.ts` |
| User search relevance | `services/core/src/music-search.ts` | One bounded title/artist and recording-format ranking policy for Core search and Worker fallback; radio retains its separate admission and ranking pipeline |
| Shared room-radio queue selection and existence checks | `services/core/src/room-radio.ts` | One lazy selection policy for Core and website fallback; `room-state.ts` owns command/prefetch eligibility |
| Shared browser-room seek bounds | `services/core/src/protocol.ts` | `roomSeekPosition` clamps Core/Worker seeks and native browser command targets; `lib/playback-sync.ts` converts device calibration before submission and confirmation |
| Shared browser-room queue capacity | `services/core/src/protocol.ts` | `ROOM_QUEUE_LIMIT` and `roomQueueCapacity` reserve pending requests; Core and native room/library controls use the same bounds |
| Core rooms, games and social authority | `services/core/src/` | `rooms.ts`, `guess-game.ts`, `social.ts` |
| Website schema and migrations | `db/`, `drizzle/` | Existing D1 migration sequence |
| Core schema and data | `services/core/src/` | `store.ts`, `migrate.ts`; private data stays outside Git |
| Local checks, builds and browser fixtures | `scripts/`, `apps/web/scripts/`, `apps/web/tests/`, `services/core/tests/` | `npm run check:all` plus browser suites |
| Host update and recovery | `operations/`, `services/core/` | [Operations](../services/core/PUBLIC_RELEASE.md) |

The v3 feature folders keep each component beside its client and behavior helpers:

| Folder in `apps/web/src/lib/` | Contents |
| --- | --- |
| `rooms/` | Filtered room discovery and refresh recovery, lifecycle, queue disclosures, public QR/TV sharing, synchronized player, local fullscreen and diagnostics |
| `concert/` | Public Discord concert client, scoped search/additions, protected seek, session history and shared-clock audio adapter |
| `games/` | Guess the Song client, presets, ranking and game audio |
| `library/` | Favorites/evenings, playlist import and festival catalog |
| `social/` | Reactions, moments and host bingo |
| `admin/` | Server-scoped administration client, DJ desk and pure cue/transition rules |
| `server/` | Native API dispatch and host-transition guard |
| `ui/` | Root-rendered global theme, shared `AppNavigation.svelte`, device-local `TheaterToggle.svelte`, persistent music workspace, shared icons, public-page frame, saved motion preference, decorative concert scenery, shared search thumbnails and copyright form |

Shared surfaces, focus styles and fluid TV sizing live in `apps/web/src/lib/ui/AppTheme.svelte`; room and concert routes own their layouts. Validate 4K, QHD and 1080p plus mobile, including readable invitations and retained player controls.

Routes compose these features and import individual modules. `MusicWorkspace.svelte` keeps queue and search mounted when switching tabs, mounts the library on its first visit and retains it afterward. Inactive panels are hidden and inert; selection restores focus without recreating the player or issuing playback commands. Routes retain room/session and command authority. The optional library stays behind its dynamic import. Decorative concert scenery loads only for the welcome and empty-room views; active rooms do not download its SVG component. `ConcertScenery.svelte` owns SVG equipment geometry, lighting and visibility-based animation pausing; `TrackThumbnail.svelte` owns shared search-image loading and failure presentation. Avoid an all-features barrel that would eagerly load unrelated code. Tests import the same canonical modules from the feature folders.

The room client owns sequential library additions, capacity preflight and session
retirement. Library tools exclude current, queued and pending tracks before an
explicit addition. Playlist metadata polling alone may retry transient failures;
starts and queue mutations are never automatically replayed. Concert additions
retain their separate fresh-revision and private-receipt lifecycle. The website's
50-track selection budget does not change the bot's configured playlist limit.

Shared contracts belong in browser-safe modules; authorization and persistence remain in their server implementations. Reuse the existing contracts and pure rules across Core and the website. The 26 API route adapters in `lib/api/` preserve URLs and authorization without a second frontend.

## Discord playback

`services/core/src/main.ts` connects the Discord bot, creates the guild registry, starts the HTTP services and runs the website bridge. Each guild has an engine, commands and store. The initial owner server uses `/data/core.sqlite`; additional servers use `/data/guilds/<server-id>/core.sqlite`.

Providers resolve playable sources and metadata. FFmpeg decodes, mixes and encodes audio for Discord. The engine owns the playback timeline, queue revisions, recovery and radio decisions. A shared extraction gate bounds concurrent media processes and prioritizes audio startup. The mixer owns one effective fade calculation for readiness and the actual transition, with a bounded background reservoir and explicit read ownership across source promotion. Configured overlap is honored when the remaining tail can cover it.

[Radio 2.0](RADIO.md) uses one platform-neutral selection pipeline for Discord providers, browser rooms and the website fallback. Optional catalog and bounded search adapters supply candidates; shared policy checks content, recording identity, style, exclusions and playback capabilities before ranking them. The engine and room handlers retain final generation/revision checks and own all playback and persistence changes.

Ordinary `/play` tracks are private Discord music. `/concert` exposes concert state to the website; the compatibility handler also accepts cached `/konsert` invocations. Public concert operations do not gain access to a guild's private tracks, requester information or administration.

## Browser rooms

The website stores browser room data in D1. Core's room service supplies live room updates and progression; the website includes fallback room handling when that transport is unavailable. Browser rooms have their own queues, revisions, host tokens and permissions. They do not share Discord guild history.

Each browser plays video through the official YouTube embed and applies the shared timeline. Buffering, autoplay and network delay still differ between devices. Local volume, synchronization preferences, diagnostics and saved evenings stay on the device. See [own rooms](OWN_ROOMS.md) for the exact behavior and recovery boundaries.

## Commands and live state

Browser APIs and clients live in `lib/api/`, `lib/` and `apps/web/src/lib/`. The website authorizes commands before forwarding them to Core. Direct live transport uses short-lived tickets. WebSocket and continuous HTTP updates carry live state; polling and queued bridge jobs provide fallback paths.

Queue revisions reject stale edits. Clock sampling accounts for transport delay, while each client compensates for its own buffering. The website displays playback state; it does not independently advance Discord audio.

## Access and secrets

Core and the website use a shared bridge secret. Discord OAuth supplies administrative identity and server permissions. Ownership, Administrator or Manage Server permission is checked for the selected guild; legacy owner access does not grant another guild's administration.

Bot tokens, OAuth client secrets, environment files and deployment-specific hosting settings stay private on the host or hosting platform. The repository contains templates only. See [configuration](CONFIGURATION.md) and [security](../SECURITY.md).

## Build and operations

The website uses SvelteKit, Svelte 5, Vite and a standalone Cloudflare Worker/D1 backend. Core uses Node.js, Discord libraries, SQLite, FFmpeg and yt-dlp. Compose runs Core separately from the website. A website deployment does not keep an offline Core host available.

`npm run check:all` validates isolated application and recovery behavior and builds the website. Production listening, source availability, reconnect behavior and simultaneous real voice capacity require host validation. [Host readiness](HOST_READINESS.md) and [operations](../services/core/PUBLIC_RELEASE.md) cover backups and reviewed updates.
