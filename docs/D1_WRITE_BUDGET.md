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

- Continue durable heartbeat writes and command handling on every bridge call.
- Update a room immediately when its serialized playback state or guild changes.
  For identical snapshots, renew the existing 48-hour lease when at most 24 hours
  remain. Do not increment the room revision for an unchanged heartbeat.
- Determine Discord online status and synchronization freshness from that guild's
  heartbeat record, retaining the existing 15-second online boundary and legacy
  room-only fallback. Keep the playback position timestamp on the snapshot.
- Pause concert-queue polling while its tab is hidden or offline. Resume once
  on return, without overlapping polls or bypassing pending-mutation handling.
  Keep the distributed D1 rate limiter intact.

For two unchanged default-server bridges, the estimated steady baseline falls
from three to two table writes per bridge call, about 69,120 per day plus lease
renewals. Active playback still writes changed positions. This is not a promised
production saving or a guarantee that the daily account limit cannot be reached.

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

Staging currently contributes to the same account quota. Stopping an unused
staging publisher could reduce usage further but is a separate production-side
decision, not part of this source change.

References: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[metrics and query insights](https://developers.cloudflare.com/d1/observability/metrics-analytics/).
