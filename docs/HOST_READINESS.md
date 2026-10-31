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

Voice usage counts connected sessions, including paused or idle connections.
Connection attempts in progress are not exposed by this metric, so the admission
guard remains authoritative. The probe checks the archive's size and SHA-256
against `latest.json` on every run before reporting a recent verified backup.

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

Extractor admission uses one shared weighted budget from the OS-reported process
memory constraint, with a four-process ceiling. Full extraction costs 512 MiB;
metadata that skips player JavaScript and audio manifests costs 256 MiB. A 1 GiB
container can therefore admit two full extractions or four lightweight metadata
jobs, subject to each batch's three-worker bound. Mixed work shares that budget;
queued playback remains ahead of catalog work even when a lighter job could fit.
Unknown constraints retain enough budget for four full jobs, and the minimum
budget admits one full job.
This is a concurrency budget, not a memory reservation or an OOM guarantee:
JavaScript challenge runtimes, FFmpeg and Core share the container's limit.
Measure cold catalog latency as well as playback when qualifying smaller hosts;
less parallel extraction can increase search latency. No request deadlines or
container limits are raised by this admission policy.

The no-key video-metadata fallback requests full player metadata while skipping
player JS and HLS/DASH format resolution. It keeps no-format errors enabled and
tries the original full extraction once only for a final formats-unavailable
error. Private/source failures and deadlines are not retried through that path.
Actual stream extraction still resolves its original audio formats. See the
[pinned yt-dlp source review](research/yt-dlp-metadata-only.md).

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
  --mount type=bind,src="$PWD/scripts/audio-capacity.ts",dst=/app/capacity.ts,readonly \
  --entrypoint node YOUR_VALIDATED_CORE_IMAGE /app/capacity.ts
```

This measures unpaced local audio computation, startup overhead and task/memory
peaks. It is not a real-time packet-pacing test, a media-provider load test or a
multi-server Discord capacity guarantee. Before increasing the live voice limit,
test actual concurrent Discord sessions, crossfades, network recovery and the
host's latency while its normal desktop workloads are running.

## Qualifying a Core runtime change

Use this sequence for [Node 26 LTS qualification](TOOLCHAIN.md#core-lts-qualification-evidence-30-october-2026)
and later runtime changes. This is a preparation and review plan, not an
instruction to update a live host without its owner's approval.

1. Record the running source commit, immutable image ID, Node version, health,
   active voice sessions and backup verification result in private host records.
   Use the existing online backup and read-only health commands above. Preserve
   the complete per-guild data tree, private Compose/environment configuration
   and exact previous image. Verify the archive before proceeding.
2. Keep experimental qualification images separate from production. The local
   Node 26 image recorded in the toolchain guide is unsigned qualification
   evidence. Do not supply it to the production deployer or bypass the required
   canonical main-push checks and signed build assets. Preserve the currently
   installed image and runtime recorded in step 1 until the replacement is
   separately approved. A source pin or historical qualification result does
   not establish a host's current production baseline.
3. First probe the candidate offline as its unprivileged user, with a read-only
   root filesystem, resource limits and no production mounts, credentials or
   network. Check its actual Node version, source/package readability, required
   imports, worker execution, FFmpeg and synthetic audio. Use the existing
   offline audio probe above; record image-specific results rather than assuming
   that a root build-stage test establishes runtime behavior.
4. For an authorized real staging window, use a separate existing staging
   container, test application and data. Preserve restart policy `no` and run a
   bounded [staging session](D1_WRITE_BUDGET.md#staging-only-during-tests).
   Verify health and source/image identity, SQLite integrity, selected-server
   authorization, queue/recovery behavior, pause/seek intent and reconnects.
   Never reuse production configuration to make an experimental image start.
   Stop staging at the end and confirm that production's image, start time,
   mounts and playback are unchanged. Real listening remains a separate check.
5. Reconfirm the runtime's actual LTS/security support, not just its scheduled
   transition date. After approval of the pinned runtime source change and a
   successful canonical main build, use the installed signed-artifact deployer's
   `--check` workflow in [remote deployment](REMOTE_DEPLOY.md#everyday-use-from-your-main-computer).
   It verifies/imports the exact tested image without stopping production.
   A later live switch still needs an approved window and a fresh verified backup.
6. Use that deployer's existing failure/recovery transaction for the live switch:
   stop the failed candidate, preserve its data for investigation, restore the
   matching pre-switch data and exact previous image, then verify recovery.
   Preserve deliberate pauses and newer user intent. Never reset publication
   counters, delete bridge watermarks or combine an old database with a newer
   live session to force an update through. Reconcile restored state while the
   affected publisher is stopped, following the current
   [bridge rollback contract](D1_WRITE_BUDGET.md).

The plan is prepared; host execution, actual listening and runtime promotion
are not established by this document. Keep private evidence off GitHub and
report sanitized pass/fail/not-run results in the tracking issue.

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
