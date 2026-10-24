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

Restoring an older local database whose publication counter trails D1 is a
separate recovery operation. Individual publications below the stored watermark
are rejected, but retries keep allocating numbers and can eventually overtake it.
Monotonic ordering is not persistent publisher fencing. Keep a restored publisher
stopped until an operator has reconciled its queue, explicit playback intent and
publication continuity against validated current state. Do not automatically
reset either counter, delete the D1 watermark or resume old backup intent. A
reviewed recovery handshake for backup rollback and concurrent publisher fencing
remains future work.

Issue #132 remains open. Removing the five-second D1 presence/position lease still
requires an explicit bounded offline fallback contract and its outage/restart,
direct/fallback, concurrent-guild and browser-reconnect acceptance. This slice
does not move all transient state out of D1 or claim full migration, live Discord
listening, deployment or provider verification.

References: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[metrics and query insights](https://developers.cloudflare.com/d1/observability/metrics-analytics/),
[systemd-run](https://www.freedesktop.org/software/systemd/man/255/systemd-run.html),
[systemd service cleanup](https://www.freedesktop.org/software/systemd/man/255/systemd.service.html).
