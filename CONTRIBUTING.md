# Contributing to Afterparty

[Project](README.md) · [Documentation](docs/README.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md)

Start with a concrete problem: what happened, how to reproduce it and what you expected. Include the source version and sanitized diagnostic details. Remove credentials, personal Discord IDs and private data from screenshots, issues and pull requests.

## Set up a current checkout

Fork the repository and create a focused branch from the latest upstream `main` for normal development. Rust experiments follow the branch strategy below. Before reviewing or editing code, fetch upstream and ensure the working branch includes the latest remote `main`. Before submitting your PR, fetch `main` and the target branch again, incorporate any newer `main` and rerun affected checks. Preserve local work when incorporating updates.

Use Node.js 24.17+, Python 3.11+ and FFmpeg. From the repository root:

```bash
npm run setup:cloud
npm run check:all
```

These commands install the locked website and Core dependency trees, run deployment recovery and application tests, typecheck both projects and build the website. Docker is not required for this workflow. For a full local installation with your own test Discord application, follow [installation](docs/INSTALLATION.md). Cloud tasks follow [AGENTS.md](AGENTS.md) and the [cloud workflow](docs/CLOUD_DEVELOPMENT.md).

## Branch strategy

- `main` remains the default branch for active TypeScript development, fixes and new application features. Submit focused task branches as reviewed PRs targeting `main`.
- `dev` is a separate branch for isolated Rust testing, initially created from the latest `main`. It is not a general staging branch for TypeScript features. Keep experiments offline and separate from production accounts, data and deployment.
- For a Rust task, fetch the latest remote `main` and `dev`, create a focused `experiment/rust-*` branch from `dev`, and incorporate the latest `main` into the task branch before reviewing or editing code. Before submitting the PR to `dev`, fetch both branches again, incorporate any newer `main` and rerun affected checks on the combined result. Preserve existing Rust work when incorporating updates.
- Keep `nightly` and earlier Rust experiment branches as existing work. Do not merge them into `main` as part of this strategy. Any future adoption of Rust in `main` requires a separate owner decision, focused review and relevant validation; it is not an automatic promotion from `dev` or `nightly`.
- Reserve the exact name `dev`. Do not create `dev/...` branch names, which conflict with it. Use `experiment/rust-*` for focused Rust branches.

## Find the right part of the code

| Area | Location |
| --- | --- |
| Website pages and API routes | `app/` |
| v3 routes and feature modules | `apps/web/src/routes/`, `apps/web/src/lib/{rooms,concert,games,library,social,admin,server,ui}/` |
| Shared settings and social contracts | `services/core/src/settings.ts`, `services/core/src/social-protocol.ts` |
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

Apply the [source organization rules](AGENTS.md#keep-every-change-organized) to every change: reuse canonical definitions, keep related feature code together, remove verified duplication and update the source map when ownership changes.

Keep the change focused, update the relevant guide and describe the resulting behavior. Public documentation is English. Use TypeScript for new application code and first-party Node tooling; see [TypeScript conventions](docs/TYPESCRIPT.md).

Report the checks you actually ran and anything you could not verify. For playback UI changes, add the relevant local Chromium checks described in the [release review](docs/RELEASE_REVIEW.md#verification). For documentation, check local links, image paths and the rendered layout. Run lint with zero warnings for code changes; report failures honestly and do not disable rules to hide them.

Include and update release/patch notes for every code or user-facing change in the same PR, following [notes for every change](docs/RELEASING.md#notes-for-every-change). Use the existing shared release source and verify relevant website patch notes. `CHANGELOG.md` is generated; do not edit it by hand or renumber historical entries. Internal documentation-only changes record their impact in the PR without a product release. Isolated Rust experiments targeting `dev` carry experimental notes in their PR until separately approved for product adoption.

## Submit the pull request

Describe the problem, the resulting behavior and the validation. Include before/after images for visible changes and call out remaining uncertainty. Submit cloud work on a separate branch as a draft for review. A PR does not deploy the website or restart Core.

State the release-note source, website relevance and version decision in the PR.
Require owner approval before merging, enabling auto-merge, publishing or deploying.

Contributions are submitted under the project's MIT license. Preserve third-party notices. Never commit `.env`, `.dev.vars`, database files, backups, private logs or deployment-specific hosting IDs.
