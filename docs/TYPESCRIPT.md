# TypeScript consolidation

Use TypeScript for new application code and first-party Node tooling. Node.js
24.17 or later executes the scripts directly using native type stripping, so
these tools do not require a second build step or a new runtime dependency.
Use erasable types and explicit `.ts` extensions for local Node imports.

The website and Core use TypeScript 6.0.3. First-party Node utilities, unit and integration tests, and
browser automation are TypeScript. The installer, operational probes and browser
fixtures participate in strict `tsc --noEmit` checks alongside the application.
Core also checks its benchmark sources. Test fixtures use application and
Playwright types; the migration does not add `ts-nocheck` directives or weaken
strict checking. The website checker no longer accepts JavaScript source inputs. The synthetic
Worker transpiler, real toolchain tests and private update-panel controller/model
are also strict TypeScript. The private panel ships precompiled browser assets;
its Python-only host does not need Node or a build tool.

These compatibility and system boundaries remain:

- Python still implements deployment, backup and recovery, with its existing
  failure and active-playback tests. Replacing it needs a dedicated migration
  that preserves the installed command and recovery journal compatibility.
- The bounded native installer and verified-build shell entry points remain
  compatible with existing operators. The small ESLint `.mjs` adapter loads the
  typechecked `eslint.config.ts`. Obsolete framework-specific installers, PostCSS
  loaders and cache/profile shims have been removed.
- The obsolete optional Core dashboard assets and their separate HTTP listener
  have been removed. Administration remains on the website at `/admin`.
- The website theme lives in the root-rendered `AppTheme.svelte` component,
  avoiding duplicate route-level CSS imports. SvelteKit still requires its
  `app.html` document template. The private operations panel retains its small
  HTML/CSS integration fragment for the existing authenticated Python host.
- Shell and Dockerfiles provide existing system/container entry points. Their
  installed command names and the two tiny `.mjs` compatibility loaders remain
  supported; these are not alternate application implementations.

Run `npm run check:all` to validate the website, Core, deployer and production
build. `npm run release:check` checks the shared version and release notes.
GitHub language percentages measure source bytes, not code quality or runtime
performance; generated JavaScript and necessary configuration should not be
hidden just to change those percentages.

The [synchronization and runtime review](SYNC_RUNTIME_REVIEW.md) compares the
current TypeScript/FFmpeg implementation with the isolated Rust PCM experiment,
records a reproducible benchmark and explains the evidence required before
adopting a different audio runtime.
