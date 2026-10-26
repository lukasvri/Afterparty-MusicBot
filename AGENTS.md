# Working on Afterparty

This repository is the source of truth for the website and Core. Write public
documentation in English and owner-facing updates in Norwegian Bokmål. Do not
use em dashes. Keep global personal preferences out of repository instructions.

## Source freshness

- Before every new requested code change, fetch the canonical GitHub repository
  and verify that the working branch includes its latest `main`. Do this before
  reviewing or editing code. A cached checkout or existing `origin/main` is not
  evidence that the source is current.
- Preserve local work when updating the base. Do not reset or discard changes.
  Integrate the latest source, resolve conflicts and validate the combined result.
- Recheck upstream before submitting a pull request. If `main` moved during the
  task, incorporate it and rerun checks affected by the new changes.

## Development and validation

- Use Node.js 24.17+, Python 3.11+ and FFmpeg. `npm run setup:cloud` installs the
  locked website, Core and isolated `apps/web` candidate dependency trees.
  `npm run check:all` runs lint with zero warnings,
  recovery and application tests, both typechecks, Core audio tests with real
  FFmpeg, and the website production build. It also checks formatting/types,
  tests and builds the SvelteKit candidate; see `docs/SVELTEKIT_MIGRATION.md`.
  Separate Playwright browser suites
  are not included; run relevant browser suites for UI/playback changes. Docker
  is not required for these checks. For internal documentation-only edits,
  verify links and the diff without running the full application suite.
- Core lives in `services/core/src/`; the website is in `app/`, `components/`,
  `hooks/` and `lib/`; the opt-in SvelteKit candidate is in `apps/web/`.
  Preserve third-party license notices.
- Keep changes focused and report the checks actually run and any limitations.
- Preserve per-server queues, settings, permissions and databases. Owner access
  must not grant access to another server.
- Ordinary Discord music stays out of the public concert feed. Preserve queue
  revisions, stale-command protection and the shared playback clock.
- Use synthetic credentials and isolated temporary data in tests. Automated
  audio tests do not establish what a person hears in a Discord voice channel.

## Creative authority for the private alpha

- Within an authorized alpha website goal, independently redesign screens,
  navigation, layouts and related usability flows. Existing UI/screenshots are
  a starting point; significant redesigns need no pixel-perfect parity. Preserve
  the Afterparty name, canonical logo and black/red identity; full rebranding
  requires an owner decision. Aim for distinctive, professional, accessible,
  responsive design, readable mobile UI, useful motion and measured performance.
- Avoid feature bloat and unrelated scope. Put substantial independent ideas in
  GitHub issues, split risky changes into draft PRs, explain major tradeoffs and
  verify relevant journeys through tests and visual review.
- Preserve authorization, persistence, privacy, queues, music and shared playback
  outcomes, or document and test an intentional migration with rollback.
  Cloud development uses no production systems or live data.
- Authority covers investigation, source edits, refactoring, tests, docs,
  branches, commits, issues and draft PRs. Merge/auto-merge, publication,
  deployment, production/DNS/access/secrets changes, spending, destruction of
  important data and resuming paused Rust work require explicit owner approval.

## Keep every change organized

- Before adding a module, setting, type, validator or helper, find and extend its
  owner in the [source map](docs/ARCHITECTURE.md#source-map). Keep routes thin and
  related components, clients and helpers in their feature folder; reuse shared
  contracts and pure functions instead of parallel implementations.
- Shared settings, bounds, protocol types and validation need one canonical
  browser-safe definition across Core and the website variants in this checkout.
  Keep authorization, persistence and distinct UI lifecycles with their owners.
- Remove duplication/dead code introduced or exposed by the task only when callers
  and compatibility are understood. Preserve migrations, public entry points,
  rollback and recovery tools. Do not minify source or undertake unrelated rewrites.
- Update the source map when feature ownership changes; link existing guidance.
  Review placement, duplicate definitions, stale imports and dependencies. Run
  required checks, the existing unused-file audit and affected browser/contract
  tests. Record remaining structural limits and only verified cleanup in the PR.

## Technology decisions

- Choose technologies for measured product needs, operational reliability,
  security support and long-term maintenance rather than defaulting to
  JavaScript/TypeScript or always selecting the newest release. The existing
  TypeScript/Core stack remains supported while it is the sound choice.
- The alpha website may evaluate a substantial SvelteKit/Svelte 5 redesign
  under [issue #114](https://github.com/lukasvri/Afterparty-MusicBot/issues/114).
  Compare supported versions, Cloudflare/D1 compatibility, developer experience,
  testability and actual performance before adopting anything. Preserve critical
  authorization, persistence and playback contracts; do not restart paused Rust
  experiments or replace Core without a separate, justified decision.
- Independent new projects choose their own fit-for-purpose stack, which could
  include Rust, Go, Python, TypeScript or other actively maintained technologies.
  Do not copy Afterparty's stack merely by habit, or introduce trendy tooling
  without a useful, supportable reason. Document substantive architecture choices.

- Use the [approved toolchain guide](docs/TOOLCHAIN.md) as the starting
  configuration for Afterparty work. It distinguishes tools already present
  from migration targets and optional tools. Do not claim a migration or
  tool installation was completed just because it was approved.

## Codex allowance and efficient execution

- Default to one main agent. Use subagents only for meaningful independent
  parallel work, isolated context or review. Bound tasks and writes; the lead
  integrates and verifies. Avoid duplicate discovery, handoffs and reviews.
- Load Skills, tools and docs on demand. Reuse issues, evidence and valid checks.
  Handoffs need repository/ref, problem, outcome, constraints, paths, acceptance
  criteria and focused checks, not copied instructions or project history.
- Deliver reviewable vertical slices. Run focused tests first; retain meaningful
  regressions/review and required full/browser/security checks before code PRs.
  Internal docs need diff/link checks. Rerun when changes or failures justify it.
- Optimize verified quality per token without sacrificing correctness, security,
  accessibility, playback/data integrity or maintainability.
- Prefer lightweight models for trivial work, GPT-6.1 Sol Medium for ordinary
  coding and High for difficult debugging, architecture or migrations. Verify
  actual availability/settings. If usage is low, finish a useful verified slice
  and record remaining work. Do not guess quotas, promise fixed savings or spend
  API credits without approval.

## Delegation and review

- ChatGPT Chat coordinates requirements and owner dialogue; Codex handles code,
  executable tests and environment-specific debugging when needed. Resolve
  research, triage and simple GitHub/documentation actions with existing tools.
  Do not start another coding run merely to plan or repeat available analysis.
- Dot (Sjefen) is paused until an explicit owner decision; ChatGPT Work remains
  excluded. Check actual tools and permissions before delegating. The lead owns
  integration, validation, GitHub review follow-through and the final report.
- Report only agents and checks that actually ran. Ask for ambiguous goals or
  protected actions; delegation grants no merge, deployment or production rights.

## Code Review Rules

### Server isolation and authorization

- Flag changes that let a selected Discord server read or change another server's
  queues, settings, databases or private membership data. Authorization must be
  checked for the selected server; the owner's fallback access is limited to the
  owner's server. Public concert responses must exclude ordinary Discord music.

### Playback and recovery

- Flag changes that bypass queue revisions, stale-command checks or the shared
  playback clock, or resume audio after a user deliberately paused or changed it.
  Recovery must reconcile current user intent and preserve per-server state;
  synthetic tests alone are not evidence of audible Discord behavior.

### Production and release boundaries

- Flag new production deployment or restart side effects in PR validation,
  exposure of local secrets/data, or updates that bypass signed artifact checks,
  resource limits or recovery paths. Review code and fix proposals remain
  separate from owner-approved production operations. Do not request duplicate
  formatting, lint or type checks already enforced by CI.

## Release notes and pull requests

- Record **every actual change** in GitHub through descriptive commits and
  reviewable PRs, including internal fixes, refactors, dependency/security
  updates, tests, infrastructure and documentation. State what changed, what was
  verified and what remains uncertain. Do not invent implementation, tests or
  deployment claims.
- The website `/patch-notes` must contain **only truthful, user-relevant
  improvements or fixes actually implemented in the release candidate**, not
  development plans, housekeeping, dependency pins, CI changes, internal
  experiments or unshipped features. The page currently renders every entry
  from `lib/releases.json`, so audit every public bullet before adding it.
  A candidate or merged commit is not evidence of production deployment.
- Follow the canonical [release policy](docs/RELEASING.md#notes-for-every-change):
  record internal-only changes in the GitHub PR/commits, and reserve
  `lib/releases.json` and generated `CHANGELOG.md` for genuine product-release
  notes. Preserve existing history; never fabricate a version or change solely
  to populate the website. Confirm `/patch-notes` and latest-release links
  when preparing a user-facing release.
- Follow [branch strategy](CONTRIBUTING.md#branch-strategy): focused branches
  from refreshed `main` target `main`; isolated Rust branches target `dev`.
  Open a draft PR with actual checks, notes and limitations. Owner approval is
  required before merging, enabling auto-merge, publishing or deploying.

## Local production boundary

- Never commit or upload credentials, `.env`, `.dev.vars`, databases, backups,
  personal Discord IDs, private logs or deployment-specific hosting IDs.
- `services/core/compose.yml` and `.openai/hosting.json` are public templates.
  Existing hosts can select an ignored `services/core/compose.local.yml` through
  `core-control.sh`, and an ignored `.openai/hosting.local.json` for local builds.
  Preserve existing mounts and environment-file references on the deployment host.
- Cloud tasks edit and test source code only. Do not start the production bot,
  connect a real Discord account, access production data, deploy a website, or
  configure automatic deployment from a cloud task.
- Submit cloud changes on a separate branch for review. Production updates happen
  locally after validation, a complete backup and a check of active playback.
  Never use `docker compose down -v` during an update.

See [Cloud workflow](docs/CLOUD_DEVELOPMENT.md) and [operations](services/core/PUBLIC_RELEASE.md).

## Shared AI context

- For ChatGPT Chat coordination and Codex implementation, consult
  [shared project context](docs/AI_CONTEXT.md) and
  [AI collaboration workflow](docs/AI_WORKFLOW.md). The live repository and
  reviewed PRs, not assistant chat history, are the source of truth.
- Keep the context document to lasting, verified decisions. Use GitHub issues and PRs for current task progress. Never confuse merged code with production deployment.
