# Operations and recovery

[README](../../README.md) · [Installation](../../docs/INSTALLATION.md) · [Configuration](../../docs/CONFIGURATION.md)

## Normal operation

Run these from `services/core/`:

```bash
docker compose ps
curl --fail http://127.0.0.1:3990/health
docker compose logs --tail=100 core
```

`ready: true` confirms Discord readiness. Verify actual playback and website connectivity separately. The Core host, Docker and network must remain available for audio. A hosted website does not keep the bot running when its host is off.

## Back up before updating

Back up the entire `/data` volume, including every `guilds/` database. Stop Core for a consistent file copy, or use SQLite's backup API separately for every live database. Protect backups because they contain server data.

Example for a local backup using the existing container:

```bash
# Run from services/core/.
umask 077
mkdir -p backups
backup_file="backups/core-$(date +%Y%m%d-%H%M%S).tar"
docker compose stop core
if docker cp gutta-krutt-core:/data/. - > "$backup_file"; then
  tar -tf "$backup_file" >/dev/null
else
  echo "Backup failed. Do not upgrade. Inspect the partial archive locally."
fi
docker compose start core
```

Confirm the archive is nonempty and readable before an update. Keep a separate protected copy of your configuration and credentials. Do not commit either to Git. `docker compose down -v` removes the data volume and is not a normal stop command.

## Update deliberately

A bot restart interrupts voice playback. Choose a suitable time and take a verified backup first.

1. Record the current commit with `git rev-parse HEAD`.
2. Preserve the running image before building:

   ```bash
   docker image tag "$(docker inspect --format '{{.Image}}' gutta-krutt-core)" gutta-krutt-core:before-update
   ```

3. From the repository root, run `git pull --ff-only`. Resolve any local configuration conflicts before proceeding.
4. From `services/core/`, run `docker compose build`. The image build must pass validation.
5. Run `docker compose up -d --no-build`, then check health, recent logs, the player and website sign-in.

If the new image fails, select the preserved compatible Core image in Compose and recreate the service. Review any schema migrations before using an older image. Restore a backup only after stopping Core and verifying that it matches the selected version. Do not overwrite newer data casually. Muse rollback is not a supported recovery path for the multi-server Core databases.

## Server isolation and access

Each Discord server has its own queue, settings, favorites, saved queues and database. The owner server uses `/data/core.sqlite`; other servers use `/data/guilds/<server-id>/core.sqlite`.

Discord login requests `identify` and `guilds`, and administrative access requires ownership, Administrator or Manage Server permission for the selected server. Sessions last at most eight hours. The legacy owner-password fallback does not grant access to other servers.

Only concert tracks are exposed in the public website feed. Normal Discord music and private requester information must stay out of public state.

## Resource limits and metrics

Media extraction has a shared limit of four running processes and sixteen queued requests. Audio startup takes priority over searches. The default voice-session limit is eight. This is a resource guard, not evidence that every host can sustain eight simultaneous streams.

Core 2.0.1 adds indexed history/job queries, atomic queue writes, batched acknowledgements and reduced work in the clock loop. SQLite retains WAL and `synchronous=FULL`; playback recovery is still checkpointed once per playback second.

Admin metrics use an approximately 60-second rolling window with one-second buckets. `requestCount` is lifetime total; `windowRequestCount` covers the current window. Event-loop p95 measures delay beyond the expected 20 ms timer interval and is not directly comparable with the earlier interval-inclusive metric.

## Verification limits

Automated tests cover audio encoding, queue behavior, authorization, persistence and two simulated Discord servers. Multiple real Discord servers with simultaneous listeners have not been production load-tested. Media-provider availability and browser playback policies remain external dependencies.
