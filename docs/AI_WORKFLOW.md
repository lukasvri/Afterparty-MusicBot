# AI collaboration: Chat, Work and Codex

[Documentation](README.md) · [Project context](AI_CONTEXT.md) · [Core instructions](../AGENTS.md) · [Cloud development](CLOUD_DEVELOPMENT.md)

This guide keeps ChatGPT Chat, ChatGPT Work and Codex aligned without assuming that their chat histories are shared. The **current GitHub repository**, its source files and reviewed pull requests are the source of truth, not conversation memory or a stale local checkout.

## Who does what?

| Tool | Best use | Deliverable |
| --- | --- | --- |
| Chat | Questions, explanation, prioritization, design critique, acceptance criteria | A decision or a small task brief |
| Work | Multi-step research, comparison, cross-app investigation, planning and documents | Evidence, an actionable report, or a task brief |
| Codex | Repository inspection, implementation, debugging, tests and code review | A focused branch and draft pull request |

Chat and Work may read the connected GitHub repository when access is enabled. Codex works against the actual selected checkout or cloud environment. **Neither Chat nor Work should claim to know the latest code or live deployment status without checking.** Codex history and Chat/Work histories are separate.

## Set up one ChatGPT project

1. Create a ChatGPT project named **Afterparty**. Set its memory to **Default memory**, not **Project-only memory**, if you want to use Work in the project. Project-only memory currently disables Work there.
2. Move related Chat/Work conversations into the project where useful. Add stable decisions as project sources, but keep the canonical public engineering documentation in GitHub.
3. Use the connected GitHub app for fresh source inspection in Chat/Work. Project files or uploaded copies can become stale and must not override GitHub.
4. In Codex desktop, open the current `Afterparty-MusicBot` checkout. Codex reads the root `AGENTS.md`; consult `docs/AI_CONTEXT.md` for shared project decisions.
5. Keep production credentials and personal data outside the project, prompts, issues, PRs and repository.

Suggested **project instructions** to paste into the ChatGPT project's settings:

```text
Project: Afterparty, repository lukasvri/Afterparty-MusicBot.
For code and product claims, inspect the latest GitHub main and relevant open PRs instead of relying only on prior chat. Read AGENTS.md, docs/AI_CONTEXT.md and relevant source documentation before proposing changes. Treat code, tests and reviewed PRs as evidence; distinguish unverified plans from implemented functionality and deployed functionality. Use Chat for discussions, Work for multi-step research and cross-app deliverables, and Codex for code modifications. Give Codex a scoped task with acceptance criteria rather than assuming chat history is transferred. Never expose secrets or deploy production without explicit authorization and the repository's production checks. Respond to me in Nynorsk, with concise explanations and no em dashes. Public repository documentation stays in English.
```

## Beginning a task

1. Identify the goal, expected behavior, affected area and acceptance criteria. If it is a straightforward implementation, go directly to Codex.
2. Check GitHub `main` and relevant open PRs or issues. Check actual local changes before starting a branch or switching worktrees. Keep a task on a distinct branch based on the latest remote `main`.
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

**Chat or Work to Codex:**

```text
In lukasvri/Afterparty-MusicBot, read AGENTS.md, docs/AI_CONTEXT.md and the latest upstream main, then review open related PRs. Goal: [specific outcome]. Acceptance criteria: [observable behavior]. Scope: [files/components]. Preserve production data, server isolation and compatibility. Implement on a dedicated branch, run relevant checks, open a draft PR and give me the PR link, verification, limitations and next steps.
```

**Codex to Chat or Work:**

```text
Review the latest main and this Afterparty PR: [link]. Compare changes with AGENTS.md, docs/AI_CONTEXT.md and the stated acceptance criteria. Summarize verified results, unresolved risks, and what should happen next. Do not confuse merged code with deployed code.
```

**Quick start for any new Chat or Work conversation:**

```text
We are working on Afterparty: lukasvri/Afterparty-MusicBot. Read the current AGENTS.md and docs/AI_CONTEXT.md, check the latest main and relevant open PRs, then help with this task: [task].
```

## Known limitations

- Product memory may recall decisions but is not a continuously synchronized repository mirror.
- Codex's own thread and workspace state do not automatically become Chat/Work context. GitHub commits, issues, PRs and reviewed project documents bridge that gap.
- Work can access local files only where that access is supported and granted in the desktop app. A cloud task is not permission to deploy.
- Automated tests do not prove real Discord playback quality, live host health or successful production deployment.
