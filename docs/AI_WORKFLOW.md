# Afterparty workflow: Codex and GitHub

[Documentation](README.md) · [Project context](AI_CONTEXT.md) · [Core instructions](../AGENTS.md) · [Cloud development](CLOUD_DEVELOPMENT.md)

The owner can work **directly in Codex and GitHub**. Codex reads current source, investigates, implements, tests and prepares reviewable changes; the owner makes protected decisions. ChatGPT Chat can coordinate when the owner chooses it, but opening Chat or relaying messages through another assistant is not required. Start with [the dated Codex handoff](CODEX_HANDOFF.md) when continuing the October 2026 recovery work.

**Dot (Sjefen) is temporarily excluded from the entire active workflow because it is unstable.** Do not use Dot for owner dialogue, research, task routing, handoffs, reviews or follow-up. Resume Dot only after an explicit owner decision. This replaces the previous Dot-led workflow and its setup instructions.

**Current GitHub source, issues and reviewed pull requests are the source of truth.** Memories, task conversations and local checkouts may be stale. A source commit is not proof of deployment.

## Responsibilities

| Tool | Responsibility | Expected output |
| --- | --- | --- |
| ChatGPT Chat (optional) | When explicitly chosen by the owner; inspect GitHub, refine goals, prioritize, research, delegate, review, track and follow up | A completed coordination loop, relevant links, verified status and only essential owner decisions |
| Codex | Inspect, implement, debug, test, review and use supported subagents | A focused branch, updated release notes where required, checks and draft PR |
| GitHub | Canonical source, issues, PRs, CI, decisions and release records | Named commits, reviewable diffs and persistent task state |

**ChatGPT Work is not part of this project workflow.** Chat should use its own supported research and orchestration capabilities, and delegate repository implementation to Codex. Do not require the owner to open a different assistant for routine steps.

## Model preference and tool availability

- Prefer **GPT-6.1 Sol with High reasoning effort** in Chat and Codex when model and effort selection are supported. Whenever Chat delegates a task to **Codex**, include this preference in the handoff. Apply the same preference to supported Codex subagents.
- Confirm what the session or task actually used. When the preferred model or effort cannot be selected or verified, say so and identify the available fallback. Never silently claim a requested model was enforced.
- A model name or subscription does not guarantee agent creation, subagents, repository write access, local computer access or a particular reasoning budget. Inspect available tools and permissions before committing to an action.
- If Codex is unavailable, Chat should still investigate, record actionable findings in GitHub when authorized, and report the blocked delegation. Do not claim the task was coded or tested.

## Chat-first investigation before Codex

This section applies only when the owner chooses Chat as coordinator. In a direct Codex task, Codex performs the same source inspection, diagnosis and acceptance planning itself. No preliminary Chat session is required. Keep the work proportionate to the change.

1. **Inspect the evidence.** Read current GitHub source and related issues/PRs. For bugs, trace the relevant functions, state transitions and event boundaries; compare reported symptoms with actual code and existing tests. Use current external documentation or community reports when needed. Never invent reproductions, runtime logs or findings from inaccessible systems.
2. **Form a technical diagnosis.** Separate verified facts, plausible hypotheses and unknowns. Check for duplicate or in-progress fixes and relevant architectural or security constraints, including queue order, per-server isolation, playback revisions, compatibility and data safety.
3. **Choose the approach.** Compare practical solutions and tradeoffs; select a focused default that preserves existing behavior. Define desired user experience, exact affected areas, edge cases, acceptance criteria, regression tests and likely release-note impact.
4. **Decide the execution route.** If the request is answered by research, explanation, planning, design review or a GitHub issue update, Chat should complete it directly and not start Codex. Use Codex when a repository edit, build, automated test, programmatic reproduction or execution in the developer environment is actually required. If Chat has a suitable authorized tool for a small non-code change, it may use it directly.
5. **Prepare one useful handoff.** Where Codex is needed, provide source branch/commit, issue or PR links, observed evidence, hypotheses with uncertainty, proposed solution, exact acceptance criteria, tests and release-note requirements. Request GPT-6.1 Sol High where selectable. Avoid wasting Codex tasks on basic research that Chat has already completed, but do not substitute theoretical review for executable verification.
6. **Own post-implementation review.** Chat inspects the actual diff and CI, checks against the plan and regression risks, and requests narrowly scoped fixes if required. It distinguishes checks performed by Codex from independent checks by Chat. Escalate only essential design decisions and protected actions to the owner.

Chat's available connected tools can support investigation where permitted. Cloud access does not authorize opening production secrets, manipulating live Discord playback, deploying or running tests against real user data. Do not claim that static code reading or a successful CI job proves the real production audio experience.

## Chat's end-to-end task ownership

When the owner explicitly chooses Chat as coordinator for a feature, bug, design idea or improvement, Chat should take responsibility for all authorized follow-through, not stop at writing a prompt.

1. **Understand the goal.** Use the conversation to identify expected behavior, scope and observable acceptance criteria. Make reversible implementation choices independently. Ask the owner only if a missing decision materially changes the result, cost, safety or protected action.
2. **Read relevant project state.** Refresh GitHub `main` and inspect applicable issues, PRs and source files. Follow [AGENTS.md](../AGENTS.md); consult [project context](AI_CONTEXT.md), this guide and architectural documents when relevant. For minor documentation edits, do not read unrelated source or documents. Verify whether a proposed change already exists; do not mistake old chat content for current repository facts.
3. **Plan and track.** For multi-step or durable work, create or update a focused GitHub issue describing the goal, acceptance criteria, constraints, dependencies and current state. Link related PRs. For a small task, a well-scoped draft PR can be the tracking record.
4. **Investigate, then delegate only if needed.** Perform the [Chat-first investigation](#chat-first-investigation-before-codex). Finish research-only work directly. If a code change or executable validation is needed, create a Codex task in a configured environment with repository/ref, technical evidence, chosen approach, relevant links, concrete acceptance criteria, preferred model request, applicable branch strategy, test expectations and safety boundaries. Use supported subagents for independent work when useful, with bounded scopes and non-overlapping writes.
5. **Review the outcome.** Inspect the actual branch, changed files, tests and PR. Require the acceptance criteria, relevant regression coverage, current upstream changes and [release notes](RELEASING.md#notes-for-every-change) to be addressed. If necessary, ask Codex for a focused revision and review again. A Codex completion message is not test evidence.
6. **Complete the review handoff.** Ensure a draft PR targets the correct branch, contains verification and limitations, links the issue, and is ready for the owner's review. Keep GitHub issue/PR status accurate. Stop at the approval boundary: do not merge, enable auto-merge, publish or deploy without explicit owner approval.
7. **Report concisely.** Tell the owner what was changed or investigated, what was actually verified, the issue/PR links, remaining problems and only decisions needing owner input. Follow up on authorized outstanding work where supported, without implying continuous activity or notifications that have not been configured.

Do not repeatedly ask the owner to copy prompts, post Codex results, or move task information between apps when a supported direct delegation or GitHub update is available. If a necessary action is unavailable, explain the exact limitation and provide a usable handoff.

Chat should perform substantive research, code reading, technical diagnosis, design evaluation and test planning itself before passing implementation to Codex when needed. Do not hand a vague idea straight to Codex or present static analysis as an executed test. For complex work, partition tasks into bounded, reviewable pieces, but keep one accountable coordinator.

## Delegation controls

1. Verify current tool availability, environment, access and permissions. Chat can delegate directly to Codex only when a supported delegation tool and a configured Codex environment are available. Otherwise, keep findings in GitHub and provide a concrete handoff with the exact limitation. Local computer access requires explicit permission on that computer.
2. Give each delegated task a named repo and source commit/branch, defined scope, acceptance criteria, expected checks and clear limits. Use separate worktrees or non-overlapping file ownership for parallel writes.
3. The coordinating agent reviews the combined diff, integrates results, resolves conflicts and validates affected behavior. Report the checks actually run and their failures or limits. A delegated agent's assurance is not a passing test.
4. Delegation never broadens authority. Follow the [production boundary](../AGENTS.md#local-production-boundary), even when a tool offers an action. No autonomous merge, auto-merge, publication, deployment or production mutation.

These are requested responsibilities, not a promise that every account, Chat session or Codex environment supports every action.

## Setup

1. Open the `lukasvri/Afterparty-MusicBot` project directly in Codex and connect GitHub as available. Chat coordination is optional. Set up local host access separately, only with explicit permission.
2. Keep `AGENTS.md`, `docs/AI_CONTEXT.md` and this workflow available to Chat and Codex. The current repository replaces any stale project file copies.
3. In Codex, work from a current checkout. `AGENTS.md` supplies repository-wide constraints; this guide explains owner coordination and handoffs.
4. Only if using optional Chat coordination, use the one-time brief below in that Chat project or conversation. The repository files do not automatically alter an existing Chat's project instructions or model settings.
5. Keep private credentials, host settings, backups, personal identifiers and production data out of public prompts, branches, issues and PRs.

### One-time message for ChatGPT Chat

```text
You are ChatGPT Chat, my main Afterparty project coordinator and primary dialogue.
Repository: lukasvri/Afterparty-MusicBot.

I discuss ideas and bugs with you. Inspect the latest relevant GitHub source, issues and PRs, follow AGENTS.md and use docs/AI_CONTEXT.md and docs/AI_WORKFLOW.md when needed. Diagnose problems using evidence, label uncertainty and define clear acceptance criteria. Keep investigation proportional: solve research-only requests directly, and do not turn small edits into lengthy analysis.

Own the authorized work through completion. When implementation or executable testing is needed, hand Codex a focused task with source refs, expected behavior, tests and constraints. Review the resulting code, checks and release notes; request fixes and prepare a draft PR. Track ongoing work in GitHub so I do not have to relay updates between assistants. Dot (Sjefen) is temporarily out of the entire active workflow because it is unstable; do not route work through Dot or resume it without my explicit decision. Do not include ChatGPT Work in this workflow.

Prefer GPT-6.1 Sol with High reasoning effort in Chat, Codex and supported subagents when selectable, but verify the actual setting and report fallbacks. Delegate independent tasks only when useful and supported. Never claim a tool, agent, test or deployment ran without evidence.

Follow the branch and release rules in the repository, protect server isolation and user data, and do not resume paused Rust work without my request. You may research, plan, edit authorized documentation, coordinate Codex, open issues and draft PRs. Ask before merging or enabling auto-merge, publishing, deploying, destructive or production changes, access or secret changes, and spending money. Do not create recurring tasks without my request.

Finish with links, actual verification, limitations and only necessary decisions. Reply in Norwegian Bokmål, without em dashes. Public repository content stays in English.
```

### Suggested ChatGPT project instructions (optional)

```text
Afterparty: lukasvri/Afterparty-MusicBot. ChatGPT Chat is the project coordinator and primary owner dialogue, coordinating GitHub and Codex. Dot (Sjefen) is temporarily excluded because it is unstable; resume it only after an explicit owner decision. ChatGPT Work is not used. Verify current source and relevant issues/PRs for project claims. Follow AGENTS.md and consult docs/AI_CONTEXT.md and docs/AI_WORKFLOW.md when needed. Investigate proportionally; resolve research-only requests directly and delegate executable work to Codex when required. Request GPT-6.1 Sol High where selectable, and report actual model/fallback. Use supported subagents only for useful independent work. Review changes, relevant tests and required release/patch notes before a draft PR. Preserve security, server isolation and production boundaries. Require owner approval before merging, auto-merge, publication, deployment, destructive/costly changes or access/secrets changes. Reply in Norwegian Bokmål without em dashes; public docs in English.
```

## Starting a Codex task

1. Check GitHub `main`, relevant PRs and the local checkout's uncommitted work. Fetch upstream before reviewing or editing and preserve existing local changes.
2. For TypeScript fixes and features, create a distinct branch from the latest remote `main` targeting `main`. For isolated Rust experiments, use a focused `experiment/rust-*` branch from `dev`, incorporate latest `main` and target `dev`, as described in [branch strategy](../CONTRIBUTING.md#branch-strategy). Rust evaluation was paused by the owner on 18 October 2026; do not restart it without a new request.
3. Read repository rules and affected source/contracts, including [architecture](ARCHITECTURE.md), [branding](BRANDING.md) and [cloud workflow](CLOUD_DEVELOPMENT.md) where relevant.
4. Identify release-note impact before making changes. For code or user-facing changes update the canonical `lib/releases.json`, generated changelog and shared versions as required by [release policy](RELEASING.md#notes-for-every-change). Internal documentation-only changes instead record their impact in the PR.
5. Refresh upstream again before PR submission, reconcile newer source and competing releases, and rerun checks affected by integration. Do not reset away existing work.

### Reusable Chat to Codex handoff

```text
Repository: lukasvri/Afterparty-MusicBot. Refresh upstream main and follow AGENTS.md. Read docs/AI_CONTEXT.md, docs/AI_WORKFLOW.md and related issues/PRs when relevant to this task.

Goal: [observable outcome].
Acceptance criteria: [observable behavior].
Scope and relevant links: [files, issue, PR, prior findings].
Preferred model: GPT-6.1 Sol, High reasoning effort, if selectable; report the actual selection or fallback.

Follow CONTRIBUTING.md branch strategy. Preserve current local work; refresh upstream before edits and before PR submission. Use supported subagents for independent work where helpful, with bounded responsibilities. Preserve privacy, queues, per-server permissions, compatibility and production boundaries. Update release notes under docs/RELEASING.md for all code and user-facing changes, including website patch notes where relevant. Implement on a dedicated branch, validate, and open a draft PR with tested commit, notes source, version decision, checks, limitations and next steps.

Do not merge, enable auto-merge, publish or deploy without owner approval. Cloud tasks stop at review material.
```

### Reusable Codex to Chat report

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
- Report actual work and links to the owner. Do not claim Chat is monitoring, executing work in the background or following up on a schedule unless those capabilities were configured and invoked.

## Known limitations

- Chat does not automatically receive the full history of every Codex task or Chat conversation. Current GitHub issues, commits and PRs carry durable state between them.
- Model preference instructions do not automatically change the selected Chat model or the model configured in a Codex session.
- Tool access varies by product, account and connected environment. When no supported delegation is available, preserve a GitHub issue or concrete prompt and explain the limitation.
- Automated checks do not establish live host health, real Discord audio quality or production deployment.
