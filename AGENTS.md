# Working on Afterparty

This repository is the source of truth for the website and Core. Write public
documentation in English. Do not use em dashes.

## Development and validation

- Use Node.js 24.17+, Python 3.11+ and FFmpeg. Run `npm run setup:cloud` to install both locked
  dependency trees, then `npm run check:all` for website typechecks, browser
  behavior tests, deployer recovery tests, Core typechecks and tests including real audio, and a website
  production build. Docker is not required for these checks.
- Core lives in `services/core/src/`; the website is in `app/`, `components/`,
  `hooks/` and `lib/`. Preserve third-party license notices.
- Keep changes focused and report the checks actually run and any limitations.
- Preserve per-server queues, settings, permissions and databases. Owner access
  must not grant access to another server.
- Ordinary Discord music stays out of the public concert feed. Preserve queue
  revisions, stale-command protection and the shared playback clock.
- Use synthetic credentials and isolated temporary data in tests. Automated
  audio tests do not establish what a person hears in a Discord voice channel.

## Local production boundary

- Never commit or upload credentials, `.env`, `.dev.vars`, databases, backups,
  personal Discord IDs, private logs or deployment-specific hosting IDs.
- `services/core/compose.yml` and `.openai/hosting.json` are public templates.
  Existing hosts can select an ignored `services/core/compose.local.yml` through
  `core-control.sh`, and an ignored `.openai/hosting.local.json` for local builds.
  Preserve existing mounts and environment-file references on the deployment host.
- Cloud tasks edit and test source code only. Do not start the production bot,
  connect a real Discord account, access production data, deploy a website, or
  configure automatic deployment from a cloud task.
- Submit cloud changes on a separate branch for review. Production updates happen
  locally after validation, a complete backup and a check of active playback.
  Never use `docker compose down -v` during an update.

See [Cloud workflow](docs/CODEX_CLOUD.md) and [operations](services/core/PUBLIC_RELEASE.md).
