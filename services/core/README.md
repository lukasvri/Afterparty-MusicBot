<div align="center">

<img src="../../public/afterparty-mark.svg" alt="Afterparty ap mark with a red dot" width="112" />

# Afterparty Core

**Discord audio. Server-owned queues. A shared playback clock.**

[Installation](../../docs/INSTALLATION.md) · [Configuration](../../docs/CONFIGURATION.md) · [Architecture](../../docs/ARCHITECTURE.md) · [Operations](PUBLIC_RELEASE.md)

</div>

Core is the self-hosted engine behind Afterparty. It connects to Discord, resolves music sources, produces audio and supplies the live state used by the website. Its host must stay online for Discord playback.

## Start a fresh installation

Create and install your Discord application, then follow the [full installation guide](../../docs/INSTALLATION.md) to configure your website addresses and shared bridge secret. From this directory:

```bash
cp .env.example .env
# Fill in your own values before starting Core.
docker compose up -d --build
curl --fail http://127.0.0.1:3990/health
```

Keep an existing `.env` when updating. `ready: true` confirms Discord readiness; verify actual playback and website connectivity separately. The image supplies Node.js, FFmpeg and yt-dlp.

## Run and inspect

| Task | Command |
| --- | --- |
| Container status | `docker compose ps` |
| Recent logs | `docker compose logs --tail=100 core` |
| Start the existing image | `docker compose up -d --no-build` |
| Stop Core | `docker compose stop core` |

`core-control.sh` supports `start`, `stop`, `status`, `logs` and `admin` using Docker context `default`. It selects an ignored `compose.local.yml` when present, or `CORE_COMPOSE_FILE` when explicitly configured. `start` uses the existing image. Administration lives at `/admin` on the website; the production entry point disables the older separate admin listener.

## Audio and data

YouTube and SoundCloud supply playable audio. Spotify links provide metadata used to find a playable match. FFmpeg handles decoding, crossfades and Opus output. See [music sources](docs/music-sources.md) for matching, radio and quality limits.

Compose mounts the named `core-data` volume at `/data`. The initial owner server uses `/data/core.sqlite`; additional servers use `/data/guilds/<server-id>/core.sqlite`. Each server has its own queue, settings, favorites and saved queues. Ordinary Discord music stays out of public concert state.

Back up the entire volume. [Host readiness](../../docs/HOST_READINESS.md) covers online backups and isolated restore checks; [operations](PUBLIC_RELEASE.md) covers updates and recovery. `docker compose down -v` deletes the volume.

## Networking

Compose binds Core to `127.0.0.1:3990` on the host. Use an HTTPS proxy or tunnel for website access while preserving that local binding. Core and the website must be able to reach one another with the configured origins and shared secret. A hosted website does not keep an offline bot running.

## Validate with isolated data

From the repository root, with Node.js 24.17+, Python 3.11+ and FFmpeg:

```bash
npm run setup:cloud
npm run check:all
```

To validate the container from this directory:

```bash
docker build --target validation -t gutta-krutt-core:validation .
```

Core tests include real FFmpeg encoding and generated stereo tones. They validate frame behavior, not what a listener hears in a live Discord channel. Host capacity and reconnect checks remain separate. Adapted player code retains its upstream license in [`licenses/player-upstream.LICENSE`](licenses/player-upstream.LICENSE).
