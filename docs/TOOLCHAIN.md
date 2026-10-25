# Approved development toolchain

Owner decision: 22 October 2026. This document selects **preferred tools and
architecture**, not a claim that a migration, installation or deployment has
already happened. Check current GitHub code, supported tool versions, CI and
official compatibility documentation before implementing each change.

## Afterparty: current source vs. target

| Area | Verified existing source | Preferred direction | Implementation gate |
| --- | --- | --- | --- |
| Website framework | **SvelteKit 3 + Svelte 5**, sole native website | Maintain the native implementation | Classic and React/Next/Vinext have been retired at the owner’s request; preserve API/data/security contracts |
| Website/Core source language | **TypeScript 6.0.3** | One supported compiler generation across the project | Validate strict types, native Worker and Core audio/recovery |
| Website styling | Native Svelte component CSS | Maintain one design system | Preserve Afterparty black/red identity, accessibility and touch targets |
| Database/API | Drizzle ORM, Cloudflare tooling | Retain Drizzle for applicable database access, Workers and D1 for website hosting | Validate bindings, schema changes and authorization without touching production |
| Core/audio | Source image: immutable Node.js 26.12.1, TypeScript 6, discord.js and FFmpeg | Complete actual LTS/host acceptance in #117 | Source qualification is separate from installed hosts; preserve isolation, queue revisions, explicit intent and clock |
| Other service languages | Existing Core is TypeScript | Consider Go for independent APIs, Rust for measured low-level work, Python for automation/AI | Choose per workload, interoperability, hosting and test evidence; paused Rust work is not resumed by this decision |

SvelteKit 3 was released on 1 October 2026. Its selection is an **approved
preferred direction for evaluation and implementation**, not a completed port.
The detailed alpha scope and acceptance criteria remain in
[issue #114](https://github.com/lukasvri/Afterparty-MusicBot/issues/114).
A large rewrite is allowed but must not silently remove important capabilities.
Reuse tested framework-independent logic when practical. OpenWorks is separate:
its Astro/Svelte portal should not be merged into Afterparty or used as a
reason to add Astro to this application's runtime.

## Developer workflow and testing

The repository includes an SvelteKit 3/Svelte 5/TypeScript 6 website
in `apps/web/`. See [the migration guide](SVELTEKIT_MIGRATION.md) for its
locked versions, service-binding/D1 boundary, local verification and limitations.
The native website is the sole source implementation. Installed revisions and runtime promotion remain separately verified operator decisions.

| Tool | Project rule | Adoption state |
| --- | --- | --- |
| GitHub, pull requests, GitHub Actions | All changes live in GitHub; CI checks every review candidate. Use separate branches and draft PRs. | Already part of workflow |
| Codex and supported subagents | Preferred for implementation, investigation, executable tests and review when actually available. Report real model/tool availability. | Conditional on the connected environment; not guaranteed by documentation |
| Playwright | Use targeted desktop/mobile browser suites for user journeys, room synchronization, playback controls, search, admin and permissions. | Already in website dependencies and test scripts |
| Node.js built-in tests | Retain current unit/integration suites until the migration justifies changing them. | Already used |
| Vitest | Preferred for new Svelte component/unit tests when it gives useful framework integration. Do not replace all existing tests or add it before needed. | **Not yet adopted** |
| Vite | Use the toolchain integrated with the chosen framework. | Used by the sole native SvelteKit build; no production cutover is implied |
| ESLint | Retain existing checks and zero-warning discipline. | Already configured |
| Knip | Review unused module files with explicit framework, manual test and operational entry points. | Pinned at 6.43.0; `npm run audit:unused` runs in local checks and CI. Findings require source verification before deletion. |
| Prettier | Scope formatting to the new Svelte candidate with the Svelte plugin. | Adopted in `apps/web/` only; legacy formatting remains unchanged |
| Wrangler and Cloudflare | Validate the actual target Workers/D1 build locally in isolation; do not enable deployment or modify secrets/DNS. | Cloudflare tooling already present; production cutover not established |
| Drizzle ORM | Retain typed schema/data access where already suitable. Test migrations against synthetic data only. | Already present |
| Node.js runtime | **Node 26** is the preferred next LTS target; **Node 24** stays the proven production fallback. Node 26 enters LTS on 28 October 2026, subject to schedule changes. | Use Node 26 in the existing **website CI validation job** for early compatibility feedback. The Core source Dockerfile targets qualified immutable Node 26.12.1. Installed hosts remain unchanged until separately approved updates; actual LTS confirmation is still open. |

Practical standards:

1. Fetch latest `main`, preserve existing work and follow `AGENTS.md`.
2. Diagnose and measure first; prefer stable, supported dependency versions over
   speculative upgrades. Avoid adding a framework or test runner without a
   specific benefit.
3. Maintain the sole native SvelteKit frontend. Validate D1, authorization,
   public/private server boundaries, shared playback state, mobile accessibility
   and the packaged Cloudflare build after each substantive change.
4. Keep operational Core stable. Use `npm run setup:cloud` and
   `npm run check:all`, plus relevant existing Playwright scripts and new
   framework-specific tests when introduced.
5. Measure real before/after user experience and bundle/runtime metrics; use
   the same scenarios and record limitations. A framework switch cannot by
   itself repair provider search availability or Discord audio.
6. Record every actual technical change in GitHub. Public
   `/patch-notes` contains only implemented, user-relevant product changes
   under `docs/RELEASING.md`.
7. Require explicit approval for merge, auto-merge, publication, production
   deployments, access/secrets/DNS changes, destructive work or costs.

## Official website addresses

- OpenWorks project portal: **https://openworks.no**
- Afterparty website: **https://ap.openworks.no** (owner-confirmed canonical
  address on 22 October 2026). Update website links and documentation; the
  actual live host, DNS, SSL certificate, OAuth callback registration and
  deployed commit are not independently verified here. Domain configuration,
  redirects and secret/origin changes still need separate approval and safe
  testing.

## Node 26 compatibility rollout

1. **Source candidate:** Website CI uses Node 26, all maintained TypeScript
   projects use compiler 6.0.3 and Core targets the qualified immutable Node
   26.12.1 image. Node 24 remains a recorded compatibility/recovery baseline.
   Source changes do not update any installed host.
2. **Before switching an installed Core:** Test the Node 26 build and required
   synthetic FFmpeg, transport, recovery, queue and audio suites. Validate
   the exact Node 26 Docker base image digest and dependencies.
3. **When LTS is available:** Reconfirm supported Cloudflare tooling and
   production host availability. Switch any real deployment only after
   owner approval, compatible CI/host validation and a rollback plan.
4. A successful Node 26 CI workflow is not evidence that a website has
   been published or that audible Discord playback was tested.

### Core qualification evidence, 24 October 2026

Tracking: [issue #117](https://github.com/lukasvri/Afterparty-MusicBot/issues/117).
The Core application source in main `d9d38ee51530cd577d5d8279aab00f38f3ebd31c`
is unchanged from the earlier tested `7cd059c` baseline, product `3.0.0-alpha.1`.
Qualification uses a clean archive of tracked Core files, excluding local
credentials, databases and installed dependencies. Dependencies are installed
from the existing lockfile with the Docker stage's flags:
`npm ci --omit=peer --ignore-scripts --no-audit --no-fund`.

| Check | Node 24.19.0 baseline | Node 26.12.1 qualification |
| --- | --- | --- |
| Platform | Linux x64 | Linux x64, container `linux/amd64` |
| Node module ABI / OpenSSL | 137 / 3.5.7 | 147 / 3.5.9 |
| Clean locked dependency install and strict typecheck | Passed | Passed |
| Core unit, HTTP, isolation, recovery and audio tests | 741 passed | 741 passed locally and 741 in the actual image validation stage; none failed or skipped |
| FFmpeg | Real local synthetic audio | Local FFmpeg 7.1.5 and image FFmpeg 5.1.9 |
| Final image probes | Existing Node 24 CI | UID 1000, readable source/package, Discord voice imports, ESM worker and FFmpeg pass with read-only filesystem and no network |

The Node 24 source baseline is full local validation of code head `6b8c9ee`,
whose Core source tree matches the commits above. Its documentation follow-up
passed Node 24 Docker validation in
[GitHub run 40129899214](https://github.com/lukasvri/Afterparty-MusicBot/actions/runs/40129899214).
Core executes TypeScript directly and has no separate application compilation step.

The verified Node 26 `linux/amd64` base is
`node:26.12.1-bookworm-slim@sha256:1884ec272c7c06aba7696262fb822dc602f8fa5eb978d03617d6bfe487d7ebac`.
The qualification image follows the canonical multi-stage Dockerfile with that
base substituted in a temporary copy. Cloud proxy trust is supplied through
BuildKit secret mounts, never copied into image layers. The production Dockerfile
retains its pinned Node 24 base. This local experimental image is not a signed
production release and is not published or deployed.

The final local image also passed the existing read-only runtime probe and
saved-archive validation in `scripts/build_release.py core-package`. Its image ID
was `sha256:361389159ecc7830f10f1f6f4a1826a354afd869b698fc77a10eebbc98d78e05`.
The temporary qualification Dockerfile SHA-256 was
`dbbac4c7261b2564ae3c1206585256e402f820ea3e2d7ce13f1b876d51ee10b9`. The variant is
identified separately from the canonical Node 24 release image.

The restrictive-umask reproduction used 0600 source files and 0700 directories.
The first image passed all 741 tests as root but failed its final unprivileged
`guess-pack --list` check because package.json was unreadable. The Dockerfile now
normalizes public `/app` read/traverse permissions while keeping root ownership
and the existing unprivileged runtime user. The same reproduction then passes
both that CLI check and the final runtime probes. No stored data permissions or
host configuration are changed.

To reproduce the source suite, select Node 26.12.1 in an isolated checkout,
verify `node --version`, then run:

```sh
npm --prefix services/core ci --omit=peer --ignore-scripts --no-audit --no-fund
npm --prefix services/core run check
npm --prefix services/core test
```

For image qualification, use only tracked Core files, substitute the immutable
base above in a temporary Dockerfile, and build `--platform linux/amd64
--target final`. Retain the validation stage and final unprivileged CLI check.
Run the existing `scripts/build_release.py core-package` locally against the
tested image to probe its runtime and validate the saved archive; do not run its
publication operations. Labels and local qualification metadata must identify
the tested source and record the temporary base/Dockerfile variant.

The official [Node distribution index](https://nodejs.org/dist/index.json)
reported v26.12.1 dated 21 October 2026, `security: true` and `lts: false` at this
check. LTS qualification cannot be marked complete before the actual transition.
Remaining gates: reconfirm LTS/security support after the scheduled 28 October
transition, execute the prepared [host staging/backup/rollback plan](HOST_READINESS.md#qualifying-a-core-runtime-change)
and separately authorize live listening and any runtime switch. No real Discord account, provider recording,
production data, deployment or restart was used. Node 24 remains the operational
Core runtime baseline.

## Technology choices for other projects

For new independent projects, evaluate Go, Rust, Python, TypeScript or other
suitable maintained languages based on real workload and required libraries.
OpenWorks, at https://openworks.no according to the owner, uses Astro 7,
Svelte 5, TypeScript 6, selectively loaded Three.js and local CSS in its
repository. That static-islands approach should remain separate from
Afterparty's interactive application. Site URL alone does not verify the
currently deployed source commit.

## Evidence and limits

- Source check performed on 22 October 2026 against GitHub `main`:
  `package.json`, `services/core/package.json`, related existing tests and
  project guidance.
- [SvelteKit 3 official release](https://svelte.dev/blog/sveltekit-3-is-here).
- [Node.js release status](https://nodejs.org/en/about/previous-releases).
- This file is **documentation only**. It does not install dependencies,
  update lockfiles, run tests, migrate the website or alter production.

## Startup verification

Use the existing Playwright browser and Vite production manifest for repeatable
[local startup payload measurements](FRONTEND_PERFORMANCE.md). The check verifies
that the library loads on demand. These observations are not production timing
or full-application performance claims.
