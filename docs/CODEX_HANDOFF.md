# Afterparty: Codex and GitHub handoff

[Documentation](README.md) · [Project context](AI_CONTEXT.md) · [Workflow](AI_WORKFLOW.md) · [Repository rules](../AGENTS.md)

Checkpoint: **20 October 2026, after the failed synthetic-game rollout and successful rollback**. Refresh GitHub and read host status before acting. This document records a dated state, not continuing monitoring or permission to deploy.

## Start here

The owner can work directly in **Codex + GitHub**. Chat is optional. Dot is paused and ChatGPT Work is not a dependency. Keep source, decisions, issues, PRs and verification in GitHub. Preserve all local work. New merge, publication, restart, important deletion, access/security changes and costs still need owner approval. The latest instruction stopped development and further rollout; this handoff is documentation only.

**Production is working on the previous stable version. Guess the Song is not currently live.** Do not redeploy current main or saved Sites version 65 unchanged: the actual public game-media request returned HTTP 500.

## Current source versus deployed state

| Item | Verified checkpoint |
| --- | --- |
| Repository | `lukasvri/Afterparty-MusicBot` |
| Main after workflow PR #89 | `c497fe5ce7a9ea22d760a880e31bd5463f66d97e` |
| Game merge, PR #88 | `5b78a1ffef7c571cf225aead34324647ddbd26c9` |
| Game source head | `497e5c639ca80030659ee47799833cd00177a010` |
| Tested local game head | `f687b2134410c2c3a31aa4c4ceca95a9d09e9e58` |
| Identical game source/merge tree | `ffd53997c3f5295de9f5c7a05ec8f389b91ded41` |
| Running Core after rollback | `191e14975218eee5b574d5bf563948ab1b8adc37`, image `gutta-krutt-core:git-191e14975218` |
| Core image ID | `sha256:2b57af4b9379ccb276a2f780a3b987d937aa4861aeea156d86f38e69cdfb67e3` |
| Running website | Sites version **64**, product **2.2.14** |
| Public URL | <https://afterparty.lukasvri.chatgpt.site> |
| Site ID, explicitly retained for this owner handoff | `appgprj_6ace49e681908191b8a1834b6e4cee06` |
| Stable Site source commit | `543b57d908ad14e02d947754a12a7fe32f8474f1` |
| Stable saved-version ID | `appgprj_6ace49e681908191b8a1834b6e4cee06~appgver_9ad2df1954908191b9064482bf015449` |
| Successful Site rollback deployment | `appgdep_6ad7d9950700819192c71038dad976b3` |
| Preserved candidate | Sites **65**, source `a5ff3d2bb50cb7a0319c68e5b9dbfd178b1344a9` |
| Candidate saved-version ID | `appgprj_6ace49e681908191b8a1834b6e4cee06~appgver_8dfb9c6b83988191bab4464039592ecb` |
| Candidate deployment, subsequently rolled back | `appgdep_6ad7d7a2f4088191a49fba500ea54ebc` |

PR #89 changed internal workflow documentation only; it did not fix the media failure or change production. This handoff makes direct Codex use explicit without requiring Chat. Do not confuse any of these source commits with the older deployed checkout or with the Sites repository's separate commit history.

## What happened and what is proved

PR #88 extracted only the independent game onto stable main. It excludes PR #85 reactions, highlights and bingo, Discord Activity routes/SDK/session changes and external music transport. This is an executable source boundary, not merely a documentation label.

The installed deployer's `--check` passed on game merge `5b78a1f`. Core update began at **21:04:59 UTC**; its full-data backup and startup checks succeeded at **21:05:11 UTC**. The new image was healthy, Discord-ready, had zero restarts and `GUESS_SYNTHETIC_TEST=1`. A bounded startup-log check found the normal ready message and no error lines. Sites 65 then returned deployment status `succeeded`. All 368 canonical source files matched the tested export, except the intentional existing Site identity/bindings manifest.

The actual public HTTPS/D1/Core path confirmed private-room creation, host lobby, an independent HTTP guest, two timed rounds/reveals and rejection of forged guest management with HTTP 403. The test room's queue and playback stayed unchanged. **The public media request failed with HTTP 500 and a generic error body. Live test audio, correct-answer scoring and audible listening were not established.** The guest was an independent HTTP client, not a second live browser; two-browser coverage below was local.

The rollout was therefore reversed: Site 64 was deployed successfully; original Compose and stable Core 191e1497 were restored. Core health returned `ready=true`, with no buffering or interruptions. The public home page again displayed 2.2.14 and no Games entry. The original Compose without the synthetic flag was restored; the old running image has no game bootstrap. Runtime environment values were not retrieved for an additional flag check. Deployer records were reconciled to the verified actual stable image, with candidate records retained privately. Own test clients were stopped. No other services were changed.

A missing incoming `Request.signal` was considered, but **not confirmed**. An isolated Miniflare test of `AbortSignal.any([request.signal, ...])` succeeded both with and without `enable_request_signal`. Do not call a compatibility-flag change a verified fix. The available Worker error-log window did not retain a matching media event. Do not publish raw request headers, visitor addresses, tokens or private logs while investigating.

## Validation that remains useful

- Final game `check:all`: **132 website, 467 Core, 56 Python tests**, zero-warning lint, both typechecks and production build passed on local `f687b21`, whose tree matches remote `497e5c6` and merge `5b78a1f`.
- [Game-head CI](https://github.com/lukasvri/Afterparty-MusicBot/actions/runs/39495429998) and [game-merge CI](https://github.com/lukasvri/Afterparty-MusicBot/actions/runs/39496166571) passed all Core, website and recovery jobs. These do not prove live media compatibility.
- Local native Chromium: original game suite passed; a second suite used real temporary Core, generated WAV, two browser contexts, five rounds, shared scores, host/guest checks and audio cleanup. Its website proxy and D1 authority were fixtures. The initial offline-container failure was corrected in the fixture, not production code.
- Party/TV/mobile and four sync browser cases passed on identical product code. Local patch notes and latest-release links matched all three canonical bullets at 390/1440 px in English and Bokmål.
- The complete deployment data archive was extracted into a private temporary directory and **five SQLite databases passed integrity checks**. Production data was not overwritten by this verification.
- Ordinary Discord listening, actual mobile autoplay, provider availability, public music rights, audience load and live scoring fairness remain unverified. No real provider music was enabled.

## PRs and branch dependencies

| PR | Checkpoint and implications |
| --- | --- |
| [#83](https://github.com/lukasvri/Afterparty-MusicBot/pull/83) | Merged FIFO correction. Ordinary adds append without discarding queued radio. Preserve it. |
| [#84](https://github.com/lukasvri/Afterparty-MusicBot/pull/84) | Merged player-error fix and stable/Activity boundary. Already included in stable 191e1497. |
| [#85](https://github.com/lukasvri/Afterparty-MusicBot/pull/85) | Open draft, `feature/v3-concert-extras`, head `e5f5150fd847e5824473c268b2e55a278631488a`, tree `de7ce29ddba5a70902501ae15383f76a5449b943`, 3.0.0-rc.1. Reactions/bookmarks/bingo, no Activity. Not deployed. [CI](https://github.com/lukasvri/Afterparty-MusicBot/actions/runs/39433312219). |
| [#87](https://github.com/lukasvri/Afterparty-MusicBot/pull/87) | Open draft, `feature/guess-song`, head `22892ed031ca3f86b8701298bd0f295e1dcd9302`, tree `a4b65b74ddf74d9481914f4002e8371696a21671`. Stacked on #85, 3.0.0-rc.2. Original gated provider experiment, not a production source. [CI](https://github.com/lukasvri/Afterparty-MusicBot/actions/runs/39488546613). |
| [#88](https://github.com/lukasvri/Afterparty-MusicBot/pull/88) | Merged independent synthetic-only extraction, 2.3.0-alpha.1. Public rollout failed and was rolled back. Not a dependency on #85/#87. |
| [#89](https://github.com/lukasvri/Afterparty-MusicBot/pull/89) | Merged workflow transition, merge `c497fe5ce7a9ea22d760a880e31bd5463f66d97e`. Documentation only. |

Refresh #85/#87 before any future integration. Main now contains a separate game implementation and a different prerelease line; a bulk merge can duplicate game code or conflict with release history. Neither PR is approved for a new merge by this handoff. Beta was `3394f2681cad6b34bcad94aadebb8f54d3a5de91`; the separate Activity test container still used `afterparty-activity-test:audio-beta7-4682efe` and was left untouched. Rust work remains paused.

## Audio and feature boundaries

`GUESS_SYNTHETIC_TEST=1` enables exactly five generated, fictional 30-second PCM tones. The default catalog is unavailable. The rollback disables the feature in production. Real provider music remains off; no playable licensed inventory was proved.

PR #87's experimental adapter accepts an exactly 30-second PCM envelope, but its strict measured ceiling can reject a nominal 30-second MP3 because of encoder padding. This was reproduced and documented, not solved by silently trimming or relabeling. Metadata matches and operator attestations do not prove music rights. Preserve private ordinary Discord playback and independent room/guild authorization in every follow-up.

## Local assets to preserve

`TASK2 = /home/lukasvri/Documents/Codex/2026-10-19/task-2`.

| Path below TASK2 | Local head / state |
| --- | --- |
| `afterparty-codex-handoff` | This documentation branch; based on refreshed main c497fe5. |
| `guess-synthetic-test` | `f687b2134410c2c3a31aa4c4ceca95a9d09e9e58`, clean. Tested extraction. |
| `v3-guess-game` | `907f51d653ace69791ff71c8f55bc495b05054fc`, clean. Tree matches PR #87. |
| `v3-concert-extras` | `ecdc9184b78e87cc2f89149c9de7881f9383175f`, clean local snapshot; remote #85 is newer. |
| `guess-synthetic-site-publish` | Sites source `a5ff3d2bb50cb7a0319c68e5b9dbfd178b1344a9`, clean. Never use its remote as GitHub origin. |
| `stable-queue` | `3597341ffd901f89c559fb89cafd58777f457480`, clean historical snapshot. |
| `stable-player-boundary` | `866d94d4c95b0879cb497d719c8a231c2e62c77e`, clean historical snapshot. |
| `activity-player-errors` | `464d085d1d0723d5f606947024f788818a4cd4c8`, clean historical snapshot. |
| `activity-room-reads` | `fa97d0e157ae22f12667287a552e9b151afb860a`, clean historical snapshot. |
| `beta7-site` | Sites source `e30dcb1dc0e94a7c14462d490bb97633d4ea8132`, clean historical snapshot. |
| `guess-model-work` | `866d94d4c95b0879cb497d719c8a231c2e62c77e`, **untracked prototype files exist** under `app/api/guess`, `hooks`, `lib`, `scripts` and Core source/tests. Do not clean or discard them. |

The earlier Activity asset remains clean at `/home/lukasvri/Documents/Codex/2026-10-19/task/afterparty-activity-dev`, branch `fix/activity-independent-playback`, commit `6f8c23fedfd31abe342021279e79742c81aa0919`. Other preserved historical checkouts are `task/afterparty-test/source` (detached `de29415bad9396d4b17e931d7b672aad046533a4`) and `task/afterparty-beta` (`e9e75b4826ecb576ed5b1a85d3adc5720cf9bb34`).

The production source checkout `/home/lukasvri/Documents/ChatGPT/Musikk/gutta-krutt-afterparty` was clean but remained at old local head `8f8f5d707fc1451f549102aea03d1dbe4f8413f2`. **Do not deploy its working files.** The installed deployer fetches and exports canonical main without replacing that checkout.

Key local evidence below TASK2:

- `guess-synthetic-resume.json`, `guess-synthetic-live-incident.json`, `guess-synthetic-deploy-plan.json`, `guess-synthetic-upload-journal.json`.
- `guess-synthetic-check-all-final-fixed.log`, `guess-synthetic-setup-final.log`.
- `guess-synthetic-browser/{guess,party,sync,notes}.log` and `screenshots/`.
- `guess-synthetic-targeted/guess-synthetic.log` and `screenshots/`: successful real temporary Core/two-browser synthetic test.
- `guess-synthetic-live/`: bounded HTTP diagnostic helper and Request.signal probe, not a successful live-audio test.
- `v3-guess-audio-resume.json`, `v3-guess-audio-upload-journal.json`, `v3-guess-audio-check-all-exact-907f51d.log`, `v3-guess-audio-browser-retry/`, `v3-guess-audio-browser-final/`.
- `v3-guess-site-publish-audit.json`, `v3-guess-preview-access-audit.json`, original sanitized upload payloads and `guess-synthetic-site.tar.gz` are retained. Do not re-upload already verified game blobs/trees/commits.

Earlier Activity evidence is also retained under `task/afterparty-test/logs/`: `activity-independent-core-full-final.log`, `activity-independent-web-checks.log` and `activity-independent-build.log`. The sanitized `/tmp/afterparty-independent-upload.json` still existed at this checkpoint; temporary files are not durable backups. These historical logs do not validate current main.

These paths are a navigation map. Do not copy private operational files or raw logs into GitHub. Recheck status before reuse; not every directory is a worktree of the same Git database.

## Operations and rollback

Use [REMOTE_DEPLOY.md](REMOTE_DEPLOY.md), [Core operations](../services/core/PUBLIC_RELEASE.md) and the project's local `gutta-krutt` skill. The installed `~/.local/bin/deploy-core` handles **origin/main only**. Do not patch it, spoof refs, or deploy an arbitrary branch as a workaround.

The existing private deployment directory is `/home/lukasvri/Documents/ChatGPT/Musikk/.local/gutta-krutt/`; `compose.yml`, `deploy.json` and `deployment/` are operational state, not public templates. Referenced environment files and production data must remain in place. Never read or publish their secret values, `config/core.env`, credentials, databases or backups. Preserve existing loopback/Tailscale mappings and unrelated services.

Retained private backup paths:

- Full pre-candidate backup: `/home/lukasvri/Documents/ChatGPT/Musikk/backups/core-deployments/20261020T210459Z-5b78a1ffef7c`, including all data/guild databases, Compose and referenced environment files. Archive extraction and five database integrity checks passed.
- Original pre-flag Compose and preserved candidate deploy records: `/home/lukasvri/Documents/ChatGPT/Musikk/backups/core-deployments/pre-synthetic-20261020T210349Z/`.
- Earlier stable backup: `/home/lukasvri/Documents/ChatGPT/Musikk/backups/core-deployments/20261020T112721Z-191e14975218`.

Rollback used original Compose and the verified old image while retaining compatible current queue data; game changes introduced no Store/Engine schema migration. The complete data backup remains available. No production database was overwritten during rollback. Deployer `current.json` and `last-run.json` now describe the actual stable image; candidate records were saved beside the original Compose.

One short-lived, Site-repository-scoped credential was authorized and used only through hidden stdin to the official Sites helper. It was not saved and is no longer retained in task memory. No further credential, access, security or cost approval is implied. Sites 64 remains the known website rollback target; preserve 65 for investigation rather than retrying it unchanged.

## Schedules

The owner's daily **Afterparty stabilitetsrunde**, **06:00 Europe/Oslo**, was confirmed paused on 20 October: `is_enabled=false`, `next_run_time=null`. No replacement Codex or GitHub schedule was created. Any future schedule needs an explicit owner request; do not infer that an assistant is continuing overnight work.

## Prioritized next work, after a new owner request

1. Diagnose the **actual deployed media proxy's HTTP 500** in `app/api/guess/media/route.ts`, `lib/guess-server.ts`, `lib/core-server.ts` and the Worker request/runtime boundary. Capture minimal sanitized error evidence and add a real Worker/proxy integration case instead of relying only on fixtures. Preserve cancellation and authorization; do not weaken them as a workaround.
2. Prepare a focused fix on refreshed main, update canonical release notes if code changes, validate the final tree and open a draft PR. Obtain fresh approval before any additional main merge or live rollout. Do not re-enable the synthetic flag or deploy unchanged main meanwhile.
3. After approval, stage a verified Sites archive/version, use the existing deployer with full backup/rollback, then prove the real public flow with independently authorized clients, decoded generated audio, cancel/reconnect, answers and shared scores. A successful deployment status alone is insufficient.
4. Reconcile #85/#87 separately against current main and release history before considering their features. Keep real music off until catalog, provider and rights questions are resolved. Bounded catalog/cancellation work remains a separate scoped proposal, not permission to import the beta provider changes.

## Ready-to-paste Codex prompt

```text
Continue Afterparty directly in Codex and GitHub. Repository: lukasvri/Afterparty-MusicBot. Read AGENTS.md, docs/AI_CONTEXT.md, docs/AI_WORKFLOW.md and docs/CODEX_HANDOFF.md, refresh canonical main and preserve all local work. First confirm actual source/deployment state. Production was rolled back to Core191e1497 and Sites64 after /api/guess/media returned HTTP500; main contains the game and workflow commits. Diagnose that specific runtime/proxy failure using synthetic data and focused local evidence. Request.signal is an unconfirmed hypothesis, not an established fix. Do not redeploy unchanged main or version65, enable provider music, touch production secrets, resume Rust, or create schedules. Prepare a focused reviewed fix/draft PR with exact tests and remaining gaps. Merge, deployment, restart, new credentials/access/security changes, important deletion and costs require fresh explicit owner approval. Dot and Work are not dependencies; Chat is optional.
```
