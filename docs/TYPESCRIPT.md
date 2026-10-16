# TypeScript consolidation

Use TypeScript for new application code and first-party Node tooling. Node.js
24.17 or later executes the scripts directly using native type stripping, so
these tools do not require a second build step or a new runtime dependency.
Use erasable types and explicit `.ts` extensions for local Node imports.

The website, Core, first-party Node utilities, unit and integration tests, and
browser automation are TypeScript. The installer, operational probes and browser
fixtures participate in strict `tsc --noEmit` checks alongside the application.
Core also checks its benchmark sources. Test fixtures use application and
Playwright types; the migration does not add `ts-nocheck` directives or weaken
strict checking. The website checker no longer accepts JavaScript source inputs.

These compatibility and system boundaries remain:

- Python still implements deployment, backup and recovery, with its existing
  failure and active-playback tests. Replacing it needs a dedicated migration
  that preserves the installed command and recovery journal compatibility.
- Two small JavaScript installer entry points forward to their TypeScript
  implementations for callers using the previous paths. ESLint and PostCSS
  retain their conventional JavaScript configuration adapters.
- The inactive legacy Core dashboard asset in `services/core/public/app.js`
  remains unchanged. It is not an active application source or included in the
  current Core image; rebuilding that retired dashboard is outside this change.
- CSS describes presentation. Shell and Dockerfiles provide system and container
  entry points. They remain appropriate for those jobs.

Run `npm run check:all` to validate the website, Core, deployer and production
build. `npm run release:check` checks the shared version and release notes.
GitHub language percentages measure source bytes, not code quality or runtime
performance; generated JavaScript and necessary configuration should not be
hidden just to change those percentages.

The [synchronization and runtime review](SYNC_RUNTIME_REVIEW.md) compares the
current TypeScript/FFmpeg implementation with the isolated Rust PCM experiment,
records a reproducible benchmark and explains the evidence required before
adopting a different audio runtime.
