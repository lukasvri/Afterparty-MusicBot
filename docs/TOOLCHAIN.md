# Approved development toolchain

Owner decision: 22 October 2026. This document selects **preferred tools and
architecture**, not a claim that a migration, installation or deployment has
already happened. Check current GitHub code, supported tool versions, CI and
official compatibility documentation before implementing each change.

## Afterparty: current source vs. target

| Area | Verified existing source | Preferred direction | Implementation gate |
| --- | --- | --- | --- |
| Website framework | React 19, Next.js 16, Vinext/Vite | **SvelteKit 3 + Svelte 5** for an alpha redesign | Prove Cloudflare Workers/D1, OAuth/session, API and real-time contracts before switching; compare measured baseline |
| Website language | TypeScript 5.9 | TypeScript 6 where framework/build/plugin support is verified | Do not force a toolchain upgrade that breaks CI or Cloudflare |
| Website styling | Tailwind CSS 4 | Keep Tailwind 4 only when it improves design-system consistency | Preserve Afterparty black/red identity and accessibility; avoid duplicate styling systems |
| Database/API | Drizzle ORM, Cloudflare tooling | Retain Drizzle for applicable database access, Workers and D1 for website hosting | Validate bindings, schema changes and authorization without touching production |
| Core/audio | Node.js 24, TypeScript, discord.js, FFmpeg | Evaluate Node.js 26 for the next LTS baseline while keeping the working Core stable | Test build, dependencies, native audio paths and recovery before any Node/Docker production change; protect guild/room isolation, persistence, queue revisions and playback clock |
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

The repository includes an isolated SvelteKit 3/Svelte 5/TypeScript 6 listening-room
candidate in `apps/web/`. See [the migration guide](SVELTEKIT_MIGRATION.md) for its
locked versions, service-binding/D1 boundary, local verification and limitations.
The existing website and Core remain the release baseline.

| Tool | Project rule | Adoption state |
| --- | --- | --- |
| GitHub, pull requests, GitHub Actions | All changes live in GitHub; CI checks every review candidate. Use separate branches and draft PRs. | Already part of workflow |
| Codex and supported subagents | Preferred for implementation, investigation, executable tests and review when actually available. Report real model/tool availability. | Conditional on the connected environment; not guaranteed by documentation |
| Playwright | Use targeted desktop/mobile browser suites for user journeys, room synchronization, playback controls, search, admin and permissions. | Already in website dependencies and test scripts |
| Node.js built-in tests | Retain current unit/integration suites until the migration justifies changing them. | Already used |
| Vitest | Preferred for new Svelte component/unit tests when it gives useful framework integration. Do not replace all existing tests or add it before needed. | **Not yet adopted** |
| Vite | Use the toolchain integrated with the chosen framework. | Used by the Vinext baseline and the isolated SvelteKit candidate; no production cutover |
| ESLint | Retain existing checks and zero-warning discipline. | Already configured |
| Prettier | Scope formatting to the new Svelte candidate with the Svelte plugin. | Adopted in `apps/web/` only; legacy formatting remains unchanged |
| Wrangler and Cloudflare | Validate the actual target Workers/D1 build locally in isolation; do not enable deployment or modify secrets/DNS. | Cloudflare tooling already present; production cutover not established |
| Drizzle ORM | Retain typed schema/data access where already suitable. Test migrations against synthetic data only. | Already present |
| Node.js runtime | **Node 26** is the preferred next LTS target; **Node 24** stays the proven production fallback. Node 26 enters LTS on 28 October 2026, subject to schedule changes. | Use Node 26 in the existing **website CI validation job** for early compatibility feedback. The Core Dockerfile and host runtime stay on Node 24 until tested and separately approved. |

Practical standards:

1. Fetch latest `main`, preserve existing work and follow `AGENTS.md`.
2. Diagnose and measure first; prefer stable, supported dependency versions over
   speculative upgrades. Avoid adding a framework or test runner without a
   specific benefit.
3. Design, implement and test a vertical slice of the SvelteKit frontend before
   attempting a wholesale cutover. Validate D1, authorization, public/private
   server data boundaries, shared playback state, mobile accessibility and the
   Cloudflare target build.
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

1. **Now:** Run existing website GitHub CI on Node 26 in a review branch,
   without adding an extra job. Preserve the Node 24 baseline for Core and
   local/production operation. This only tests the website source and tools.
2. **Before switching Core:** Test a Node 26 Core build and the required
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
