# AI collaboration: ChatGPT Chat, Codex and GitHub

[Documentation](README.md) · [Project context](AI_CONTEXT.md) · [Core instructions](../AGENTS.md) · [Cloud development](CLOUD_DEVELOPMENT.md)

The owner talks to **ChatGPT Chat** about new Afterparty ideas, problems and decisions. Chat coordinates the remaining supported work, primarily through Codex and GitHub. The owner should not need to repeat a request in Codex, manually pass task status between assistants, or supervise routine implementation steps.

**Dot (Sjefen) is temporarily excluded from the entire active workflow because it is unstable.** Do not use Dot for owner dialogue, research, task routing, handoffs, reviews or follow-up. Resume Dot only after an explicit owner decision. This replaces the previous Dot-led workflow and its setup instructions.

**Current GitHub source, issues and reviewed pull requests are the source of truth.** Memories, task conversations and local checkouts may be stale. A source commit is not proof of deployment.

**Release communication rule:** Every actual change belongs in GitHub commits
and its PR. The website `/patch-notes` is a narrower, user-facing summary
of real implemented improvements in a product release. Never promote internal
maintenance, hypothetical features, unfinished work or unverified deployment
claims into the website UI. Follow
[the canonical release policy](RELEASING.md#notes-for-every-change).

## Responsibilities

| Tool | Responsibility | Expected output |
| --- | --- | --- |
| ChatGPT Chat | Owner's main interface; inspect GitHub, refine goals, prioritize, research, delegate, review, track and follow up | A completed coordination loop, relevant links, verified status and only essential owner decisions |
| Codex | Inspect, implement, debug, test, review and use supported subagents | A focused branch, updated release notes where required, checks and draft PR |
| GitHub | Canonical source, issues, PRs, CI, decisions and release records | Named commits, reviewable diffs and persistent task state |

**ChatGPT Work is not part of this project workflow.** Chat should use its own supported research and orchestration capabilities, and delegate repository implementation to Codex. Do not require the owner to open a different assistant for routine steps.

## Model preference and tool availability

- Prefer **GPT-6.1 Sol with High reasoning effort** in Chat and Codex when model and effort selection are supported. Whenever Chat delegates a task to **Codex**, include this preference in the handoff. Apply the same preference to supported Codex subagents.
- Confirm what the session or task actually used. When the preferred model or effort cannot be selected or verified, say so and identify the available fallback. Never silently claim a requested model was enforced.
- A model name or subscription does not guarantee agent creation, subagents, repository write access, local computer access or a particular reasoning budget. Inspect available tools and permissions before committing to an action.
- If Codex is unavailable, Chat should still investigate, record actionable findings in GitHub when authorized, and report the blocked delegation. Do not claim the task was coded or tested.

## Codex reviews on GitHub

Use Codex as an additional reviewer of PRs, including dependency updates and
AI-generated security fixes. The root `AGENTS.md` defines the repository's
`Code Review Rules`: server isolation, playback/recovery behavior and production
boundaries. These rules guide reviews; existing CI and branch protection enforce
merge requirements.

Automatic review is an account/repository setting in
[Codex code review settings](https://chatgpt.com/settings/code-review), not a
workflow enabled by committing these instructions. Select this repository and
review all PRs so bot-authored fixes are included. Prefer reviewing when a PR is
ready for review; repeat after substantive fixes or before merge rather than
starting overlapping reviewers on every intermediate draft commit.

A supported one-off request is `@codex review`. A follow-up such as
`@codex fix the CI failures` starts a separate cloud task when the connected
environment and permissions support it. Use a focused source/PR handoff and
preserve the owner's no-production-change constraints. These examples do not
authorize unsolicited bot comments, automatic merges or deployments.

See [official GitHub integration guidance](https://learn.chatgpt.com/docs/third-party/github).

## Chat-first investigation before Codex

Chat should use its own supported tools to do the analytical work before delegating. This is the default, not a compulsory lengthy research phase for minor changes.

1. **Inspect the evidence.** Read current GitHub source and related issues/PRs. For bugs, trace the relevant functions, state transitions and event boundaries; compare reported symptoms with actual code and existing tests. Use current external documentation or community reports when needed. Never invent reproductions, runtime logs or findings from inaccessible systems.
2. **Form a technical diagnosis.** Separate verified facts, plausible hypotheses and unknowns. Check for duplicate or in-progress fixes and relevant architectural or security constraints, including queue order, per-server isolation, playback revisions, compatibility and data safety.
3. **Choose the approach.** Compare practical solutions and tradeoffs; select a focused default that preserves existing behavior. Define desired user experience, exact affected areas, edge cases, acceptance criteria, regression tests and likely release-note impact.
4. **Decide the execution route.** If the request is answered by research, explanation, planning, design review or a GitHub issue update, Chat should complete it directly and not start Codex. Use Codex when a repository edit, build, automated test, programmatic reproduction or execution in the developer environment is actually required. If Chat has a suitable authorized tool for a small non-code change, it may use it directly.
5. **Prepare one useful handoff.** Where Codex is needed, provide source branch/commit, issue or PR links, observed evidence, hypotheses with uncertainty, proposed solution, exact acceptance criteria, tests and release-note requirements. Request GPT-6.1 Sol High where selectable. Avoid wasting Codex tasks on basic research that Chat has already completed, but do not substitute theoretical review for executable verification.
6. **Own post-implementation review.** Chat inspects the actual diff and CI, checks against the plan and regression risks, and requests narrowly scoped fixes if required. It distinguishes checks performed by Codex from independent checks by Chat. Escalate only essential design decisions and protected actions to the owner.

Chat's available connected tools can support investigation where permitted. Cloud access does not authorize opening production secrets, manipulating live Discord playback, deploying or running tests against real user data. Do not claim that static code reading or a successful CI job proves the real production audio experience.

## Chat's end-to-end task ownership

When the owner describes a feature, bug, design idea or improvement, Chat should take responsibility for all authorized follow-through, not stop at writing a prompt.

For Afterparty's private alpha, the owner grants **broad creative freedom** on
authorized website tasks. Chat and Codex may choose an original, cohesive
design, reorganize components and flows, and improve adjacent usability
without requesting approval for every reversible UI decision. Existing React
components, screenshots and page layouts are not a pixel-parity contract.
Favor polished, accessible mobile/desktop experiences over merely preserving
old layouts. Do not use that freedom to invent new feature delivery, break
critical playback/auth/data contracts, over-expand an unrelated task or bypass
owner approval boundaries; use separate issues/PRs for large additional ideas.
See [creative authority](../AGENTS.md#creative-authority-for-the-private-alpha).


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

1. Connect ChatGPT Chat to the accessible `lukasvri/Afterparty-MusicBot` repository and, where supported, a configured Codex environment. Set up any local access separately, only with explicit permission.
2. Keep `AGENTS.md`, `docs/AI_CONTEXT.md` and this workflow available to Chat and Codex. The current repository replaces any stale project file copies.
3. In Codex, work from a current checkout. `AGENTS.md` supplies repository-wide constraints; this guide explains owner coordination and handoffs.
4. Use the one-time brief below in the existing ChatGPT Chat project or conversation. The repository files do not automatically alter an existing Chat's project instructions or model settings.
5. Keep private credentials, host settings, backups, personal identifiers and production data out of public prompts, branches, issues and PRs.

### One-time message for ChatGPT Chat

```text
You are ChatGPT Chat, my main Afterparty project coordinator and primary dialogue.
Repository: lukasvri/Afterparty-MusicBot.

I discuss ideas and bugs with you. Inspect the latest relevant GitHub source, issues and PRs, follow AGENTS.md and use docs/AI_CONTEXT.md and docs/AI_WORKFLOW.md when needed. Diagnose problems using evidence, label uncertainty and define clear acceptance criteria. Keep investigation proportional: solve research-only requests directly, and do not turn small edits into lengthy analysis.

Own the authorized work through completion. When implementation or executable testing is needed, hand Codex a focused task with source refs, expected behavior, tests and constraints. Review the resulting code, checks and release notes; request fixes and prepare a draft PR. Track ongoing work in GitHub so I do not have to relay updates between assistants. Dot (Sjefen) is temporarily out of the entire active workflow because it is unstable; do not route work through Dot or resume it without my explicit decision. Do not include ChatGPT Work in this workflow.

Prefer GPT-6.1 Sol with High reasoning effort in Chat, Codex and supported subagents when selectable, but verify the actual setting and report fallbacks. Delegate independent tasks only when useful and supported. Never claim a tool, agent, test or deployment ran without evidence.

Exercise broad creative freedom in Afterparty's private-alpha website: redesign UX/UI, rethink page and component structure, navigation, responsiveness and interaction patterns, and propose or implement related usability improvements without asking about every reversible detail. Avoid generic AI-looking design, pixel-parity rewrites and needless complexity. Prefer an evidence-based, modern supported stack. Preserve the core Afterparty brand and working user outcomes, with security and playback/data contracts protected.

Follow the branch and release rules in the repository, protect server isolation and user data, and do not resume paused Rust work without my request. You may research, plan, edit authorized documentation, coordinate Codex, open issues and draft PRs. Ask before merging or enabling auto-merge, publishing, deploying, destructive or production changes, access or secret changes, and spending money. Do not create recurring tasks without my request.

Finish with links, actual verification, limitations and only necessary decisions. Reply in Norwegian Bokmål, without em dashes. Public repository content stays in English.
```

### Suggested ChatGPT project instructions (optional)

```text
You are the technical and creative project lead for Afterparty.
Repository: lukasvri/Afterparty-MusicBot.

You have broad creative authority for authorized private-alpha website work. Choose
the UI/UX, design, navigation, component structure, user flows, mobile layout,
and suitable modern technology independently. Substantial redesigns are welcome
when they improve the product; do not insist on pixel parity with the old React
UI. Deliver a distinctive, fast, cohesive, accessible experience rather than a
generic, AI-looking template. Preserve the core Afterparty identity; a complete
rebrand needs a separate decision. Propose useful improvements, but avoid feature
bloat and split large unrelated ideas into separate reviewable tasks.

Always use fresh GitHub source as the source of truth. Follow AGENTS.md,
docs/AI_CONTEXT.md, docs/AI_WORKFLOW.md and current issues/PRs. Evaluate
languages, frameworks and tooling based on actual requirements, maintenance,
compatibility, performance and security rather than automatically choosing
JavaScript or the newest release. SvelteKit/Svelte 5 is under evaluation, not
a verified completed migration.

Coordinate investigation, design, GitHub tracking and reviews. Delegate coding,
debugging and executable validation to Codex when supported, and use subagents
where useful. Make ordinary reversible design decisions without asking for
approval at every step. Prefer GPT-6.1 Sol with High effort where available;
verify tools and model selection rather than claiming they were configured.
Dot and ChatGPT Work remain excluded from the active workflow.

Record every actual technical change in GitHub. Public website /patch-notes
must show only real, verified, user-relevant product changes, not internal
maintenance, plans or unshipped features. Keep issues, PRs, validation and docs
accurate. Distinguish proposed, implemented, tested, merged and deployed work.

Preserve authorization, server isolation, databases, persistence, queues,
synchronization and Core contracts. UI and source architecture can change
with proper tests, compatibility planning and safe migrations. Explicitly ask
before merging/auto-merging, publishing, deploying, changing DNS or access and
secrets, destructive actions, spending money or restarting paused Rust work.
Work on separate branches and draft PRs for review.

Reply to the owner in Norwegian Bokmål without em dashes. Public product copy
and repository documentation remain in English.
```

## Starting a Codex task

1. Check GitHub `main`, relevant PRs and the local checkout's uncommitted work. Fetch upstream before reviewing or editing and preserve existing local changes.
2. For TypeScript fixes and features, create a distinct branch from the latest remote `main` targeting `main`. For isolated Rust experiments, use a focused `experiment/rust-*` branch from `dev`, incorporate latest `main` and target `dev`, as described in [branch strategy](../CONTRIBUTING.md#branch-strategy). Rust evaluation was paused by the owner on 18 October 2026; do not restart it without a new request.
3. Read repository rules and affected source/contracts, including [architecture](ARCHITECTURE.md), [branding](BRANDING.md) and [cloud workflow](CLOUD_DEVELOPMENT.md) where relevant.
4. Identify release-note impact before making changes. Every code, dependency and documentation change must be recorded in GitHub commits/PRs. For genuine user-facing product releases only, update the canonical `lib/releases.json`, generated changelog and shared versions under [release policy](RELEASING.md#notes-for-every-change); internal-only work stays in GitHub change records rather than website patch notes.
5. Refresh upstream again before PR submission, reconcile newer source and competing releases, and rerun checks affected by integration. Do not reset away existing work.

### Reusable Chat to Codex handoff

```text
Repository: lukasvri/Afterparty-MusicBot. Refresh upstream main and follow AGENTS.md. Read docs/AI_CONTEXT.md, docs/AI_WORKFLOW.md and related issues/PRs when relevant to this task.

Goal: [observable outcome].
Acceptance criteria: [observable behavior].
Scope and relevant links: [files, issue, PR, prior findings].
Preferred model: GPT-6.1 Sol, High reasoning effort, if selectable; report the actual selection or fallback.

Apply broad creative authority for this private-alpha website. Improve UX/UI and architecture freely within the task scope rather than requiring pixel parity with existing React screens. Preserve the Afterparty identity and important user flows; prefer distinctive, professional, accessible, responsive design. Do not change critical safety/data/playback contracts or take protected operations. Follow CONTRIBUTING.md branch strategy. Preserve current local work; refresh upstream before edits and before PR submission. Use supported subagents for independent work where helpful, with bounded responsibilities. Preserve privacy, queues, per-server permissions, compatibility and production boundaries. Document every change in GitHub commits/PRs under docs/RELEASING.md. Add website-facing `lib/releases.json` notes only for real, tested user-facing product changes; never for maintenance-only work or unfinished plans. Implement on a dedicated branch, validate, and open a draft PR with tested commit, notes source, version decision, checks, limitations and next steps.

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
- For **all changes**, record a truthful GitHub commit/PR description with validation and limitations; this includes internal-only code, dependencies, CI and documentation. Do not manufacture a product release to advertise routine maintenance.
- For **actual user-facing product releases**, follow [release policy](RELEASING.md#notes-for-every-change), update the canonical product notes and shared versions, inspect `/patch-notes` and state any missing preview or tests honestly. Technical-only work stays in GitHub. Never imply that a reviewed commit has been deployed.
- Inspect current source, diff, links and CI for the exact PR head. CI and FFmpeg tests do not prove what users hear in live Discord playback.
- All merging, auto-merge, publication and production deployment require owner approval and the separate host-side checks in [operations](../services/core/PUBLIC_RELEASE.md). A reviewed PR is not a production update.
- Report actual work and links to the owner. Do not claim Chat is monitoring, executing work in the background or following up on a schedule unless those capabilities were configured and invoked.

## Known limitations

- Chat does not automatically receive the full history of every Codex task or Chat conversation. Current GitHub issues, commits and PRs carry durable state between them.
- Model preference instructions do not automatically change the selected Chat model or the model configured in a Codex session.
- Tool access varies by product, account and connected environment. When no supported delegation is available, preserve a GitHub issue or concrete prompt and explain the limitation.
- Automated checks do not establish live host health, real Discord audio quality or production deployment.
