# Shared AI project context

[Documentation](README.md) · [AI workflow](AI_WORKFLOW.md) · [Architecture](ARCHITECTURE.md) · [Branding](BRANDING.md)

This is a **small, durable decision record** for assistants working on Afterparty. It was checked against the repository on **18 October 2026**. Refresh `main`, related PRs and the specific source files before making claims about current implementation. This is not a live deployment dashboard or an exhaustive description of the code.

## Product and identity

- Public product name: **Afterparty**. The website and Discord music bot share this display identity.
- Product direction: a self-hosted Discord music bot, a shared concert/video experience and private browser rooms.
- Visual direction: dark/black background, white lowercase `ap` lettering and a restrained red accent (`#ff263e`). Keep interfaces clean, readable, consistent and professional.
- Reuse the canonical vector logo and existing UI components. Do not recreate the brand from old discussion screenshots or replace it with photorealistic/AI-looking artwork.
- Public documentation is written in English, with no em dashes. Replies to the repository owner can be in Nynorsk.
- New website sessions default to English; retain explicit saved language choices. Discord command descriptions, help, controls and standard replies use English. Keep a compact slash menu for playback and discovery, and manage persistent bot settings on the server-scoped administration page. Existing cached command invocations retain compatibility handlers; removed configuration commands link privately to administration. See [command setup](INSTALLATION.md#8-play-your-first-track).

## Architectural boundaries

- GitHub repository: `lukasvri/Afterparty-MusicBot`; normal TypeScript development, fixes and new application features target the latest remote `main` through reviewed PRs.
- `dev` is reserved for isolated Rust testing, initially based on the latest `main`. It is not the staging branch for normal features. Existing `nightly` and Rust branches remain separate from `main`; future Rust adoption requires a separate owner decision and review. Follow the [branch strategy](../CONTRIBUTING.md#branch-strategy).
- Rust evaluation is paused at the owner's request on 18 October 2026; [research task #51](https://github.com/lukasvri/Afterparty-MusicBot/issues/51) and [PR #66](https://github.com/lukasvri/Afterparty-MusicBot/pull/66) are closed. Prioritize TypeScript/Node.js and FFmpeg performance and stability. Preserve Rust source, measurements and branch history, and resume Rust work only on an explicit owner request.
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
- [Release policy](RELEASING.md#notes-for-every-change): notes required in each code or user-facing PR, the shared release source, website checks and documentation/experiment handling.
- [AI collaboration](AI_WORKFLOW.md): using Dot, Chat, Work and Codex without losing the handoff.

## AI coordination

- The personal dot is the proposed ongoing coordinator for planning and follow-up, not an authority for unreviewed code merges or live deployment.
- Chat provides interactive decisions, Work handles broader multi-step research and app work, and Codex implements and validates repository changes.
- For ordinary owner-facing project planning in Chat, prefer **GPT-6.1 Sol with High reasoning** when that option is available. Reserve Pro for unusually demanding architecture and technical evaluations. This is a model preference for Chat, not a Dot model setting or a guarantee of tools, subagents or access.
- Use supported subagents/delegation for independent work when parallel execution helps. Tool availability and permissions, not a Chat model name or Pro selection, determine whether delegation is possible. The lead reviews the combined result; see [delegation controls](AI_WORKFLOW.md#delegation-controls).
- GitHub holds canonical source, issues, PRs, checks and release records. Keep code, user-facing notes and validation together in the PR, following the [release policy](RELEASING.md#notes-for-every-change). Merging, auto-merge, publication and deployment require owner approval; cloud work stops at review material.
- All tools should verify current source and PRs before claiming a feature exists or that a production change has gone live. See [AI collaboration](AI_WORKFLOW.md) for Dot setup, permissions and delegated tasks.

## Active work and uncertainties

Do not maintain an unverified list of `in progress` features here. Inspect [open PRs](https://github.com/lukasvri/Afterparty-MusicBot/pulls) and [issues](https://github.com/lukasvri/Afterparty-MusicBot/issues) directly.

No general claim about the current production bot, website deployment or user-facing audio quality is made here. Automated checks, real FFmpeg tests and browser fixtures are valuable, but live playback, provider availability, host-specific configuration and production rollback require separate verification.

## Keep this file trustworthy

Update only when the owner makes a lasting product decision or a reviewed change alters the architectural/design contract. Cite relevant existing documentation or the PR in the change. For day-to-day progress use issues/PRs rather than duplicating their state in this file. Never include passwords, tokens, private server data, personal information or unverified promises.
