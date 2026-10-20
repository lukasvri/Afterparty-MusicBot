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

- For Dot-led requests, inspect current GitHub evidence and only the files,
  issues and documentation relevant to the task. Investigate bugs, constraints
  and tradeoffs enough to define observable acceptance criteria. Skip lengthy
  discovery for small, obvious changes. Dot resolves research-only requests
  directly; delegate code edits, executable tests or environment-specific
  debugging to Codex when needed, with a focused technical handoff.
- Use subagents or delegation when the active tool supports it and independent
  work benefits from parallel execution, such as source inspection and review.
  Give each agent a bounded task, source ref and acceptance criteria. Assign
  non-overlapping writes or separate worktrees; review the combined result.
- Check actual tool availability and permissions first. Chat model selection,
  including Pro, does not by itself provide subagent tools. If delegation is
  unavailable or would add unnecessary coordination, work sequentially and
  report the limitation or reason. Never claim that an agent or check ran unless it did.
- The lead agent owns integration, validation and the final report. When Dot is
  coordinating an owner request, it should follow the task through GitHub review
  and Codex handoffs without making the owner manually relay routine updates.
  Request decisions only for genuinely ambiguous goals or protected actions.
  Delegation does not grant merge, publishing, deployment or production access.

## Release notes and pull requests

- Every code or user-facing change must include written release/patch notes in
  the same PR and keep them current as scope changes. Follow the canonical
  [release policy](docs/RELEASING.md#notes-for-every-change), including its rules
  for internal documentation and isolated Rust experiments.
- Use `lib/releases.json` for product notes and generate `CHANGELOG.md`; preserve
  historical entries. Verify relevant notes reach the website's `/patch-notes`
  and latest-release link. Do not create a competing changelog.
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

- For Dot and Codex coordination, with Chat available for optional discussion,
  consult [shared project context](docs/AI_CONTEXT.md) and
  [AI collaboration workflow](docs/AI_WORKFLOW.md). The live repository and
  reviewed PRs, not assistant chat history, are the source of truth.
- Keep the context document to lasting, verified decisions. Use GitHub issues and PRs for current task progress. Never confuse merged code with production deployment.
