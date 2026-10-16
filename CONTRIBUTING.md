# Contributing to Afterparty

[Project](README.md) · [Documentation](docs/README.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md)

Start with a concrete problem: what happened, how to reproduce it and what you expected. Include the source version and sanitized diagnostic details. Remove credentials, personal Discord IDs and private data from screenshots, issues and pull requests.

## Set up a current checkout

Fork the repository and create a focused branch from the latest upstream `main` for normal development. Rust experiments follow the branch strategy below. Fetch upstream before each new task and recheck the target branch before submitting your PR. Preserve local work when incorporating updates.

Use Node.js 24.17+, Python 3.11+ and FFmpeg. From the repository root:

```bash
npm run setup:cloud
npm run check:all
```

These commands install the locked website and Core dependency trees, run deployment recovery and application tests, typecheck both projects and build the website. Docker is not required for this workflow. For a full local installation with your own test Discord application, follow [installation](docs/INSTALLATION.md). Cloud tasks follow [AGENTS.md](AGENTS.md) and the [cloud workflow](docs/CLOUD_DEVELOPMENT.md).

## Branch strategy

- `main` remains the default branch for active TypeScript development, fixes and new application features. Submit focused task branches as reviewed PRs targeting `main`.
- `dev` is a separate branch for isolated Rust testing, initially created from the latest `main`. It is not a general staging branch for TypeScript features. Keep experiments offline and separate from production accounts, data and deployment.
- For a Rust task, inspect the latest remote `main` and `dev`, create a focused `experiment/rust-*` branch from `dev`, and target its PR at `dev`. Bring current `main` changes into the Rust work when needed, preserving existing work and validating the combined result.
- Keep `nightly` and earlier Rust experiment branches as existing work. Do not merge them into `main` as part of this strategy. Any future adoption of Rust in `main` requires a separate owner decision, focused review and relevant validation; it is not an automatic promotion from `dev` or `nightly`.
- Reserve the exact name `dev`. Do not create `dev/...` branch names, which conflict with it. Use `experiment/rust-*` for focused Rust branches.

## Find the right part of the code

| Area | Location |
| --- | --- |
| Website pages and API routes | `app/` |
| Player and room interface | `components/`, `hooks/` |
| Website permissions, storage and transport | `lib/` |
| D1 schema and migrations | `db/`, `drizzle/` |
| Discord, audio engine and server storage | `services/core/src/` |
| Build and preview integration | `build/`, `scripts/` |
| Installation, operations and design references | `docs/`, `services/core/docs/` |

## Preserve the contracts

- Keep each Discord server's queues, settings, permissions and databases separate. Owner access must not open another server's administration.
- Keep ordinary Discord music out of public concert state. Preserve queue revisions, stale-command checks and the shared playback clock.
- Retain stored-data and protocol compatibility, including the identifiers listed in [branding](docs/BRANDING.md#compatibility).
- Use synthetic credentials and isolated temporary data. Audio changes must pass the real FFmpeg tests. Do not connect production accounts or read production data in cloud validation.
- Keep existing host mounts and private configuration files intact. Production updates happen separately on the deployment host after review and backup.

## Make the change reviewable

Keep the change focused, update the relevant guide and describe the resulting behavior. Public documentation is English. Use TypeScript for new application code and first-party Node tooling; see [TypeScript conventions](docs/TYPESCRIPT.md).

Report the checks you actually ran and anything you could not verify. For playback UI changes, add the relevant local Chromium checks described in the [release review](docs/RELEASE_REVIEW.md#verification). For documentation, check local links, image paths and the rendered layout. `npm run lint` currently has existing failures; report them honestly and do not disable rules to hide them.

Follow the [release policy](docs/RELEASING.md) when preparing a product release. `CHANGELOG.md` is generated from the shared release sources; do not edit it by hand or renumber historical entries. Documentation cleanup alone does not require publishing a release.

## Submit the pull request

Describe the problem, the resulting behavior and the validation. Include before/after images for visible changes and call out remaining uncertainty. Submit cloud work on a separate branch as a draft for review. A PR does not deploy the website or restart Core.

Contributions are submitted under the project's MIT license. Preserve third-party notices. Never commit `.env`, `.dev.vars`, database files, backups, private logs or deployment-specific hosting IDs.
