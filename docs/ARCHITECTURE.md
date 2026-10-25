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
| Website auth and scoped Core proxy | `lib/` | `discord-auth.ts`, `admin-session.ts`, `core-server.ts` |
| Shared browser storage and playback rules | `lib/` | `browser-storage.ts`, `live-room.ts`, `playback-sync.ts` |
| Optional browser error privacy and initialization | `lib/error-reporting.ts` | Native root layout; [policy](OBSERVABILITY.md) |
| Shared bot settings, bounds and UI fields | `services/core/src/settings.ts` | Imported by Core and the native website |
| Concert links and legacy room resolution | `services/core/src/concert-links.ts`, `apps/web/src/lib/server/legacy-concert.ts` | Explicit guild URLs and bounded, exact-room compatibility redirects |
| Shared bridge checkpoint wire contract | `services/core/src/bridge-checkpoint.ts` | Core publisher and Worker presence negotiation, intent validation and bounded authority reads; no runtime services or credentials |
| Shared social messages and validation | `services/core/src/social-protocol.ts` | Browser-safe; no database, token signing or Node imports |
| Device-local reaction expiry | `lib/social-reactions.ts` | Used by the native social client |
| Discord/Core startup | `services/core/src/` | `main.ts`, `guilds.ts`, `server.ts` |
| Playback and source extraction | `services/core/src/` | `engine.ts`, `audio.ts`, `providers.ts`, `extractor.ts` |
| Core rooms, games and social authority | `services/core/src/` | `rooms.ts`, `guess-game.ts`, `social.ts` |
| Website schema and migrations | `db/`, `drizzle/` | Existing D1 migration sequence |
| Core schema and data | `services/core/src/` | `store.ts`, `migrate.ts`; private data stays outside Git |
| Local checks, builds and browser fixtures | `scripts/`, `apps/web/scripts/`, `apps/web/tests/`, `services/core/tests/` | `npm run check:all` plus browser suites |
| Host update and recovery | `operations/`, `services/core/` | [Operations](../services/core/PUBLIC_RELEASE.md) |

The v3 feature folders keep each component beside its client and behavior helpers:

| Folder in `apps/web/src/lib/` | Contents |
| --- | --- |
| `rooms/` | Room discovery, lifecycle, queue, public QR/TV sharing, synchronized player, local fullscreen and diagnostics |
| `concert/` | Public Discord concert client, scoped search/additions, protected seek, session history and shared-clock audio adapter |
| `games/` | Guess the Song client, presets, ranking and game audio |
| `library/` | Favorites/evenings, playlist import and festival catalog |
| `social/` | Reactions, moments and host bingo |
| `admin/` | Server-scoped administration client |
| `server/` | Native API dispatch and host-transition guard |
| `ui/` | Shared icons, public-page frame, saved motion preference and copyright form |

Shared fluid TV sizing lives in `apps/web/src/app.css`; room and concert routes own their layouts. Validate 4K, QHD and 1080p plus mobile, including readable invitations and retained player controls.

Routes compose these features and import individual modules. The optional library stays behind its dynamic import. Avoid an all-features barrel that would eagerly load unrelated code. Tests import the same canonical modules from the feature folders.

Shared contracts belong in browser-safe modules; authorization and persistence remain in their server implementations. Reuse the existing contracts and pure rules across Core and the website. The 26 API route adapters in `lib/api/` preserve URLs and authorization without a second frontend.

## Discord playback

`services/core/src/main.ts` connects the Discord bot, creates the guild registry, starts the HTTP services and runs the website bridge. Each guild has an engine, commands and store. The initial owner server uses `/data/core.sqlite`; additional servers use `/data/guilds/<server-id>/core.sqlite`.

Providers resolve playable sources and metadata. FFmpeg decodes, mixes and encodes audio for Discord. The engine owns the playback timeline, queue revisions, recovery and radio decisions. A shared extraction gate bounds concurrent media processes and prioritizes audio startup.

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
