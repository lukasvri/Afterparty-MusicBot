# TypeScript consolidation

Use TypeScript for new application code and first-party Node tooling. Node.js
24.17 or later executes the scripts directly using native type stripping, so
these tools do not require a second build step or a new runtime dependency.
Use erasable types and explicit `.ts` extensions for local Node imports.

The release utility, project command, execution-profile reader, framework launcher,
preview environment setup, and the audio preferences, native seek, playback sync,
compatibility and release tests are now TypeScript. They participate in the same
strict `tsc --noEmit` check as the website. Test fixtures use application types;
the migration does not disable strict checking or add `ts-nocheck` directives.

This is an incremental consolidation, not a complete language replacement:

- Python still implements deployment, backup and recovery, with its existing
  failure and active-playback tests. Replacing it needs a dedicated migration
  that preserves the installed command and recovery journal compatibility.
- Browser automation, SQLite/D1 integration fixtures and some bootstrap/config
  scripts remain JavaScript. Migrate them with typed boundaries when changing
  those tools, rather than hiding their errors with unchecked casts.
- CSS describes presentation. Shell and Dockerfiles provide system and container
  entry points. They remain appropriate for those jobs.

Run `npm run check:all` to validate the website, Core, deployer and production
build. `npm run release:check` checks the shared version and release notes.
GitHub language percentages measure source bytes, not code quality or runtime
performance; generated JavaScript and necessary configuration should not be
hidden just to change those percentages.
