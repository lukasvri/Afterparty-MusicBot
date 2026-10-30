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
| Core/audio | Source candidate: immutable Node.js 26.13.0 LTS, TypeScript 6, discord.js and FFmpeg | Complete installed-host acceptance in #117 | Source qualification is separate from installed hosts; preserve isolation, queue revisions, explicit intent and clock |
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
| Knip | Review unused module files with explicit framework, manual test and operational entry points. | Pinned at 6.44.0; `npm run audit:unused` runs in local checks and CI. Findings require source verification before deletion. |
| Prettier | Scope formatting to the new Svelte candidate with the Svelte plugin. | Adopted in `apps/web/` only; legacy formatting remains unchanged |
| Wrangler and Cloudflare | Validate the actual target Workers/D1 build locally in isolation; do not enable deployment or modify secrets/DNS. | Cloudflare tooling already present; production cutover not established |
| Drizzle ORM | Retain typed schema/data access where already suitable. Test migrations against synthetic data only. | Already present |
| Node.js runtime | **Node 26.13.0 Lithium** entered LTS on 28 October 2026; **Node 24** remains the recorded fallback baseline. | Website CI uses Node 26. The Core source candidate pins qualified immutable Node 26.13.0. Installed-host runtime acceptance remains separate and open in #117. |

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

## Local Worker preview stability

The website pins Wrangler 4.156.0 in `apps/web/package.json` and its lockfile.
This includes the upstream transient-request dev-server fix from 4.129.1 and the
original-cause error reporting fix from 4.132.0. The SvelteKit adapter peer range
remains satisfied. See the [CI investigation](OPTIMIZATION_REVIEW.md#consolidated-checks-and-conservative-browser-scope-2026-10-26)
for evidence and the distinct package-download bottleneck. This tooling update
is separate from application-framework or production-host runtime promotion.

## Compatible toolchain refresh, 30 October 2026

The maintained source candidate updates the three locked dependency trees,
including SvelteKit 3.1.1, Svelte 5.57.3, the Cloudflare adapter 8.0.2,
Wrangler 4.156.0, Playwright 1.64.1, ESLint 10.14.0,
typescript-eslint 8.72.1, Knip 6.44.0, Sentry 11.10.0 and Drizzle ORM 0.45.4.
Core's extractor pin advances to yt-dlp 2026.10.26. Exact direct and transitive
versions remain recorded in the package manifests and lockfiles.

Registry metadata establishes these compatibility limits:

- TypeScript stays at 6.0.3. The latest 7.0.2 is outside
  typescript-eslint 8.72.1's supported `>=4.8.4 <6.1.0` peer range and
  SvelteKit 3.1.1's `^6.0.0` peer range.
- Node type definitions use 24.19.2 across all trees to retain the recorded
  Node 24 fallback API floor. This does not change Core's Node 26.13.0 base.
- Miniflare uses 5.20261023.3-beta, the exact dependency selected by stable
  Wrangler 4.156.0. Its older `latest` dist-tag is not a reason to downgrade
  that matched runtime. Existing direct Worker fixtures use the SDK's exported
  `convertV4MiniflareOptions` adapter, preserving outbound restrictions and D1.
- The 11 existing versioned third-party GitHub Action pins already match their
  latest release revisions at this check and are unchanged.

Primary package metadata: [SvelteKit](https://registry.npmjs.org/@sveltejs%2fkit/3.1.1),
[typescript-eslint](https://registry.npmjs.org/typescript-eslint/8.72.1),
[Wrangler](https://registry.npmjs.org/wrangler/4.156.0),
[TypeScript](https://registry.npmjs.org/typescript), and
[yt-dlp](https://pypi.org/pypi/yt-dlp/2026.10.26/json).

Local `npm run check:all` passes: lint, unused-file audit, strict types,
107 Python, 237 shared/Worker, 801 Core with real FFmpeg, 185 native web tests,
formatting and production build/Worker dry-run. All 108 browser cases,
eight startup scenarios and two isolated real Worker/D1 stack cases pass.
Browser checks use system Chromium through the updated Playwright SDK;
the matching bundled browser download is unavailable under this environment's
network policy. Published CI must verify that browser separately.

`npm audit` reports no findings for root or Core. The web tree reports four
low-severity package entries for the same unpatched transitive `deepmerge` 4.3.1
advisory through the Svelte build plugin, Kit and adapter:
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
Registry and advisory metadata expose no patched release. The suggested ancient
framework downgrade is not applied, and the advisory is not suppressed.
Actual exploitability in Afterparty has not been established.

A clean tracked-source `linux/amd64` image of `d544111` passes strict types and
all 801 Core tests. Its final unprivileged UID 1000 process passes source/license
readability, voice imports, ESM worker and FFmpeg probes with no network and a
read-only filesystem. yt-dlp reports 2026.10.26. The existing offline audio probe
passes at 1, 4 and 8 generated streams with 701 Opus packets per stream under
1.5 CPUs and 768 MiB; it is unpaced compute, not live listening or host capacity.
[Distinct source/image identities and raw probe results](assets/toolchain-qualification-20261030.json)
record the limits, temporary CA-secret build adaptation and initial full-disk
build failure followed by a successful rebuild. Saved-archive packaging is not
repeated for this refreshed graph.

The earlier Node LTS image evidence below belongs to its recorded source and
lockfile. It must not be reused as proof of this refreshed extractor/dependency
graph. No host, production data, real account, publication or deployment is
changed by this local source refresh.

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
   26.13.0 LTS image. Node 24 remains a recorded compatibility/recovery baseline.
   Source changes do not update any installed host.
2. **Before switching an installed Core:** Test the Node 26 build and required
   synthetic FFmpeg, transport, recovery, queue and audio suites. Validate
   the exact Node 26 Docker base image digest and dependencies.
3. **Before a real LTS runtime switch:** Reconfirm supported Cloudflare tooling and
   production host availability. Switch any real deployment only after
   owner approval, compatible CI/host validation and a rollback plan.
4. A successful Node 26 CI workflow is not evidence that a website has
   been published or that audible Discord playback was tested.

### Core LTS qualification evidence, 30 October 2026

Tracking: [issue #117](https://github.com/lukasvri/Afterparty-MusicBot/issues/117).
The [official distribution index](https://nodejs.org/dist/index.json) identifies
Node **v26.13.0**, dated 28 October 2026, as LTS **Lithium**. Its `security: false`
field classifies that release; it is not a vulnerability assessment. Node 26 is
in active LTS, with maintenance scheduled from 20 October 2027 and support ending
30 April 2029 in the [official schedule](https://github.com/nodejs/Release/blob/main/schedule.json).

Candidate `8f1a83c34bd76fa35e0999104d0060586a261318`, based on main
`231317df27c6c6bb82cfc0d3364d0e3084a943f8`, changes only the Core Docker base:

```text
node:26.13.0-bookworm-slim@sha256:cd820d60a7f3ae057389f3e1bcf1a0ac09dd57c428fe14f191dcbc5c56ac5fe2
```

That exact official manifest was pulled and inspected as `linux/amd64`. A
network-disabled base probe confirms v26.13.0, `lts: Lithium`, module ABI 147 and
OpenSSL 3.5.9. The locked application dependencies and application/test source are
unchanged. A comparison against `40209466047ee9b8877665a8445b899f3131a75c`
confirms identical Core application, tests, package/lock and TypeScript config;
its previously recorded 801-test Node 24.19.0 baseline is reused, not relabelled
as a new run.

The clean tracked-source build passes strict types and all **801 Core tests**
with real FFmpeg, no failures or skips. The final unprivileged image also passes
its existing `guess-pack --list` build check. Its image-specific offline runtime
probe passes at UID 1000 with a read-only filesystem, no network, one CPU,
256 MiB memory and 64 processes: source/license/package readability, Discord
voice and prism imports, TypeScript data-import loading, an ESM worker and
FFmpeg **5.1.9-0+deb12u1**. No build CA mount remains in that runtime.

The existing offline audio probe passes with 1, 4 and 8 independent generated
PCM/mixer/Opus streams, each producing 701 packets for 14 seconds of audio.
It runs with no network, read-only root, a 128 MiB temporary filesystem,
1.5 CPUs, 768 MiB memory and a 512-process limit. This is unpaced synthetic
computation; it does not establish live Discord capacity or audible continuity.

Qualification identity:

- Final image: `sha256:cb8e7b28cd4e5ba90eef22be2410d2ee983e6566ce0298d053afe2835d370bfe`.
- Core source tree: `e47186dfea8ffe7a47407fecc4951e9ae4caf27a`.
- Canonical Dockerfile SHA-256: `f1087984f7d94bb46eeb572b640c14170b2cf57ea018c549401a4462e61c7f05`.
- Temporary qualification Dockerfile SHA-256: `f95dcfef2e3c76ca296484d9472c802bbf1eb67ab693a86593e5c4edf03f94d4`.

The existing `scripts/build_release.py core-package` operation passes its
unprivileged runtime probe and validates the saved image archive. The unsigned
local archive is 322,890,076 bytes with SHA-256
`f5f3e94ce1cc949bb316516f42908b79ad602ffe973bd3b07439ba3ff7c11d34`.
All 27 existing release-artifact contract tests and repository lint pass.
[Qualification metadata and offline probe results](assets/node26-lts-qualification-20261030.json)
record the exact identities and measurement limits. The archive itself is not
committed, published or supplied to an installed host.

The temporary variant adds only session CA secret mounts and tool-specific trust
settings to networked build steps. It does not copy the CA into layers or change
the canonical source's build/network configuration. The image label records this
variant separately; it is an unsigned local qualification image, not a production
release. Public application and license files stay readable and root-owned, with
the existing unprivileged user and data directory behavior preserved.

The [prepared host qualification plan](HOST_READINESS.md#qualifying-a-core-runtime-change)
still requires separate owner-approved installed-host, backup/rollback, staging
and actual listening evidence. This source qualification does not update any
installed host or close #117. Earlier qualification evidence is retained below.

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
BuildKit secret mounts, never copied into image layers. At qualification time, the
production source Dockerfile retained its pinned Node 24 base; the native-only
source now pins Node 26 as described above. This local experimental image is not a signed
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
