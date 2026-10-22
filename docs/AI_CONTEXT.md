# Shared AI project context

[Documentation](README.md) · [AI workflow](AI_WORKFLOW.md) · [Architecture](ARCHITECTURE.md) · [Branding](BRANDING.md)

This is a **small, durable decision record** for assistants working on Afterparty. It was checked against the repository on **18 October 2026**. Refresh `main`, related PRs and the specific source files before making claims about current implementation. This is not a live deployment dashboard or an exhaustive description of the code.

## Product and identity

- Public product name: **Afterparty**. The website and Discord music bot share this display identity.
- Product direction: a self-hosted Discord music bot, a shared concert/video experience and private browser rooms.
- Visual direction: dark/black background, white lowercase `ap` lettering and a restrained red accent (`#ff263e`). Keep interfaces clean, readable, consistent and professional.
- Preserve the canonical vector logo and core Afterparty identity; existing UI components and old screenshots are references, **not requirements**. The owner grants broad creative control to redesign and replace the private-alpha website UI for a materially better outcome. Prefer a distinctive, coherent design over generic template/AI-looking artwork. A complete rebrand requires a separate owner decision.
- Public documentation is written in English, with no em dashes. Replies to the repository owner use Norwegian Bokmål.
- New website sessions default to English; retain explicit saved language choices. Discord command descriptions, help, controls and standard replies use English. Keep a compact slash menu for playback and discovery, and manage persistent bot settings on the server-scoped administration page. Existing cached command invocations retain compatibility handlers; removed configuration commands link privately to administration. See [command setup](INSTALLATION.md#8-play-your-first-track).

## Architectural boundaries

- GitHub repository: `lukasvri/Afterparty-MusicBot`; normal TypeScript development, fixes and new application features target the latest remote `main` through reviewed PRs.
- `main` remains the stable bot/web line. `beta` retains the v3 and Discord Activity experiments; extract independently tested shared fixes without promoting the Activity SDK, routes, session model or test configuration. See [release channels](RELEASE_CHANNELS.md).
- `dev` is reserved for isolated Rust testing, initially based on the latest `main`. It is not the staging branch for normal features. Existing `nightly` and Rust branches remain separate from `main`; future Rust adoption requires a separate owner decision and review. Follow the [branch strategy](../CONTRIBUTING.md#branch-strategy).
- Rust evaluation is paused at the owner's request on 18 October 2026; [research task #51](https://github.com/lukasvri/Afterparty-MusicBot/issues/51) and [PR #66](https://github.com/lukasvri/Afterparty-MusicBot/pull/66) are closed. Prioritize TypeScript/Node.js and FFmpeg performance and stability. Preserve Rust source, measurements and branch history, and resume Rust work only on an explicit owner request.
- On 21 October 2026, the owner authorized substantial alpha-stage UI improvements and evaluation of SvelteKit/Svelte 5 under [issue #114](https://github.com/lukasvri/Afterparty-MusicBot/issues/114). On 22 October, the owner additionally granted broad creative and implementation discretion for authorized private-alpha website work. Existing layout, component structure and visual patterns may change substantially, without pixel parity, when the resulting product is more usable, polished and maintainable. The proposed stack is not evidence of implementation, merge or deployment. Evaluate stable, compatible language/framework options for actual requirements rather than choosing JavaScript or the newest tool by default; protect Core and data contracts. The approval to redesign does not authorize merging or production operations.
- Website: `app/`, `components/`, `hooks/`, `lib/`; hosted separately from Core.
- Discord audio and room Core: `services/core/src/`. Core drives Discord playback and owns the shared playback clock.
- The site and Core communicate across authenticated HTTPS and do not share a database file. Browser rooms and Discord servers have separate queue, permission and persistence boundaries.
- Keep ordinary Discord playback private. Concert/public state must not leak normal server queues. Preserve queue revision and stale-command safeguards.
- Retain persisted and integration identifiers even when display branding changes. Read [branding compatibility](BRANDING.md#compatibility) before renaming keys, API identifiers, paths or environment variables.
- Live Core settings, secrets, databases, backups and hosting-specific IDs remain outside GitHub and cloud work.

## What counts as verified?

| Claim | Evidence |
| --- | --- |
| Intended feature or accepted design decision | This file or a decision documented in a reviewed issue/PR |
| Feature implemented | Current source and related tests on a named branch/commit |
| Feature merged | Current GitHub `main` |
| Feature deployed and working | Host-side deployment, health and relevant live checks, not a repository commit |
| Work in progress | Open GitHub issues and PRs, checked at the time of the question |

## Technical starting points

- [AGENTS.md](../AGENTS.md): repository-wide instructions, safe cloud tasks, test commands and production boundary.
- [Architecture](ARCHITECTURE.md): service/data boundary, transport and playback responsibilities.
- [Branding](BRANDING.md): logo, design direction, compatibility rules and Discord application settings.
- [Cloud development](CLOUD_DEVELOPMENT.md): fresh checkout, setup, checks and safe local release process.
- [Contributing](../CONTRIBUTING.md): module map and review standards.
- [Changelog](../CHANGELOG.md): generated release notes, **not** proof of deployment.
- [Release policy](RELEASING.md#notes-for-every-change): GitHub tracks every change; website product patch notes include only verified user-relevant changes in a release, with no invented deployment claims.
- [AI collaboration](AI_WORKFLOW.md): using Chat, Codex and GitHub without losing the handoff.

## AI coordination

- **ChatGPT Chat is the owner's primary Afterparty interface and ongoing project coordinator.** The owner discusses new ideas, requirements and decisions with Chat. Chat first carries out its own source-backed investigation, evaluates solutions, defines acceptance criteria and test cases, identifies dependencies and risks, and answers research-only questions without Codex. When code changes or executable validation are needed, Chat sends a precise, evidence-based task to Codex, then reviews the results and follows through on issues, checks, draft PRs and concise updates. Keep analysis proportionate and avoid asking the owner to shuttle routine task context between tools.
- **Dot (Sjefen) is temporarily excluded from the entire active workflow because it is unstable.** Do not use Dot for owner dialogue, research, task routing, handoffs, reviews or follow-up. Resume Dot only after an explicit owner decision. ChatGPT Work remains excluded. Codex implements, debugs and tests repository changes.
- Prefer **GPT-6.1 Sol with High reasoning effort** wherever model and effort selection are supported, including Chat and Codex tasks. Verify the actual available model and effort in the target environment; if unavailable, disclose the fallback and do not claim the preference was enforced. Model requests do not create delegation capabilities.
- Use supported subagents/delegation for independent work when parallel execution helps. Tool availability and permissions, not a Chat model name or Pro selection, determine whether delegation is possible. The lead reviews the combined result; see [delegation controls](AI_WORKFLOW.md#delegation-controls).
- GitHub holds canonical source, issues, PRs, checks and the complete record of technical changes. Chat follows each owner request through the available steps and records status in GitHub rather than relying on shared chat history. Keep code, truthful user-facing product notes when applicable, and validation together in the PR; do not advertise internal-only or planned work in `/patch-notes`. Follow the [release policy](RELEASING.md#notes-for-every-change). Merging, auto-merge, publication and deployment require owner approval; cloud work stops at review material.
- All tools should verify current source and PRs before claiming a feature exists or that a production change has gone live. See [AI collaboration](AI_WORKFLOW.md) for Chat setup, permissions and delegated tasks.

## Active work and uncertainties

Do not maintain an unverified list of `in progress` features here. Inspect [open PRs](https://github.com/lukasvri/Afterparty-MusicBot/pulls) and [issues](https://github.com/lukasvri/Afterparty-MusicBot/issues) directly.

No general claim about the current production bot, website deployment or user-facing audio quality is made here. Automated checks, real FFmpeg tests and browser fixtures are valuable, but live playback, provider availability, host-specific configuration and production rollback require separate verification.

## Keep this file trustworthy

Update only when the owner makes a lasting product decision or a reviewed change alters the architectural/design contract. Cite relevant existing documentation or the PR in the change. For day-to-day progress use issues/PRs rather than duplicating their state in this file. Never include passwords, tokens, private server data, personal information or unverified promises.
