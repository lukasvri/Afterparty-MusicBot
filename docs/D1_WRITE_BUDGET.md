# D1 bridge write budget

## Observed source of writes

Read-only account analytics on 24 October 2026 showed approximately 40,400 rows
written by the Afterparty production database and 40,200 by staging at inspection
time. Query insights identified the three bridge upserts (guild heartbeat,
default-server heartbeat alias and room snapshot) as the write-heavy queries in
both databases. These are a dated baseline, not a measurement of the new code.

The Core publisher contacts the durable bridge every five seconds. A default
server previously updated all three records even with unchanged room state.
At that cadence, two default-server publishers can produce 103,680 table writes
per day before user traffic. This is a source-based estimate; analytics sampling,
indexes, retries, playback and active servers affect actual usage.

## Change and preserved behavior

- Keep one canonical heartbeat per guild and handle commands on every bridge
  call. The default room resolves its guild through `DISCORD1.guild_id` instead
  of writing a second `discord` alias. Legacy unscoped bridges still use that
  key. An existing alias is left untouched and never used for a scoped room
  whose canonical heartbeat is missing.
- Update a room immediately when its serialized playback state or guild changes.
  For identical snapshots, renew the existing 48-hour lease when at most 24 hours
  remain. Do not increment the room revision for an unchanged heartbeat.
- Determine Discord online status and synchronization freshness from that guild's
  heartbeat record, retaining the existing 15-second online boundary and legacy
  room-only fallback. Keep the playback position timestamp on the snapshot.
- Pause concert-queue polling while its tab is hidden or offline. Resume once
  on return, without overlapping polls or bypassing pending-mutation handling.
  Keep the distributed D1 rate limiter intact.

For one unchanged default-server bridge with staging off, the estimated steady
baseline is one table write per five-second bridge call, about 17,280 per day
plus lease renewals. Compared with two bridges each writing two heartbeats,
that is a source-based 75% reduction. Active playback still writes changed
positions. This is not a measured production saving or a guarantee that the
daily account limit cannot be reached.

## Validation and rollout

SQLite regression tests exercise real bridge/room handlers, unchanged snapshots,
immediate transitions, lease renewal, command receipts, 15-second freshness and
guild isolation. Foreground polling tests cover hidden/offline views, resumption,
single in-flight polling and cleanup. The existing concert queue browser suite
also checks suspension and immediate visible refresh.

Review and deploy this candidate through the normal owner-approved process. No
schema migration, secret change or plan upgrade is required. After separately
approved deployment, compare account-wide rows written and the room-upsert query
on production and staging over comparable idle/playback windows. Check real
online/offline transitions, command delivery and playback synchronization. A
successful local test or merged PR does not establish a production saving.

## Staging only during tests

The staging Core publisher contributes to the same account quota. Leave its
existing container stopped between tests with Docker restart policy `no`. Stop
the publisher, rather than only disabling its Worker, so it does not keep
retrying. Preserve the container, mounts, image and private configuration.
The production Core must remain independent.

On the Linux deployment host, run a foreground test in a bounded session:

```sh
python3 scripts/staging-session.py --container afterparty-staging-core --minutes 30 -- /absolute/path/to/staging-test.sh
```

Use the actual private staging container name. The historical
`afterparty-activity-test-core` name is also supported. The script refuses
production names, running containers and automatic restart policies. It uses
user systemd to start the pinned container ID and stop it after the test exits,
fails, or reaches the time limit. Cleanup belongs to the host manager even if
the requesting terminal disconnects. A fixed unit name prevents overlapping
sessions. There is no unmanaged start fallback if systemd is unavailable.
The test must wait for staging readiness and remain in the foreground for the
whole session. For manual testing, use a foreground `sleep` with the desired
duration. End it early with `systemctl --user stop
afterparty-staging-test-CONTAINER.service`; stopping the client alone need not
stop the host unit. A Docker failure can still prevent cleanup: inspect the
unit result and confirm the container is stopped after testing.

Staging being offline between sessions is intentional. Its frontend remains
available, but live Discord functionality is unavailable until a test session
starts. This script does not install itself, schedule tests, change restart
policies, rebuild images or change production configuration.

## Next architecture step: Core owns transient state

Core already owns the playback clock and provides authenticated state, events
and command/job transports. The website prefers those direct endpoints and
uses D1 as its durable fallback. This change removes duplicate persistence,
but deliberately retains the single five-second D1 liveness lease. Removing
that lease requires a separate migration: an unavailable Core cannot prove its
own last-known liveness to a stateless Worker.

The next slice should separate transient presence/position from durable queue,
intent, history and command receipts. Keep live presence in Core, checkpoint
durable changes with monotonic revisions, and define a bounded stale/offline
response when Core cannot be reached. Test restart recovery, deliberate pause,
seek, queue replacement, retries, guild isolation and browser reconnects before
reducing checkpoint frequency. Do not silently extend the 15-second online
boundary or substitute per-Worker memory for a shared liveness guarantee.

## Revisioned room checkpoint candidate for issue #132

This is a bounded first slice, not completion of the transient-presence migration.
The canonical guild heartbeat still persists every five seconds. Both Discord
state fallback and room fallback retain their exact 15-second online boundary
and 12-second playback lease. No Worker-local cache or new service is used.

New Core publishers send a durable `bridgeRevision` on every request and a
`checkpointRevision` for the current explicit intent. The publication counter
lives in the existing local Core SQLite `kv` table and increases across publisher
and process restarts. This adds one local SQLite counter write per publication
attempt; the D1 measurements below do not count local Core disk writes. An engine revision change, buffering transition or new
publisher creates a checkpoint immediately through the existing change-triggered
publisher. Active playback checkpoints its advancing position at most once per
minute; unchanged idle state only needs a daily room-lease renewal.

The Worker accepts only increasing publication order and nondecreasing checkpoint
order within that guild's canonical heartbeat. Room checkpoints update only for
newer intent from the exact accepted heartbeat payload, in the same D1 batch.
Equal counters with a different payload cannot install or recreate a room. A delayed or repeated publication cannot
overwrite a newer pause, seek or replacement, or renew its presence. History and
result acknowledgements remain idempotent and can complete even when the
accompanying playback sample is older. Command IDs, result receipts, queue
revisions, stale-command guards and per-guild authorization are unchanged.

Discord room fallback projects position from its own canonical heartbeat rather
than the older room checkpoint. It checks both guild and room identifiers and
filters public concert content. A fresh heartbeat therefore keeps the clock
moving without a room write; an outage expires the same existing playback lease.
Reconnecting only reads current intent, including a deliberate pause. Legacy
unscoped publishers and payloads without checkpoint counters retain their existing
behavior for a rolling upgrade and rollback.

The Core also saves explicit pause/resume recovery intent before emitting its
state-change notification. Previously a pause just after the consumed-position
tick could leave the old recovery flag on disk until another checkpoint. A
regression reopens the actual local SQLite file before any later tick and verifies
the new flag and consumed position.

### Comparable synthetic write windows

The bridge regression executes the actual Worker SQL against migrated, isolated
SQLite storage. Each window contains 60 five-second publications over five
minutes, excludes the initial two-row seed, and has no user/history/command writes.
It counts table-row changes with SQLite `total_changes()`, not production account
analytics or index billing.

| Five-minute window | Previous bridge | Revisioned checkpoint bridge |
| --- | ---: | ---: |
| Unchanged idle | 60 | 60 |
| Advancing active playback | 120 | 65 |
| Active room rows within that total | 60 | 5 |

The active synthetic window reduces table-row writes by 55, or 45.83%. It does
not reduce idle heartbeat writes, and does not establish production savings.
Buffering, commands, queue changes, playback transitions, expiry maintenance and
multiple publishers change the real budget.

### Compatibility, rollback and remaining work

There is no D1 schema migration. Deploying or rolling back remains a separate
owner-approved operation. Keep the entire per-guild Core database and its `kv`
counter with backups and restarts. Stop the current publisher before starting an
older one; legacy payloads deliberately retain their old acceptance behavior.
Reverting the website and Core restores the prior bridge cadence without deleting
rooms, queues, history or receipts.

### Opt-in Core authority without a D1 presence heartbeat

The next slice is explicitly negotiated. Set `CORE_BRIDGE_PRESENCE=authority` in
Core only when the website has its authenticated `GUTTA_CORE_PUBLIC_URL` configured.
The default remains the revisioned heartbeat above. The browser-safe protocol,
intent checks, capability and deadline live in `services/core/src/bridge-checkpoint.ts`.

For `core-authority-v1` publications, the Worker checks fixed-origin authenticated
Core `/v1/state?authority=1` using a **1,500 ms deadline**, the caller's abort signal,
no redirects, and exact guild, room, Engine epoch, intent sequence and buffering
matches. Only a newer durable checkpoint updates `bot_state` and `rooms`, together;
unchanged five-second presence and advancing positions produce no D1 state writes.
The checkpoint is sampled from freshly verified Core state, not the delayed
publisher position. Each record retains the negotiated mode. Explicit pause,
seek, queue replacement and process restart still create immediate checkpoints;
unchanged active playback checkpoints every minute, idle daily.

Room and Discord reads obtain fresh Core state with the same bounded deadline.
**This intentionally changes the legacy 15-second offline grace in negotiated
mode:** after a direct request fails or times out, return the durable checkpoint
immediately with `online=false` / `discordOnline=false`, `playing=false` and zero
playback lease. Do not extrapolate its position or enable controls. A missing Core
URL, missing heartbeat or explicit rollback flag alone cannot relabel that saved
checkpoint online. Reachable Core remains authoritative; a browser reconnect
only reads state and cannot resume a paused song.

Five-second bridge requests continue handling idempotent history and result ACKs.
If Core verification is unavailable, those safe receipts may still finish, but
no state is written and **no pending commands are claimed or returned**. Existing
pending commands can expire normally. A mismatched/superseded Engine intent is
rejected and cannot renew state. Guild-scoped receipts, queue revisions and stale
command guards are unchanged. No Worker-local presence cache is introduced.

Comparable migrated-SQLite five-minute windows, again excluding the initial seed,
user/receipt/maintenance/index writes and local SQLite counters:

| Five-minute window | Original bridge | Revisioned heartbeat | Opt-in Core authority |
| --- | ---: | ---: | ---: |
| Unchanged idle | 60 | 60 | 0 |
| Advancing active playback | 120 | 65 | 10 |
| Active room rows within that total | 60 | 5 | 5 |

The negotiated active window saves 110/120 table-row changes (91.67%); the idle
window removes its 60 heartbeat changes. Daily idle renewal, real intent changes,
receipts, rate limits, cleanup, indexes and concurrent servers remain additional
costs. These are synthetic comparable counts, not production account savings.

### Rollback, restored backups and remaining acceptance

`GUTTA_CORE_BRIDGE_MODE=legacy` is an explicit **website** rollback override. Keep
the opt-in publisher and authenticated Core available until a **newer, verified
checkpoint** replaces the saved authority record with legacy heartbeat mode.
Unverified, delayed or old-binary legacy frames cannot perform that downgrade,
even when the override is set. Only then stop the newer publisher before rolling
back to an old binary. Removing the URL or capability first leaves saved authority
checkpoints offline, rather than reviving stale state. Do not delete watermarks,
rooms, queue data or receipts to force a rollback. A full coordinated binary
rollback remains a separate operator-approved operation.

For opt-in publishers, a new Engine epoch whose publication counter is at or below
the durable D1 watermark receives structured HTTP 409
`bridge_reconciliation_required`. The publisher stores a durable local block and
stops allocating counters or retrying, including after process/database reopen.
It does not acknowledge retained data, reset counters, alter playback or restart
audio. Its public Core snapshots and streams become offline, not ready and paused;
authenticated authority reads return 409, and previously issued public control
tickets cannot create or execute jobs. Private operator reads and other servers
retain their existing behavior. A normal restart with the intact counter can establish its new epoch.
Legacy heartbeat publishers retain their previous ordering behavior and do not
have this terminal handshake. Same-epoch delayed frames do not stop the publisher.

This is not a complete backup-restore or concurrent-publisher fencing protocol.
Authority/public reads can appear before the first bridge acknowledgement: the
terminal 409 block quarantines public state after detection, not before a startup
handshake. The manual stopped-audio/publisher precondition below remains necessary.
Skipped transient publications have no D1 watermark; a restored counter already
above the last durable checkpoint cannot be detected by that counter alone.
A copied live epoch and later superseding publisher require manual reconciliation.
Keep restored publishers **and audio stopped** until an operator reconciles the
whole per-guild database, queue, explicit playback intent and publication continuity
against validated current state. Do not automatically raise/reset either counter,
clear a reconciliation block, delete the D1 watermark or resume old backup intent.
The publisher block only stops website publishing and does not stop existing
Discord audio or make old-backup audio recovery safe by itself.

The bounded source slice in issue #132 is implemented and covered by synthetic
outage, restart, reconnect, isolation and SQL write-budget tests. Its manual
recovery precondition and fencing limits are explicit above; full automatic
backup-restore/concurrent-publisher fencing is outside this slice. Production
telemetry and live listening are not established by these tests. Live Discord
acceptance and release readiness remain tracked separately in issues #37 and #92;
merging this source change does not authorize deployment.

References: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[metrics and query insights](https://developers.cloudflare.com/d1/observability/metrics-analytics/),
[systemd-run](https://www.freedesktop.org/software/systemd/man/255/systemd-run.html),
[systemd service cleanup](https://www.freedesktop.org/software/systemd/man/255/systemd.service.html).
