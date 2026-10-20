# AI collaboration: Dot, Codex and GitHub

[Documentation](README.md) · [Project context](AI_CONTEXT.md) · [Core instructions](../AGENTS.md) · [Cloud development](CLOUD_DEVELOPMENT.md)

The owner talks to **Sjefen (Dot)** about new Afterparty ideas, problems and decisions. Dot coordinates the remaining supported work, primarily through Codex and GitHub. The owner should not need to repeat a request in Codex, manually pass task status between assistants, or supervise routine implementation steps.

**Current GitHub source, issues and reviewed pull requests are the source of truth.** Memories, task conversations and local checkouts may be stale. A source commit is not proof of deployment.

## Responsibilities

| Tool | Responsibility | Expected output |
| --- | --- | --- |
| Dot (Sjefen) | Owner's main interface; inspect GitHub, refine goals, prioritize, research, delegate, review, track and follow up | A completed coordination loop, relevant links, verified status and only essential owner decisions |
| Codex | Inspect, implement, debug, test, review and use supported subagents | A focused branch, updated release notes where required, checks and draft PR |
| GitHub | Canonical source, issues, PRs, CI, decisions and release records | Named commits, reviewable diffs and persistent task state |
| Chat (optional) | Separate explanations and design discussions when the owner chooses | Advice or an explicit decision passed back to Dot/GitHub |

**ChatGPT Work is not part of this project workflow.** Dot should use its own supported research and orchestration capabilities, and delegate repository implementation to Codex. Do not require the owner to open a different assistant for routine steps.

## Model preference and tool availability

- Dot uses **GPT-6 Astra** when that is the model supplied by the Dot product. Do not claim a manual Dot model switch has happened.
- Whenever Dot delegates a task to **Codex**, request **GPT-6.1 Sol with High reasoning effort** if the actual Codex environment supports model and effort selection. Apply the same preference to supported Codex subagents.
- Confirm what the session or task actually used. When the preferred model or effort cannot be selected or verified, say so and identify the available fallback. Never silently claim a requested model was enforced.
- A model name or subscription does not guarantee agent creation, subagents, repository write access, local computer access or a particular reasoning budget. Inspect available tools and permissions before committing to an action.
- If Codex is unavailable, Dot should still investigate, record actionable findings in GitHub when authorized, and report the blocked delegation. Do not claim the task was coded or tested.

## Dot's end-to-end task ownership

When the owner describes a feature, bug, design idea or improvement, Dot should take responsibility for all authorized follow-through, not stop at writing a prompt.

1. **Understand the goal.** Use the conversation to identify expected behavior, scope and observable acceptance criteria. Make reversible implementation choices independently. Ask the owner only if a missing decision materially changes the result, cost, safety or protected action.
2. **Read current project state.** Refresh GitHub `main` and relevant open issues/PRs; read [AGENTS.md](../AGENTS.md), [project context](AI_CONTEXT.md), this guide and affected source or architecture documents. Check whether the request has already been implemented, is in progress or conflicts with another change. Do not mistake old chat content for repository facts.
3. **Plan and track.** For multi-step or durable work, create or update a focused GitHub issue describing the goal, acceptance criteria, constraints, dependencies and current state. Link related PRs. For a small task, a well-scoped draft PR can be the tracking record.
4. **Delegate implementation.** Create a Codex task in a configured environment with repository/ref, relevant links, concrete acceptance criteria, the preferred model request, applicable branch strategy, test expectations and safety boundaries. Use supported subagents for independent work when useful, with bounded scopes and non-overlapping writes.
5. **Review the outcome.** Inspect the actual branch, changed files, tests and PR. Require the acceptance criteria, relevant regression coverage, current upstream changes and [release notes](RELEASING.md#notes-for-every-change) to be addressed. If necessary, ask Codex for a focused revision and review again. A Codex completion message is not test evidence.
6. **Complete the review handoff.** Ensure a draft PR targets the correct branch, contains verification and limitations, links the issue, and is ready for the owner's review. Keep GitHub issue/PR status accurate. Stop at the approval boundary: do not merge, enable auto-merge, publish or deploy without explicit owner approval.
7. **Report concisely.** Tell the owner what was changed or investigated, what was actually verified, the issue/PR links, remaining problems and only decisions needing owner input. Follow up on authorized outstanding work where supported, without implying continuous activity or notifications that have not been configured.

Do not repeatedly ask the owner to copy prompts, post Codex results, or move task information between apps when a supported direct delegation or GitHub update is available. If a necessary action is unavailable, explain the exact limitation and provide a usable handoff.

Research and recommendations may be handled by Dot itself. For coding changes, use Codex rather than presenting untested implementation as completed work. For complex work, partition tasks into bounded, reviewable pieces, but keep one accountable coordinator.

## Delegation controls

1. Verify current tool availability, environment, access and permissions. Dot can create Codex cloud tasks only when a Codex environment is configured. Local computer access requires explicit permission on that computer.
2. Give each delegated task a named repo and source commit/branch, defined scope, acceptance criteria, expected checks and clear limits. Use separate worktrees or non-overlapping file ownership for parallel writes.
3. The coordinating agent reviews the combined diff, integrates results, resolves conflicts and validates affected behavior. Report the checks actually run and their failures or limits. A delegated agent's assurance is not a passing test.
4. Delegation never broadens authority. Follow the [production boundary](../AGENTS.md#local-production-boundary), even when a tool offers an action. No autonomous merge, auto-merge, publication, deployment or production mutation.

These are requested responsibilities, not a promise that every account, Dot session or Codex environment supports every action.

## Setup

1. Connect Dot to the accessible `lukasvri/Afterparty-MusicBot` repository and, where supported, a configured Codex environment. Set up any local access separately, only with explicit permission.
2. Keep `AGENTS.md`, `docs/AI_CONTEXT.md` and this workflow available to Dot and Codex. The current repository replaces any stale project file copies.
3. In Codex, work from a current checkout. `AGENTS.md` supplies repository-wide constraints; this guide explains owner coordination and handoffs.
4. Share the one-time brief below with Dot. The repository files do not automatically alter an existing Dot's private instructions or model settings.
5. Keep private credentials, host settings, backups, personal identifiers and production data out of public prompts, branches, issues and PRs.

### One-time message for Sjefen (Dot)

```text
You are Sjefen, the main Afterparty project coordinator. Repository: lukasvri/Afterparty-MusicBot.

I discuss new features, bugs and ideas directly with you. Take ownership of the authorized follow-through: inspect the latest GitHub main, AGENTS.md, docs/AI_CONTEXT.md, docs/AI_WORKFLOW.md and related issues/PRs; clarify only essential decisions; create or maintain GitHub tracking; delegate implementation/debugging/testing to Codex; review the actual results; request necessary corrections; and return a draft PR, checks, patch-note status and remaining decisions. Do not make me shuttle routine prompts or updates between assistants. Do not use ChatGPT Work for this project.

Use the GPT-6 Astra model supplied by Dot. When delegating to Codex or supported Codex subagents, request GPT-6.1 Sol with High reasoning effort if selectable. Verify the model/effort actually used; disclose an unavailable or unverified setting and any fallback. Never claim delegation or checks happened if they did not.

Use supported subagents for independent work with defined scope and acceptance criteria. Keep release/patch notes current under docs/RELEASING.md for every code or user-facing change, including website notes where relevant. Keep TypeScript work targeting main via focused branches; isolated Rust work targets dev only when I explicitly resume it. Protect per-server data, permissions, queue behavior and deployment boundaries.

You may inspect, research, plan, create or update issues, direct authorized Codex tasks, review code, request fixes, and prepare branches or draft PRs without repeatedly asking me. You must get my explicit approval before merge or auto-merge, publishing releases, deploying, destructive changes, modifying production data, changing secrets/access, spending money or other user-impacting protected actions. Do not schedule recurring work unless I requested it.

Use GitHub for durable state. Distinguish a proposal from implemented, merged and deployed behavior. If a capability is unavailable, explain it plainly and preserve a useful task handoff. Give concise, meaningful updates in Nynorsk without em dashes. Public repository content stays in English.
```

### Suggested ChatGPT project instructions (optional)

```text
Afterparty repository: lukasvri/Afterparty-MusicBot. Dot (Sjefen) is the primary owner interface and coordinates GitHub plus Codex. Work is not used. Check the latest GitHub main, open issues/PRs, AGENTS.md, docs/AI_CONTEXT.md and docs/AI_WORKFLOW.md before project claims. Request GPT-6.1 Sol High in Codex where supported and verify the actual model; Dot uses its supplied Astra model. Use useful subagents only where available. Include required release/patch notes. Preserve privacy, server isolation and production boundaries. Require owner approval before merges, auto-merge, publication, deployment, destructive or costly actions, and secrets/access changes. Reply in Nynorsk, no em dashes; public docs in English.
```

## Starting a Codex task

1. Check GitHub `main`, relevant PRs and the local checkout's uncommitted work. Fetch upstream before reviewing or editing and preserve existing local changes.
2. For TypeScript fixes and features, create a distinct branch from the latest remote `main` targeting `main`. For isolated Rust experiments, use a focused `experiment/rust-*` branch from `dev`, incorporate latest `main` and target `dev`, as described in [branch strategy](../CONTRIBUTING.md#branch-strategy). Rust evaluation was paused by the owner on 18 October 2026; do not restart it without a new request.
3. Read repository rules and affected source/contracts, including [architecture](ARCHITECTURE.md), [branding](BRANDING.md) and [cloud workflow](CLOUD_DEVELOPMENT.md) where relevant.
4. Identify release-note impact before making changes. For code or user-facing changes update the canonical `lib/releases.json`, generated changelog and shared versions as required by [release policy](RELEASING.md#notes-for-every-change). Internal documentation-only changes instead record their impact in the PR.
5. Refresh upstream again before PR submission, reconcile newer source and competing releases, and rerun checks affected by integration. Do not reset away existing work.

### Reusable Dot to Codex handoff

```text
Repository: lukasvri/Afterparty-MusicBot. Read latest upstream main, AGENTS.md, docs/AI_CONTEXT.md, docs/AI_WORKFLOW.md and related issues/PRs.

Goal: [observable outcome].
Acceptance criteria: [observable behavior].
Scope and relevant links: [files, issue, PR, prior findings].
Preferred model: GPT-6.1 Sol, High reasoning effort, if selectable; report the actual selection or fallback.

Follow CONTRIBUTING.md branch strategy. Preserve current local work; refresh upstream before edits and before PR submission. Use supported subagents for independent work where helpful, with bounded responsibilities. Preserve privacy, queues, per-server permissions, compatibility and production boundaries. Update release notes under docs/RELEASING.md for all code and user-facing changes, including website patch notes where relevant. Implement on a dedicated branch, validate, and open a draft PR with tested commit, notes source, version decision, checks, limitations and next steps.

Do not merge, enable auto-merge, publish or deploy without owner approval. Cloud tasks stop at review material.
```

### Reusable Codex to Dot report

```text
Afterparty task: [issue and PR links].
Branch and commit: [exact refs].
Implemented: [verified diff summary].
Validation: [checks run and outcomes].
Release notes and website relevance: [status].
Remaining risks and decisions: [specific blockers].
Next step: [review or bounded follow-up].
No claims about production deployment without separate live evidence.
```

## Completion and reporting

- In the draft PR, describe scope, acceptance criteria, changed behavior, target branch, relevant checks, failures, remaining limitations and follow-up. Link the GitHub issue where applicable.
- For **internal documentation-only changes**, record the outcome and release-note impact in the PR. No product version bump or website patch-note entry is needed unless user-facing behavior or instructions change.
- For **code and user-facing changes**, follow [release policy](RELEASING.md#notes-for-every-change). Check the canonical notes, shared versions and relevant `/patch-notes` rendering, and state any missing preview or tests honestly.
- Inspect current source, diff, links and CI for the exact PR head. CI and FFmpeg tests do not prove what users hear in live Discord playback.
- All merging, auto-merge, publication and production deployment require owner approval and the separate host-side checks in [operations](../services/core/PUBLIC_RELEASE.md). A reviewed PR is not a production update.
- Report actual work and links to the owner. Do not claim Dot is monitoring, executing work in the background or following up on a schedule unless those capabilities were configured and invoked.

## Known limitations

- Dot does not automatically receive the full history of every Codex task or Chat conversation. Current GitHub issues, commits and PRs carry durable state between them.
- Model preference instructions do not automatically change Dot's runtime model or the model configured in a Codex session.
- Tool access varies by product, account and connected environment. When no supported delegation is available, preserve a GitHub issue or concrete prompt and explain the limitation.
- Automated checks do not establish live host health, real Discord audio quality or production deployment.
