# Non-Activity concert extras acceptance

This checklist covers the focused non-Activity v3 source candidate targeting `main`,
preserving the merged player/error and channel-boundary fixes from PR #84 and
FIFO queue fixes from PR #83. It does not
approve production installation, public launch, a Discord Activity, or a stable
release. The source deliberately excludes Discord Activity code. Website and Core must
be reviewed and installed together in a separately
authorized test environment. Radio and logo changes retain their own review gates.

## Automated source gates

Record final commit and CI links in the PR after completing all checks. A prior candidate check does not satisfy the final source gate.

| Gate | Required evidence |
| --- | --- |
| Reproducible source | Fresh canonical `main`, preserved PR #83/#84 changes, clean final source commit |
| Installation and checks | `npm run setup:cloud`, `npm run check:all`, exact-head GitHub CI |
| Authority and isolation | Cross-room/guild rejection, verified member/host roles, no owner-recovery bypass |
| Host safety | Separate bounded moderation reserve, disable/remove/stop behavior, durable replay protection |
| Abuse and capacity | Malformed/oversized/spam rejection, unauthorized requests cannot drain authorized social allowance, playback peer protection retained |
| Lifecycle | Canceled authentication cannot leak streams; bounded leases, reconnect snapshots, no automatic replay of writes |
| Client safety | Offline/auth failure disables controls; stale/wrong-scope frames ignored; reopening reauthenticates |
| Playback independence | Social actions preserve playback/queue revisions and do not send pause, seek or queue commands |
| Usability | English/Norwegian copy, keyboard focus, mobile overflow, reduced motion, disabled/error feedback |
| Regression | Social, party, queue, sync, video-start, TV, website design and affected administration browser suites |
| Review material | Desktop/mobile screenshots, rendered prerelease notes and latest-release link, independent review |

## Authorized environment gates still outstanding

The automated suite uses synthetic accounts, rooms and streams. It does not
establish these results:

- Human listening in real Discord voice while multiple clients react, add
  highlights and mark bingo; no audible dropout or clock regression.
- At least two independently authorized guilds and a private room exercised
  concurrently, including revoked roles, expired sign-in and reconnects.
- Representative network loss, Core restart, database backup/restore and matching
  website/Core rollback on the intended host, with active playback protected.
- A representative audience/load rehearsal behind the actual proxy. Core still
  limits shared socket peers to 600 requests/minute; arbitrary forwarding headers
  are not trusted. Synthetic ceilings are not production capacity guarantees.
- Remaining public-live acceptance in [issue #37](https://github.com/lukasvri/Afterparty-MusicBot/issues/37), music rights/licensing and operator launch approval.

These gates require separate authorization and suitable test participants. They
remain open even when a prerelease source candidate passes automated checks.
Do not merge, publish or deploy solely because the source carries a prerelease label.

## Separately authorized manual session

In the authorized test environment, open the same concert as host and guest on
desktop and mobile. Open Games & extras and choose each extra separately. Use keyboard Back and Close,
verify focus returns correctly, then reopen. Send reactions; create, mark and
end a nine-cell card; save and remove timestamp highlights. Verify guests cannot
moderate and external timestamp links leave the shared playback clock unchanged.
Disable extras and verify every client updates. Disconnect a client, change
concerts, reconnect and verify only the current concert snapshot appears with no
replayed actions. Repeat after revoking host access. Observe actual audio and
record failures, browser/device, build SHA and scope without recording secrets or
personal identifiers in the public PR.

The shared bingo card is manually called by the host. Highlights are text and
links, not recordings. Optional concert extras are unavailable without matching Core;
the website-only private-room fallback is not a second social authority.
