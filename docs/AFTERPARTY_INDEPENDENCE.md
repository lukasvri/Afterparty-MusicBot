# Afterparty independence and feature inventory

Baseline: `b18a3f770e9928936e33e8305e3ddf8db811e3b2` on main, including merged
PR #4 (`b219e90`). This change builds on that merge, not on a competing playback
implementation. Inventory recorded before refactoring.

## Features to preserve

| Area | Existing behavior and verification |
| --- | --- |
| Website playback | Official YouTube embed; startup, muted fallback, pause/resume, seek, volume/mute, fullscreen, immersive controls, synchronization mode/offset. Behavior and simulated Chromium tests. |
| Rooms | Create, join, host token, public/private listing, guests, queue, radio, shared clock, ended-video hold during delayed/failed radio lookup. D1 handler, Core room and browser tests. |
| Discord | Existing slash command definitions, player message, both button rows, private extra controls, queue, repeat, shuffle, favorites, saved queues, permissions and voice recovery. Core command/player tests. |
| Core playback | YouTube, SoundCloud, Spotify matching, radio recommendations, FFmpeg/Opus, seek, crossfade, per-server storage, queue revisions and stale-command protection. Core suites including real synthetic audio. |
| Integration | Discord OAuth and owner access boundaries, bridge commands/results, realtime transport, public concert feed isolation. Existing server/guild tests. |
| Persistence | Browser host tokens, visitor identity, motion, sync and audio preferences; existing SQLite queues/settings/favorites; optional import of old exported data. Migration regression tests. |
| UI and operations | Music, rooms, admin, patch notes, language switch, Core static assets, local deployment and recovery tools. Typechecks, build and deployment recovery suite. |

## Audit and approach

No Muse npm runtime dependency or separate Muse service is present. The reference
TypeScript files are unused copies; active Discord behavior lives in Core.
The website entry and shared navigation still use the old name. Browser storage,
visitor headers, old Discord button IDs and the database import marker are existing
persisted interfaces, so deleting their recognition would lose access or behavior.

Move active UI and command definitions to Afterparty-owned components. Remove
unused reference implementation files, retaining the upstream MIT notice for
adaptations. Isolate old wire/storage identifiers in compatibility adapters, write
new browser state using Afterparty names, and retain read compatibility for old
clients and saved data. Keep the optional offline data importer independent of
any running old bot. Existing host mounts and environment references stay valid.

Do not remove provider integrations, command options, or static endpoints merely
to eliminate names. SponsorBlock and chapter splitting occur only in unused
reference code and were already documented as unimplemented in the active engine.

## Validation boundaries

Cloud checks use synthetic credentials/data. Chromium playback uses a simulated
YouTube player and intercepted room APIs. FFmpeg tests exercise real encoding of
synthetic audio. Neither establishes actual YouTube availability nor what a person
hears in Discord. No production bot, Discord account or production data is used.

Pre-existing lint baseline supplied with the task: 112 errors and 29 warnings.
Final measurements and check results are recorded in the pull request.

## Retained compatibility inputs

The remaining old identifiers are deliberately limited to data/protocol input,
tests and attribution, not an engine dependency:

- `lib/browser-storage.ts` reads old browser keys if the Afterparty key is absent.
  Host tokens, visitor IDs, audio, volume, motion and synchronization survive.
  New writes use `afterparty-*`. Old keys remain untouched for already-open clients.
- `lib/visitor-identity.ts` accepts the previous visitor header as a fallback.
  New clients and smoke tools send `X-Afterparty-Visitor`.
- `services/core/src/player-compatibility.ts` recognizes previously posted Discord
  buttons and allows the player to reclaim its existing message. New buttons retain
  the current `krutt:` IDs; every action and both button rows are preserved.
- `services/core/src/data-import.ts` reads the old completion marker to prevent
  accidental reimport over current data. It imports offline exports transactionally
  and writes `afterparty-imported`. `LEGACY_DATA_DIR` remains a supported optional
  configuration input, preserving existing private host mounts.
- Smoke tools prefer `AFTERPARTY_TEST_URL` and still accept the old test URL variable.
- The upstream notice and license remain for retained player/command adaptations.
  The Core image now also contains that license.

The independence migration removed no API endpoint or provider integration. Core's then-existing static admin
asset routes were retained, since they are referenced by the server. A pre-existing
limitation is that this checkout lacks `services/core/public/index.html`, and the
production image did not copy those assets. This change does not claim to repair
or verify that legacy local admin page; the website `/admin` is retained.

The optional legacy dashboard has since been retired: its assets, local listener
and dashboard-only `/api/*` handlers are removed. The supported website `/admin`,
website APIs and Core `/v1/*` bridge remain. See [release notes](../CHANGELOG.md).
