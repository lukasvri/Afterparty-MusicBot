# Gutta Krutt Core

**The self-hosted audio engine behind Afterparty.** Core connects to Discord, manages per-server queues and exposes the playback state used by the website.

[Full installation guide](../../docs/INSTALLATION.md) · [Environment reference](../../docs/CONFIGURATION.md) · [Operations and backups](PUBLIC_RELEASE.md)

## Start here

From this directory, after creating your Discord application and configuring your website addresses:

```bash
cp .env.example .env
# Fill in your own values before continuing.
docker compose up -d --build
curl --fail http://127.0.0.1:3990/health
```

Do not overwrite an existing `.env`. A healthy response contains `"ready":true`.

## Run and inspect

```bash
docker compose ps
docker compose logs --tail=100 core
docker compose stop
```

The `core-control.sh` helper supports `start`, `stop`, `status`, `logs` and `admin`, using Docker context `default`. Its `start` action uses the existing image; it does not build new source. Administration lives at `/admin` on your configured website, not on a separate Core admin port.

## Persistence and networking

Compose mounts the named `core-data` volume at `/data`. Additional Discord servers use `/data/guilds/<server-id>/core.sqlite`. Back up the complete volume.

The host port is `127.0.0.1:3990`. Use an HTTPS proxy or tunnel for website access while preserving this local binding.

## Test without production data

```bash
docker build --target validation -t gutta-krutt-core:validation .
```

This typechecks Core and runs its tests, including real FFmpeg/Opus audio. Core uses its own runtime and command definitions. Adapted code retains its upstream license in `licenses/player-upstream.LICENSE`.
