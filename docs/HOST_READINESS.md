# Prepare the host for a public beta

Core runs on the host even when the website is hosted elsewhere. Server
installations and simultaneous voice sessions are different capacity measures.
Keep the active voice-session guard enabled; do not advertise unlimited audio
capacity based on the number of invitations.

## Live backups and recovery checks

`scripts/backup-core.py` snapshots every SQLite database under the configured
Core data directory with SQLite's online backup API. It includes guild databases
and committed records still in WAL files. Each database is a consistent snapshot;
the entire set is not one global transaction. A change to the database file set
during backup fails the run so a new guild cannot be silently omitted.

Store the configuration outside Git with mode `600`:

```json
{
  "data_dir": "/absolute/private/core-data",
  "backup_dir": "/absolute/private/backups",
  "config_files": {
    "compose.yml": "/absolute/private/compose.yml",
    "environment": "/absolute/private/core.env",
    "deploy.json": "/absolute/private/deploy.json"
  }
}
```

The backup directory must have mode `700`. The configuration and archives may
contain credentials and personal server data. Never upload them to Git or public
issue trackers.

```bash
python3 scripts/backup-core.py --config /absolute/private/backup.json
python3 scripts/backup-core.py --verify /absolute/private/backups/afterparty-ARCHIVE.tar.gz
```

Every successful backup is unpacked into an isolated temporary directory. File
hashes and every restored SQLite database are checked before the archive and
`latest.json` become current. Failed or overlapping runs do not replace the last
success. Verification never mounts production data or changes the running bot.
Archives are retained; arrange a deliberate retention policy and an encrypted
copy on a separate device. A backup on the host's own disk does not protect
against disk failure or loss of the host.

Use the tested deployment rollback workflow for live recovery. Restoring a
database requires stopping Core and selecting a compatible image. Do not replace
an active database with files from a test restore.

## Host health

```bash
python3 scripts/core-health.py \
  --config /absolute/private/deploy.json \
  --backup-dir /absolute/private/backups \
  --output /absolute/private/health.json
```

This read-only probe reports Discord readiness, active voice sessions, recent
event-loop delay, host memory and disk availability, backup age and user-service
linger. Reports omit credentials, server IDs, user identities, media titles and
private queue contents. Exit codes are `0` for healthy, `1` for a warning and `2`
for an error. During a deployment the probe respects the deployment lock. An
intentionally stopped container is reported without starting it.

Schedule the probe with a bounded systemd oneshot service. Give background jobs
lower CPU/I/O priority and keep their memory budgets finite. User timers need
`loginctl enable-linger USER` if they must continue after logout. Keep Docker and
the existing private network transport enabled at boot. A probe is monitoring,
not an automatic repair or a notification service.

## Resource budgets

Measure the actual host before selecting limits. Use a bounded memory limit to
protect the host, leave room for FFmpeg and media extraction, and avoid imposing
a tight CPU quota on real-time playback. CPU shares are a relative weight under
contention, not a CPU reservation. Equal Docker memory and memory-plus-swap
limits disable swapping for that container.

The Compose template permits 512 tasks because FFmpeg threads count against
`pids_limit`. A limit of 128 can be too small for eight concurrent crossfades.
The voice-session limit remains a separate guard. Preserve loopback-only ports,
read-only root filesystems, dropped capabilities and existing private mounts.

## Reproducible offline audio probe

Use an already validated production image. This probe creates synthetic audio
inside a network-isolated container and runs 1, 4 and 8 independent PCM mixers
and Opus encoders. It does not connect to Discord or mount production data.

```bash
docker run --rm --network none --read-only \
  --cpus=1.5 --cpu-shares=128 --memory=768m --memory-swap=768m \
  --pids-limit=512 --tmpfs /tmp:size=128m,mode=1777 \
  --mount type=bind,src="$PWD/scripts/audio-capacity.mjs",dst=/app/capacity.mjs,readonly \
  --entrypoint node YOUR_VALIDATED_CORE_IMAGE /app/capacity.mjs
```

This measures unpaced local audio computation, startup overhead and task/memory
peaks. It is not a real-time packet-pacing test, a media-provider load test or a
multi-server Discord capacity guarantee. Before increasing the live voice limit,
test actual concurrent Discord sessions, crossfades, network recovery and the
host's latency while its normal desktop workloads are running.

## Before the release

- Verify a recent backup on a separate device and an isolated restore.
- Test the final runtime image as its unprivileged user. Build-stage tests running
  as root cannot detect unreadable source files in the final image. The deployer
  performs this check before it stops production.
- Ensure `origin/main` contains the running commit and the release changes before
  requesting a normal deployment. Do not weaken the ancestry check to deploy an
  older or unrelated build.
- Run the existing automated checks and listen in more than one real server.
- Verify public install links, server-specific admin permissions and isolation.
- Review the current Discord App Verification checklist as the installation count
  grows. Identity verification and public release approval belong to the owner.

References: [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/),
[SQLite online backups](https://www.sqlite.org/backup.html),
[Discord app verification](https://support-dev.discord.com/hc/en-us/articles/23926564536471-How-Do-I-Get-My-App-Verified).
