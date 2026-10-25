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
  locked tooling, Core and native `apps/web` dependency trees.
  `npm run check:all` runs lint with zero warnings,
  recovery and application tests, both typechecks, Core audio tests with real
  FFmpeg, and the website production build. It also checks formatting/types,
  tests and builds the SvelteKit website; see `docs/SVELTEKIT_MIGRATION.md`.
  Separate Playwright browser suites
  are not included; run relevant browser suites for UI/playback changes. Docker
  is not required for these checks. For internal documentation-only edits,
  verify links and the diff without running the full application suite.
- For playback and TV layout changes, prioritize 3840×2160 (4K),
  2560×1440 (QHD/2K) and 1920×1080 (1080p), while retaining mobile coverage.
  Use fluid viewport sizing with readable bounds; check screenshots as well as
  overflow and player/QR/control visibility.
- Core lives in `services/core/src/`; the only website is in `apps/web/`.
  Shared browser/domain services live in `lib/`, with API handlers in `lib/api/`.
  Preserve third-party license notices.
- Keep changes focused and report the checks actually run and any limitations.
- Preserve per-server queues, settings, permissions and databases. Owner access
  must not grant access to another server.
- Ordinary Discord music stays out of the public concert feed. Preserve queue
  revisions, stale-command protection and the shared playback clock.
- Use synthetic credentials and isolated temporary data in tests. Automated
  audio tests do not establish what a person hears in a Discord voice channel.

## Creative authority for the private alpha

- The owner grants broad creative and technical discretion for the Afterparty
  alpha website. Treat the existing UI as a starting point, not a fixed design,
  feature layout or component specification. Proactively choose distinctive,
  professional design, information architecture, navigation, responsive
  layouts, interactions, accessible motion and supporting tools that produce a
  better, coherent experience. Avoid generic template-like or "AI-looking" UI.
- For an authorized website goal, independently make routine, reversible
  design and implementation decisions. Rework, merge or replace screens and
  components, propose and build relevant usability improvements, and improve
  related flows without asking for approval on each detail. Significant
  redesigns are welcome while the site is alpha; do not require pixel-perfect
  parity with previous screenshots. Preserve the Afterparty identity as the
  starting brand, including its name, canonical logo and black/red direction.
  A full rebrand remains a distinct owner decision.
- Creative freedom is not a license for feature bloat or unbounded unrelated
  scope. Prioritize real usability, memorable polish, accessibility, readable
  mobile UI, maintainable architecture and demonstrable performance. Record
  substantial new independent feature ideas in GitHub issues, and split risky
  changes into reviewable draft PRs. Explain major tradeoffs, not every minor
  styling choice. Validate relevant user journeys with tests and visual review.
- Preserve functional user outcomes and critical authorization, persistence,
  privacy, queue, music and shared playback contracts, or document/test a safe,
  intentional migration with rollback. Do not change production systems or
  use live data during cloud development.
- This authority covers investigation, source edits, refactoring, tests,
  documentation, commits, branches, issues and draft PRs only. Never infer
  permission to merge/auto-merge, publish, deploy, change production/DNS/access
  or secrets, spend money, destroy important data or restart paused Rust work.
  Explicit owner approval is still required for those protected actions.

## Keep every change organized

- Treat source consolidation and navigability as acceptance criteria for every
  change, not a separate cleanup task. Before adding a module, setting, type,
  validation rule or helper, find its existing owner in the
  [source map](docs/ARCHITECTURE.md#source-map) and reuse or extend it.
- Keep related components, clients and behavior helpers together in their
  feature folder. Keep routes thin. Avoid a new parallel implementation when
  an existing shared contract or pure function serves the same responsibility.
- Settings, bounds, protocol types and validation rules shared by Core and the website must have one canonical browser-safe definition. Keep authorization,
  persistence and distinct UI lifecycles in their appropriate implementations.
- Remove duplication and dead code introduced or exposed by the current change
  when its callers and compatibility requirements are understood. Preserve
  migrations, public entry points, rollback and operational recovery tools.
  Compression means less duplication and clearer ownership, not minified source
  or unrelated wholesale rewrites.
- Update the canonical source map when adding, moving or changing ownership of
  a feature. Link to existing guidance rather than creating competing overviews.
- Before submitting, review the diff for misplaced files, duplicate definitions,
  stale imports and unnecessary dependencies. Run the required checks, including
  the existing unused-file audit and affected browser/contract tests. State any
  remaining structural limitation in the PR; do not claim unperformed cleanup.

## Technology decisions

- Choose technologies for measured product needs, operational reliability,
  security support and long-term maintenance rather than defaulting to
  JavaScript/TypeScript or always selecting the newest release. The existing
  TypeScript/Core stack remains supported while it is the sound choice.
- The owner explicitly retired Classic. SvelteKit/Svelte 5 in `apps/web/` is the
  sole website; do not restore React/Next/Vinext, a Classic fallback, or a second
  website build. Preserve shared API URLs, stored data, authorization and playback
  contracts. Runtime promotion, production rollout and replacing Core remain
  separate decisions. Prior signed artifacts remain operator recovery material.
- Consolidate Afterparty application and tooling code in TypeScript and Svelte.
  Avoid adding another application language when an existing module can own the
  work. Keep necessary host/runtime compatibility boundaries explicit; do not
  rename files or hide them from GitHub language statistics instead of migrating.
- Independent new projects choose their own fit-for-purpose stack, which could
  include Rust, Go, Python, TypeScript or other actively maintained technologies.
  Do not copy Afterparty's stack merely by habit, or introduce trendy tooling
  without a useful, supportable reason. Document substantive architecture choices.

- Use the [approved toolchain guide](docs/TOOLCHAIN.md) as the starting
  configuration for Afterparty work. It distinguishes tools already present
  from migration targets and optional tools. Do not claim a migration or
  tool installation was completed just because it was approved.

## Codex allowance and efficient execution

- Chat handles requirements, focused source inspection, research, issue triage,
  design decisions and PR review with its own available tools before consuming
  Codex capacity. Do not start Codex merely to plan, summarize, repeat earlier
  analysis, generate a prompt or perform a simple GitHub/documentation action
  that an existing authorized tool can do.
- Send one short, executable handoff: repository/ref, observed issue, desired
  outcome, constraints, relevant paths, acceptance criteria and targeted checks.
  Refer to these repository instructions by path; do not paste the entire
  instruction set, repository history or broad feature wishlist on every task.
  Reuse an existing issue or working thread rather than restarting discovery.
- Work in bounded, useful slices with a clear stop condition. Implement related
  changes together and report a concrete diff. For major alpha rewrites, advance
  one testable vertical slice at a time instead of requesting a complete
  redesign plus unrelated features in one Codex run.
- Subagents are opt-in for substantial independent work with a clear net
  benefit. Avoid default fan-out, duplicate exploration, overlapping agents
  and repeated reviews. Use one focused reviewer after meaningful changes
  when warranted; reuse existing CI and review results.
- During coding, run fast tests relevant to modified behavior and reuse their
  output. Before a review-ready code PR, run the required full validation and
  affected browser/security suites. Documentation-only edits need diff/link
  checks, not full application tests. Never reduce security, playback or data
  verification just to save allowance.
- Check remaining usage in Settings > Usage or Codex CLI `/status` when
  available. If running low, finish the smallest useful verified slice, record
  remaining work in the issue/PR and stop nonessential reruns. Never assume
  an exact quota, promise a saving percentage or spend API credits automatically.

## Delegation and review

- ChatGPT Chat is the project coordinator and primary owner dialogue. Dot
  (Sjefen) is temporarily excluded from the active workflow because it is
  unstable. Do not route tasks, handoffs or reviews through Dot. Resume its role
  only after an explicit owner decision. ChatGPT Work remains excluded.
- For Chat-led requests, inspect current GitHub evidence and only the files,
  issues and documentation relevant to the task. Investigate bugs, constraints
  and tradeoffs enough to define observable acceptance criteria. Skip lengthy
  discovery for small, obvious changes. Chat resolves research-only requests
  directly; delegate code edits, executable tests or environment-specific
  debugging to Codex when needed, with a focused technical handoff.
- Conserve Codex allowance: use an available lightweight model for trivial edits,
  GPT-6.1 Sol at Medium effort for ordinary coding, and Sol High for difficult
  debugging, architecture or migrations. Escalate to the heaviest model only
  with a concrete reason. Verify actual model/effort and report fallbacks.
- Use subagents or delegation when the active tool supports it and independent
  work benefits from parallel execution, such as source inspection and review.
  Give each agent a bounded task, source ref and acceptance criteria. Assign
  non-overlapping writes or separate worktrees; review the combined result.
- Check actual tool availability and permissions first. Chat model selection,
  including Pro, does not by itself provide subagent tools. If delegation is
  unavailable or would add unnecessary coordination, work sequentially and
  report the limitation or reason. Never claim that an agent or check ran unless it did.
- The lead agent owns integration, validation and the final report. When Chat is
  coordinating an owner request, it should follow the task through GitHub review
  and Codex handoffs without making the owner manually relay routine updates.
  Request decisions only for genuinely ambiguous goals or protected actions.
  Delegation does not grant merge, publishing, deployment or production access.

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
