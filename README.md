<div align="center">

<img src="docs/assets/afterparty-banner.png" alt="Afterparty: white ap lettering, a red dot and a black DJ platter with a red illuminated rim" width="100%" />

# Music brings people together.

**A self-hosted Discord music bot. A shared video room. One place for the evening.**

[![Validation](https://github.com/lukasvri/Afterparty-MusicBot/actions/workflows/core.yml/badge.svg)](https://github.com/lukasvri/Afterparty-MusicBot/actions/workflows/core.yml)
[![MIT](https://img.shields.io/badge/license-MIT-ff263e?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-24.17%2B-171717?style=flat-square)](https://nodejs.org/)

[**Open Afterparty**](https://afterparty.lukasvri.chatgpt.site) · [**Install your own**](docs/INSTALLATION.md) · [**Documentation**](docs/README.md) · [**Changelog**](CHANGELOG.md)

</div>

## The evening, your way

Play music in a Discord voice channel, share a concert with video, or open a private browser room without an account. Afterparty keeps the queue, controls and shared timeline together.

| Discord music | Shared concerts | Your own rooms |
| --- | --- | --- |
| Search or paste a link with `/play` | Use `/concert` for Discord audio and website video | Start a private room and invite friends with a link or QR code |
| Radio, favorites and saved queues | Requests, votes and moderated queues | Host controls, cohosts and ownership transfer |
| Pause, seek, skip and crossfade | Playback follows Core's audio clock | Save evenings locally, import/export and use TV mode |
| Separate settings and storage for each server | Ordinary Discord music stays private | Browser rooms work without a Discord connection |

Ordinary queue additions append after existing entries, including eligible radio suggestions. Explicit play-next and play-now controls retain their distinct behavior. A full queue rejects additions without silently dropping earlier entries.

YouTube video uses the official embedded player. SoundCloud provides audio; Spotify links are matched to a playable source. Provider availability and browser autoplay rules still apply.

## Built for the big screen. Ready for your pocket.

<a href="docs/assets/afterparty-desktop.png"><img src="docs/assets/afterparty-desktop.png" alt="Afterparty desktop welcome screen with ap branding, room controls and an illustrated concert stage" width="100%" /></a>

<details>
<summary><strong>See the mobile view</strong></summary>
<br />
<img src="docs/assets/afterparty-mobile.png" alt="Afterparty mobile welcome screen with the same room controls and concert stage" width="320" />

</details>

Screenshots show a local preview with synthetic API responses, in English. They illustrate the interface, not a connected production bot.

## Synthetic game preview

The `2.3.0-alpha.1` source adds **Games / Guess the Song** for existing private
rooms and authorized Discord servers. It is a focused preview, independent of
concert extras and Discord Activities. Deployment remains a separate operator
action. The default catalog is unavailable.

An operator may explicitly enable `GUESS_SYNTHETIC_TEST=1` on Core to test the
shared game using five locally generated tones with fictional **Test Tone One**
through **Test Tone Five** titles. These are synthetic test sounds, not real songs
or a licensed catalog. See [synthetic game testing](docs/GUESS_SYNTHETIC_TEST.md).

Reviewed server integrations can prepare explicitly approved WAV inventory using
the [bounded operator catalog adapter](docs/GUESS_CATALOG_SOURCES.md). This does
not activate a provider or supply approved real music in the default application.

## Stable and experimental channels

Use `main` for ordinary bot/web updates. The separate `beta` branch retains v3 and Discord Activity experiments. Stable queue and player fixes can be reviewed independently without the Activity SDK, routes or test configuration. See [release channels](docs/RELEASE_CHANNELS.md) for extraction and review boundaries.

## Concert extras preview

The closed-by-default Games & extras submenu offers separate optional views for reactions, shared timestamp bookmarks and a host-called bingo card. It needs matching website and Core source; the website-only room fallback disables extras. These concert extras do not run a Discord Activity. The combined `2.4.0-alpha.3` preparation candidate remains review source with open live acceptance gates; see [the checklist](docs/V3_BETA_ACCEPTANCE.md).

## Run your own Afterparty

The full stack has two services. **Core** runs on your computer or server and sends audio to Discord. The **website** runs on Cloudflare Workers/D1 or Sites and provides rooms, video and administration. Core's host must stay online for Discord playback.

| Service | What it needs | Start here |
| --- | --- | --- |
| Core | Docker with Compose v2, your Discord application and an HTTPS endpoint | [Installation](docs/INSTALLATION.md) · [Core guide](services/core/README.md) |
| Website | Node.js 24.17+, Workers/D1 or Sites hosting, your database and HTTPS origin | [Website setup](docs/INSTALLATION.md#5-build-and-preview-the-website) |
| Connection | A shared bridge secret and Discord OAuth configuration | [Configuration reference](docs/CONFIGURATION.md) |

Administration uses the website at `/admin`. Core no longer includes the obsolete optional local dashboard or its separate port 3847 listener. Custom callers of `createServers` must remove the old dashboard options; supported Core APIs remain on the configured Core port.

There is no one-command production installer for both services. The installation guide covers configuration, database migrations, hosting and your first track.

### Fresh installation

```bash
git clone https://github.com/lukasvri/Afterparty-MusicBot.git
cd Afterparty-MusicBot
cp services/core/.env.example services/core/.env
cp .dev.vars.example .dev.vars
```

Fill in your own credentials and URLs using the [installation guide](docs/INSTALLATION.md). These copy commands are for a fresh clone; keep existing private configuration when updating.

After configuring and installing your Discord application:

```bash
cd services/core
docker compose up -d --build
curl --fail http://127.0.0.1:3990/health
```

`ready: true` confirms Discord readiness. Continue with [website setup](docs/INSTALLATION.md#5-build-and-preview-the-website) and the [first-track checklist](docs/INSTALLATION.md#8-play-your-first-track) to verify the complete system.

## One engine, separate spaces

```mermaid
flowchart LR
    Listener[Listener] --> Website[Afterparty website]
    Listener --> Voice[Discord voice channel]
    Website <-->|HTTPS: state and authorized commands| Core[Core audio engine]
    Core -->|Opus audio| Voice
    Core --> Guilds[(SQLite per Discord server)]
    Website --> Rooms[(D1 room storage)]
```

Core owns Discord audio playback and its clock. The website displays that state and sends authorized commands. Each Discord server keeps its own queue, settings, favorites and database. Browser rooms have their own queues and permissions. See [architecture](docs/ARCHITECTURE.md) for the boundaries and transport.

## Keep the music running

Run these from `services/core/`:

| Task | Command |
| --- | --- |
| Start the existing image | `docker compose up -d --no-build` |
| Check containers | `docker compose ps` |
| Read recent logs | `docker compose logs --tail=100 core` |
| Stop Core | `docker compose stop core` |

Back up the complete `/data` volume, including `guilds/`, before an update. `docker compose down -v` deletes the data volume. [Operations and recovery](services/core/PUBLIC_RELEASE.md) covers safe updates; [host readiness](docs/HOST_READINESS.md) covers live backups, restore checks and health reports. [Remote deployment](docs/REMOTE_DEPLOY.md) keeps credentials and production data on the bot host.

## Work on the project

With Node.js 24.17+, Python 3.11+ and FFmpeg installed:

```bash
npm run setup:cloud
npm run check:all
```

`setup:cloud` installs both locked dependency trees. `check:all` runs lint, deployment recovery tests, website unit tests, both TypeScript checks, Core tests and a website production build. Audio tests use real FFmpeg with synthetic tones. Separate Playwright browser suites, such as `npm run test:party` and `npm run test:sync`, use simulated playback and isolated fixtures; `check:all` does not launch them. See [contributing](CONTRIBUTING.md) and the [cloud workflow](docs/CLOUD_DEVELOPMENT.md).

The validation command requires repository-wide lint with zero warnings. Automated checks do not establish live Discord audio quality or multi-server production capacity; the [release review](docs/RELEASE_REVIEW.md) records the remaining live checks.

## TypeScript and project status

The website (`app/`, `components/`, `hooks/`, `lib/`), Core
(`services/core/src/`), tests and maintained Node scripts are written in
TypeScript. Node.js 24.17+ runs the Node scripts directly using native type
stripping. ESLint and PostCSS load typechecked TypeScript configuration through
small `.mjs` adapters. Existing installer adapters remain compatible with older
configured entry points. See [TypeScript boundaries](docs/TYPESCRIPT.md) for the
retired legacy dashboard and retained Python, shell and container tooling.

The README describes implemented source, not the currently deployed revision.
Check [open PRs](https://github.com/lukasvri/Afterparty-MusicBot/pulls) for proposed
changes and the [changelog](CHANGELOG.md) for source release notes. Deployment
and live playback need separate host-side verification.

### Rust research is paused

Rust evaluation was paused at the owner's request on 18 October 2026. Current
work prioritizes **TypeScript/Node.js and FFmpeg** performance and stability.
The [offline mixer on `dev`](https://github.com/lukasvri/Afterparty-MusicBot/tree/dev/experiments/rust-audio),
its [development notes](https://github.com/lukasvri/Afterparty-MusicBot/blob/dev/docs/RUST_DEVELOPMENT.md)
and [earlier experiment](https://github.com/lukasvri/Afterparty-MusicBot/tree/experiment/rust-audio-nightly-20261016/experiments/rust-audio)
remain preserved. They are not part of the production audio engine. Resuming or
adopting Rust requires an explicit owner decision and review. Normal development
targets refreshed `main` through focused PRs; see the
[branch strategy](CONTRIBUTING.md#branch-strategy).

## Explore further

| I want to… | Read |
| --- | --- |
| Install and configure the stack | [Installation](docs/INSTALLATION.md) · [Configuration](docs/CONFIGURATION.md) |
| Understand rooms and permissions | [Own rooms](docs/OWN_ROOMS.md) · [Party experience](docs/AFTERPARTY_EXPERIENCE.md) |
| Understand audio and synchronization | [Music sources](services/core/docs/music-sources.md) · [Concert stability](docs/CONCERT_STABILITY.md) |
| Prepare an update or release | [Operations](services/core/PUBLIC_RELEASE.md) · [Release policy](docs/RELEASING.md) |
| Use the visual identity | [Branding and assets](docs/BRANDING.md) |

New website sessions default to English and retain saved language choices. Discord uses a compact English slash menu; `/play` includes optional `next`, `now` and `shuffle` controls. Persistent bot settings live on the server-scoped administration page rather than `/config`. Compatibility handlers accept previously cached command invocations. Spotify matching can differ from the original recording; chapter splitting and SponsorBlock are not implemented. Independent clients have different buffering and network delays, so synchronization is approximate.

## Contribute, report, remix

[Open an issue](https://github.com/lukasvri/Afterparty-MusicBot/issues) for a reproducible problem, or read [CONTRIBUTING.md](CONTRIBUTING.md) before a pull request. Report vulnerabilities through [SECURITY.md](SECURITY.md). Keep tokens, private logs, server IDs and databases out of public reports.

Afterparty is released under the [MIT license](LICENSE). Retained upstream code and fonts keep their [third-party notices](THIRD_PARTY_NOTICES.md). The license does not grant rights to music, video or third-party artwork. Website and Core versions are recorded in their package manifests and the shared [changelog](CHANGELOG.md); a release entry does not prove production deployment.
