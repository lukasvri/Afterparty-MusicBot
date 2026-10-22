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

## Technical choices

- Afterparty's current application stack is TypeScript/Node.js, React/Next.js and
  FFmpeg, with SvelteKit/Svelte 5 being evaluated for the unfinished alpha website
  in [issue #114](https://github.com/lukasvri/Afterparty-MusicBot/issues/114).
  Do not claim that migration has shipped. A significant alpha redesign is allowed
  when it materially improves maintainability, performance or the user experience,
  provided the security, data, playback and compatibility contracts are tested.
- Do not choose languages or frameworks merely because the existing code is
  JavaScript/TypeScript, nor adopt the newest tool solely for novelty. Evaluate
  maintained modern options against requirements, hosting/runtime support,
  measurable performance, accessibility, security, maturity and testability.
  Keep current working contracts during migration; document any deliberate change.
- These rules apply to Afterparty. Other projects, including OpenWorks, have
  independent repositories and should select their own fit-for-purpose stack.

## Development and validation

- Use Node.js 24.17+, Python 3.11+ and FFmpeg. `npm run setup:cloud` installs both
  locked dependency trees. `npm run check:all` runs lint with zero warnings,
  recovery and application tests, both typechecks, Core audio tests with real
  FFmpeg, and the website production build. Separate Playwright browser suites
  are not included; run relevant browser suites for UI/playback changes. Docker
  is not required for these checks. For internal documentation-only edits,
  verify links and the diff without running the full application suite.
- Core lives in `services/core/src/`; the website is in `app/`, `components/`,
  `hooks/` and `lib/`. Preserve third-party license notices.
- Keep changes focused and report the checks actually run and any limitations.
- Preserve per-server queues, settings, permissions and databases. Owner access
  must not grant access to another server.
- Ordinary Discord music stays out of the public concert feed. Preserve queue
  revisions, stale-command protection and the shared playback clock.
- Use synthetic credentials and isolated temporary data in tests. Automated
  audio tests do not establish what a person hears in a Discord voice channel.

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
- Prefer GPT-6.1 Sol with High reasoning effort in Chat, Codex and supported
  subagents when selectable. Verify the actual model and effort, and report any
  fallback or setting that cannot be verified.
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

- Record **every actual change** in GitHub, including internal engineering work,
  dependency/security updates, tests, documentation and user-facing changes.
  Use commits and reviewable PR descriptions; for product code follow the
  canonical [release policy](docs/RELEASING.md#notes-for-every-change), keep
  `lib/releases.json` complete and generate `CHANGELOG.md`. Preserve history
  and never introduce a competing changelog. Internal documentation-only edits
  need the PR record, not a product version bump.
- The Afterparty **website UI** at `/patch-notes` is for a short, truthful,
  user-relevant account of changes actually available in the build being viewed:
  delivered features, visible improvements and resolved user-impacting bugs.
  Exclude internal refactors, tooling, CI, dependency pins, future plans, draft
  PRs and unverified claims. Only mention an alpha feature with an accurate
  availability/limitations label. A commit, merge, test or GitHub Release does
  not establish production deployment.
- GitHub's complete notes and the website's curated notes must be kept distinct
  **without losing either**. The current page imports the complete release data;
  the release policy requires a reviewed implementation of audience filtering
  before claiming internal-only entries are hidden from the UI. Verify the
  actual website preview, version and patch-note links for user-visible updates.
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
