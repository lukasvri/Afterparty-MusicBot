# Afterparty development

Read `AGENTS.md` and the relevant project guide before changing source. Use
English for code and public documentation, Norwegian Bokmål for owner updates,
and no em dashes.

- Keep website source, Core (`services/core`) and the opt-in SvelteKit candidate
  (`apps/web`) within their existing contracts. OpenWorks is a separate project.
- Preserve per-server authorization, queues, settings and databases. Owner access
  never grants access to another server. Ordinary Discord music stays private.
- Preserve queue revisions, stale-command protection and the shared playback
  clock. Recovery must respect the latest user intent.
- Use synthetic fixtures and isolated local storage. Never read production data,
  connect a real Discord account, copy secrets, deploy or start the production bot.
- Run focused tests while editing. Use `npm run check:all` for full validation
  and affected browser suites for UI/playback changes. Report checks actually run.
- Follow `docs/RELEASING.md`: development tooling belongs in PR notes, not public
  patch notes. Submit a focused draft PR; merging and production actions require
  explicit owner approval.
