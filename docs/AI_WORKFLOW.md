# AI collaboration: Dot, Chat, Work and Codex

[Documentation](README.md) · [Project context](AI_CONTEXT.md) · [Core instructions](../AGENTS.md) · [Cloud development](CLOUD_DEVELOPMENT.md)

This guide keeps a personal dot, ChatGPT Chat, ChatGPT Work and Codex aligned without assuming that their chat histories are shared. The **current GitHub repository**, its source files and reviewed pull requests are the source of truth, not conversation memory or a stale local checkout.

## Who does what?

| Tool | Best use | Deliverable |
| --- | --- | --- |
| Dot | Ongoing coordination, contextual follow-up, proactive review and delegated work | A current summary, proposed next action or scoped task handoff |
| Chat | Questions, explanation, prioritization, design critique, acceptance criteria | A decision or a small task brief |
| Work | Multi-step research, comparison, cross-app investigation, planning and documents | Evidence, an actionable report, or a task brief |
| Codex | Repository inspection, implementation, debugging, tests and code review | A focused branch and draft pull request |

Chat, Work and Dot may read the connected GitHub repository when access is enabled. Codex works against the actual selected checkout or cloud environment. Dot can create Codex cloud tasks in an environment configured in Codex, and can create local Work or Codex tasks only after the owner explicitly grants local computer access. **Neither Chat nor Work should claim to know the latest code or live deployment status without checking.** Codex history and Chat/Work histories are separate.

## Set up one ChatGPT project

1. Create a ChatGPT project named **Afterparty**. Set its memory to **Default memory**, not **Project-only memory**, if you want to use Work in the project. Project-only memory currently disables Work there.
2. Move related Chat/Work conversations into the project where useful. Add stable decisions as project sources, but keep the canonical public engineering documentation in GitHub.
3. Use the connected GitHub app for fresh source inspection in Chat/Work. Project files or uploaded copies can become stale and must not override GitHub.
4. In Codex desktop, open the current `Afterparty-MusicBot` checkout. Codex reads the root `AGENTS.md`; consult `docs/AI_CONTEXT.md` for shared project decisions.
5. Introduce the dot separately to the repository and give it the coordination brief below. Dot tasks do not automatically inherit all ChatGPT project instructions or every conversation.
6. Keep production credentials and personal data outside the project, prompts, issues, PRs and repository.

Suggested **project instructions** to paste into the ChatGPT project's settings:

```text
Project: Afterparty, repository lukasvri/Afterparty-MusicBot.
For code and product claims, inspect the latest GitHub main and relevant open PRs instead of relying only on prior chat. Read AGENTS.md, docs/AI_CONTEXT.md and relevant source documentation before proposing changes. Treat code, tests and reviewed PRs as evidence; distinguish unverified plans from implemented functionality and deployed functionality. Use Chat for discussions, Work for multi-step research and cross-app deliverables, Codex for code modifications, and Dot for ongoing coordination and follow-up. Give Codex a scoped task with acceptance criteria rather than assuming chat history is transferred. Never expose secrets or deploy production without explicit authorization and the repository's production checks. Respond to me in Nynorsk, with concise explanations and no em dashes. Public repository documentation stays in English.
```

## Dot as the ongoing coordinator

Give the personal dot a standing goal to help **coordinate**, not an unrestricted right to change production. It can retain context, inspect connected sources, do proactive research and, when configured, schedule recurring checks. The dot shares some ChatGPT memory and recent context, but every delegated task has its own context; provide exact repository and PR links with each handoff.

- Begin by checking the current GitHub main, open issues and PRs before summarizing project state.
- Offer concise updates only when a meaningful result, failure, blocker or requested scheduled checkpoint occurs. Avoid repetitive updates that only say nothing changed.
- Delegate implementation to a Codex cloud environment only if the owner has configured the environment. Use a connected local computer for Work or Codex tasks only with explicit local access enabled.
- Permit research, drafting, source inspection and proposals within the available permissions. Require the owner's approval before merging, publishing, deploying, modifying production data, changing credentials, spending money or doing destructive operations. Always follow stricter platform approvals and repository rules.
- Use PRs/issues and these docs to hand off durable project facts. Keep transient task history in the task or PR instead of assuming automatic cross-conversation synchronization.
- Do not schedule recurring work unless the owner explicitly requests the cadence or condition.

**One-time message to the dot:**

```text
You are the ongoing coordinator for Afterparty, repository lukasvri/Afterparty-MusicBot.
Use the latest upstream main, AGENTS.md, docs/AI_CONTEXT.md, docs/AI_WORKFLOW.md and relevant GitHub issues/PRs as the source of truth. Track decisions and identify worthwhile next actions. When I request a feature, turn it into clear acceptance criteria; use a configured Codex environment for implementation and Work for multi-step external research when useful. Return the PR or task link, checks actually run, unresolved risks, and decisions you need from me. You may investigate, draft and suggest improvements. Never assume a commit is deployed, and never merge, deploy, delete production data or change secrets without explicit approval and the repository's production checks. Keep private information outside public GitHub. Communicate in Nynorsk with clear, short updates and no em dashes. Do not set up recurring monitoring until we agree on the frequency.
```

To grant optional local computer access, open the dot's profile on that computer in the ChatGPT desktop app, find **Computers** and select **Allow access**. Having Codex or Work Sync already connected does not grant this separate access. Review the permissions carefully; you can revoke them later.

## Beginning a task

1. Identify the goal, expected behavior, affected area and acceptance criteria. If it is a straightforward implementation, go directly to Codex.
2. Check GitHub `main` and relevant open PRs or issues. Check actual local changes before starting a branch or switching worktrees. Normal TypeScript fixes and features use a distinct branch based on the latest remote `main` and target `main`. Isolated Rust tasks use a focused `experiment/rust-*` branch from current `dev` and target `dev`. For both paths, fetch upstream and ensure the task branch includes the latest remote `main` before reviewing or editing code. Before submission, fetch `main` and the target branch again, incorporate any newer `main` and rerun affected checks while preserving existing work. Follow the [branch strategy](../CONTRIBUTING.md#branch-strategy), and do not merge existing `nightly` or Rust branches into `main` as part of the setup.
3. Read `AGENTS.md`, `docs/AI_CONTEXT.md`, and the specific source or documentation involved. Read architecture, branding, cloud operations and compatibility contracts as applicable.
4. Do not turn an idea, conversation promise or previous assistant answer into an assertion that the feature exists. Verify the repository or current PR.
5. Use Work for external research when needed; use Codex for implementation. For parallel Codex agents, assign non-overlapping modules or worktrees and review their combined changes.

## Finishing a task

- In the draft PR, state what changed, why, the target branch, the checks actually run, failures and limits, and any production actions still needed. A PR is **not** a deployment.
- Update `docs/AI_CONTEXT.md` only when a durable, confirmed product decision, architecture constraint or enduring priority changes. Do not rewrite it for every routine fix.
- Track live activity using GitHub issues and PRs, not a manually maintained list that will go stale. The repository's generated changelog has its own release process.
- Merge and production deployment require normal review and the checks in `AGENTS.md`, `CLOUD_DEVELOPMENT.md` and the operations guide. Never automatically update the live Discord bot or website as part of a cloud task.
- When returning to Chat or Work, **point to the PR/commit** and ask the assistant to read it. Do not paste a whole conversation or assume the history crossed tools.

## Reusable handoffs

**Dot, Chat or Work to Codex:**

```text
In lukasvri/Afterparty-MusicBot, read AGENTS.md, docs/AI_CONTEXT.md and the latest upstream main, then review open related PRs. Goal: [specific outcome]. Acceptance criteria: [observable behavior]. Scope: [files/components]. Target: main for TypeScript fixes and features, dev for isolated Rust experiments, following CONTRIBUTING.md#branch-strategy. Ensure the task branch includes the latest remote main before reviewing or editing code. Refresh main and the target branch again before submission, incorporate newer main and rerun affected checks. Preserve production data, server isolation and compatibility. Implement on a dedicated branch, run relevant checks, open a draft PR and give me the PR link, verification, limitations and next steps.
```

**Codex to Dot, Chat or Work:**

```text
Review the latest main and this Afterparty PR: [link]. Compare changes with AGENTS.md, docs/AI_CONTEXT.md and the stated acceptance criteria. Summarize verified results, unresolved risks, and what should happen next. Do not confuse merged code with deployed code.
```

**Quick start for any new Chat or Work conversation:**

```text
We are working on Afterparty: lukasvri/Afterparty-MusicBot. Read the current AGENTS.md and docs/AI_CONTEXT.md, check the latest main and relevant open PRs, then help with this task: [task].
```

## Known limitations

- Dot may receive shared memories and recent ChatGPT context, but not every task's conversation. Its private task history is not a continuously synchronized repository mirror.
- Product memory may recall decisions but is not a continuously synchronized repository mirror.
- Codex's own thread and workspace state do not automatically become Chat/Work context. GitHub commits, issues, PRs and reviewed project documents bridge that gap.
- Work can access local files only where that access is supported and granted in the desktop app. A cloud task is not permission to deploy.
- Automated tests do not prove real Discord playback quality, live host health or successful production deployment.
