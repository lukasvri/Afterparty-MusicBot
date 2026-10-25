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
