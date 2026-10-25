# Cloud development and local deployment

[Documentation](README.md) · [Contributing](../CONTRIBUTING.md)

Use the same GitHub repository for local and cloud development. Core continues to run on the deployment host, where its credentials and databases remain. The website remains part of this repository and keeps its existing hosting build output.

## Prepare a development environment

Use an isolated checkout of `lukasvri/Afterparty-MusicBot` with Node.js 24.17+, npm, Python 3.11+ and FFmpeg. Keep environment access private. From the repository root:

```bash
npm run setup:cloud
npm run check:all
```

Dependency installation requires access to npm's registry. These checks require no Discord, YouTube or deployment credentials. Use `npm run setup:cloud` as the environment setup command, then start source tasks on a separate branch.

Keep production secrets and private-network access outside the environment. Do not upload local `.env`, `.dev.vars`, `compose.local.yml`, `hosting.local.json`, databases, backups or deployment archives. Fetch the latest upstream `main` before each new task and preserve local work when incorporating updates.

The check command runs isolated automated suites. Integration scripts such as `smoke.ts`, `open-rooms.test.ts` and `discord-transport.test.ts` require an explicitly configured test service. They are not production release evidence from cloud validation.

## CI validation timing and failures

`npm run test:browser` runs at most two browser test files concurrently. Tests
within each file keep their existing sequencing and isolated fixtures. The CI
website job supervises its local preview and validation process groups; a preview
exit fails validation immediately, and failure/cancellation retires both trees.
Failure artifacts retain the preview output and Wrangler diagnostic log.

Coverage requires FFmpeg, reuses downloaded packages through APT checksum
verification, checks an existing executable first, and bounds package installation to three minutes with short download timeouts. A missing or broken
installation still fails the job. Core packaging uses gzip level 1 while keeping
the saved image bytes, runtime probe, archive validation and signed digest checks.
See the [measured validation review](OPTIMIZATION_REVIEW.md#ci-validation-time-2026-10-26)
for baseline timings and the compression size tradeoff. CI-only changes do not
belong in public product patch notes.

## Keep existing configuration local

For an existing installation, keep its private Compose configuration outside Git and link it as `services/core/compose.local.yml`. Preserve the existing build context, environment file, production `/data` binding and any read-only legacy binding. `core-control.sh` automatically selects this file; `CORE_COMPOSE_FILE` can select another file explicitly. Plain `docker compose` uses the public template, so use the control script or explicitly pass the private file on an existing host.

Keep the website's private hosting identity outside Git and retain its existing `hosting.local.json` link. The build copies that selected configuration and D1 migrations into the deployment output required by the current host. Clean clones use the public binding template. `.dev.vars` remains local. Removing platform presentation does not change the live website address or deployment contract.

## Update after review

For host-side validation, backups and recovery, see [remote deployment](REMOTE_DEPLOY.md). Production changes happen locally after review and backup.

1. Review the branch and successful checks, then merge the chosen change.
2. On the deployment checkout, run `git status` and `git pull --ff-only`. Preserve private files and resolve local changes before updating.
3. Run `npm run setup:cloud` and `npm run check:all`. For Core changes, also build its Docker validation target.
4. Check active playback, preserve the running image for rollback and take a verified backup of the complete data directory, including `guilds/`, and private configuration. See [operations](../services/core/PUBLIC_RELEASE.md).
5. Build and start the reviewed Core image using the existing private Compose configuration. Verify health, queue persistence and the affected Discord behavior.

Website-only changes use the existing website hosting workflow and do not require a bot restart. Verify sign-in and browser playback after deployment. This source workflow does not deploy services or configure automatic deployment.

## Authentication for the website

Administration uses Discord OAuth or the optional owner-password fallback. Hosting account identity does not grant access. Existing installations that used only hosting identity must configure and verify one of those methods before updating. Keep the website origin and Discord OAuth redirect unchanged unless a separate domain migration is planned.
