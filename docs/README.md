# Afterparty documentation

[Back to the project](../README.md)

<img src="assets/afterparty-banner.png" alt="Afterparty music identity with a red illuminated DJ platter" width="100%" />

## Start here

| Goal | Guide |
| --- | --- |
| Install your own bot and website | [Installation](INSTALLATION.md) |
| Find a variable or hosting requirement | [Configuration](CONFIGURATION.md) |
| Understand the two services and their data | [Architecture](ARCHITECTURE.md) |
| Run, update or recover Core | [Operations and recovery](../services/core/PUBLIC_RELEASE.md) |

## Run a host

- [Core guide](../services/core/README.md): runtime, persistence and container validation.
- [Host readiness](HOST_READINESS.md): online SQLite backups, restore verification, health reporting and offline audio probes.
- [Remote deployment](REMOTE_DEPLOY.md): reviewed updates and recovery over SSH while private data stays on the host.

Core must stay online for Discord playback. The website needs its own Workers/D1 or Sites deployment and an HTTPS connection to Core. Local preview is a development environment.

## Understand the experience

- [Own rooms](OWN_ROOMS.md): browser room queues, radio, permissions and scheduling.
- [Radio selection](RADIO.md): persistent original song, similarity evidence and automatic music filtering.
- [Party experience](AFTERPARTY_EXPERIENCE.md): shared queue controls, invitations, saved evenings, moderation and TV mode.
- [Concert stability](CONCERT_STABILITY.md): playback recovery, synchronization and video diagnostics.
- [Music sources](../services/core/docs/music-sources.md): YouTube, SoundCloud, Spotify matching, radio and audio quality. Earlier sections retain their original Norwegian wording.
- [Branding](BRANDING.md): ap identity, artwork, fonts and compatibility identifiers.

## Develop and release

- [Contributing](../CONTRIBUTING.md): current source, code boundaries and PR validation.
- [Cloud development](CLOUD_DEVELOPMENT.md): source-only cloud development and the local production boundary.
- [TypeScript conventions](TYPESCRIPT.md): application code, Node tooling and incremental consolidation.
- [Release policy](RELEASING.md): shared versioning and generated release notes.
- [Release channels](RELEASE_CHANNELS.md): stable bot/web patches and experimental Discord Activities.
- [Changelog](../CHANGELOG.md): product versions and preserved historical notes.

## Policies

[Security reporting](../SECURITY.md) · [Privacy](PRIVACY_POLICY.md) · [Terms](TERMS_OF_SERVICE.md) · [MIT license](../LICENSE) · [Third-party notices](../THIRD_PARTY_NOTICES.md)

## Engineering records

These are dated reviews of specific changes, not a live checklist of production status. Their test counts and baselines refer to the snapshot they describe.

| Record | Context |
| --- | --- |
| [Synchronization and runtime review](SYNC_RUNTIME_REVIEW.md) | Source freshness, live/fallback ordering, transport cost and the TypeScript/Rust assessment |
| [Final source release check](FINAL_RELEASE_CHECK.md) | Current source gates, presentation cleanup and remaining host validation |
| [Release review](RELEASE_REVIEW.md) | Playback, query and search optimization; ap identity; validation limits |
| [Core reliability validation](../services/core/docs/reliability-validation.md) | Audio cancellation, race recovery and bridge query measurement |
| [Independence and compatibility](AFTERPARTY_INDEPENDENCE.md) | Removal of old reference code while retaining stored-data and protocol inputs |
| [Backend evaluation](../services/core/docs/backend-options.md) | Historical provider and radio decisions, originally written in Norwegian |

## Documentation images

The [asset notes](assets/README.md) identify the generated brand banner and synthetic local screenshots. Images live in this repository so they remain available when the README is viewed on a fork or branch.

## AI collaboration

- [Codex handoff](CODEX_HANDOFF.md): dated source/deployment state, failed synthetic-game rollout, verified rollback, preserved work and the next safe task.
- [AI collaboration workflow](AI_WORKFLOW.md): direct Codex and GitHub work, optional Chat coordination and practical prompts; Dot is paused and Work is excluded.
- [Shared AI project context](AI_CONTEXT.md): durable product decisions, source-of-truth rules and important architecture boundaries.
