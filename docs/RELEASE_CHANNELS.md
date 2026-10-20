# Stable bot and web releases, experimental Activities

[Documentation](README.md) · [Contributing](../CONTRIBUTING.md) · [Release policy](RELEASING.md)

`main` is the stable source for the ordinary Discord voice bot, concert website
and private browser rooms. `beta` retains the v3 experiments, including Discord
Activities. Updating stable bot/web code does not require promoting Activity code.
A branch, successful test or merged source is not proof of a deployed release.

## Source boundary

| Area | Stable main line | Experimental beta line |
| --- | --- | --- |
| Entry point | Normal website and browser rooms | Separate Activity entry and optional dedicated test launch root |
| Discord integration | Voice bot, concert controls, server-scoped administration | Embedded App SDK, Activity OAuth/session grants and instance participation |
| Playback | Voice engine and existing browser-room clock | Private Activity queue, listener audio and mapped nested YouTube player |
| Configuration | Existing bot/site configuration | Activity enable flags, test application/guild allowlist and dedicated host bindings |
| Acceptance | Applicable source tests and separately approved live checks | Additional real Discord video/audio, proxy, permission and fullscreen checks |

Stable patches should start from refreshed `main` and include only their code,
tests and patch notes. A bounded shared-player fix can be ported without copying
Activity routes, the SDK dependency, database session migrations or test settings.
Keep queue/revision, guild/session isolation and public-versus-private playback
contracts in each extraction. Do not merge all of `beta` to obtain one shared fix.

## Independent extraction criteria

- Queue admission/order and ordinary-player error handling can be tested against
  stable voice, browser-room and UI fixtures. They do not require an Activity session.
- Bounded catalog extraction and request cancellation are candidates for a focused
  stable port, with their own provider, process-cleanup and timeout regressions.
  Their existence on beta alone does not establish that main contains them.
- Concert reactions, social moderation and v3 UX need separate acceptance and scope.
- Activity authentication, private Activity rooms, media URL mappings, listener-only
  output and launch-root configuration remain experimental as a unit. A successful
  synthetic widget handshake does not establish working embedded Discord video/audio.

## Review and publishing

Use separate focused PRs for stable patches and experimental changes. Stacked
stable PRs may use the earlier patch branch as their temporary review base; after
that dependency is reviewed and merged, retarget the follow-up to refreshed main
and recheck versions, patch notes and affected tests. This does not authorize a merge.
Use patch versions for stable fixes, following the release policy. A cleanup or
channel boundary does not itself require a major version. Any merge, deployment,
restart or Portal/configuration change needs its own owner authorization.

Runtime credentials, environment files, databases and host-specific settings stay
on their existing hosts. This source policy does not migrate or update live services.
