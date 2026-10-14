# Codex Cloud and local deployment

Use the same GitHub repository for local and cloud development. Core continues to
run on your deployment host, where its credentials and databases remain.

## Prepare a cloud environment

1. In Codex, choose **Work in > Cloud > Select environment > Create environment**,
   or **Settings > Codex Cloud > Environments > Create environment**.
2. Select `lukasvri/gutta-krutt-afterparty` and start environment setup.
3. Ask Codex to install **Node.js 24.17+**, npm and **FFmpeg**, then run:

   ```bash
   npm run setup:cloud
   npm run check:all
   ```

   On a Debian/Ubuntu environment, FFmpeg can be installed with
   `sudo apt-get update && sudo apt-get install -y ffmpeg` if sudo is available.
   The setup script fails clearly when Node or FFmpeg is missing.
4. Set the installation command to `npm run setup:cloud`. Dependency installation
   needs access to npm's package registry. Keep environment access private.
5. Leave production secrets and VPN access unconfigured. Do not upload local
   `.env`, `.dev.vars`, `compose.local.yml`, `hosting.local.json`, databases or
   backups. These checks require no Discord, YouTube or deployment credentials.
6. Review successful checks and publish the prepared cloud environment. Start
   tasks from that environment and have changes submitted on a separate branch.

The repository supplies setup and validation commands; it does not create or
publish a Codex Cloud environment automatically. The official procedure is in
[OpenAI's cloud environment guide](https://learn.chatgpt.com/docs/environments/cloud-environments).

Example task:

> Fix the reported queue bug. Follow AGENTS.md, use synthetic data, run
> npm run check:all, and submit the change for review without deploying it.

The check command runs only isolated automated suites. Live integration scripts
such as `smoke.mjs`, `open-rooms.test.mjs` and `discord-transport.test.mjs` require
an explicitly configured test service and are not part of cloud validation.

## Keep existing production configuration local

For an existing installation, keep a full private Compose configuration outside
Git and link it as `services/core/compose.local.yml`. Use an absolute build
context pointing to this checkout's `services/core/`, and preserve the existing
environment file, production `/data` binding and any read-only legacy binding.
`core-control.sh` automatically selects this file; `CORE_COMPOSE_FILE` can select
a different file explicitly. Plain `docker compose` uses the public template,
so use the control script or explicitly pass the private file on existing hosts.

Keep the website's private hosting identity outside Git and link it as
`.openai/hosting.local.json`. Local website builds read it and copy it into the
ignored deployment output. Clean clones build with `.openai/hosting.json`.
Keep `.dev.vars` local as well. Never upload a local deployment archive to a PR.

## Update the local bot after a cloud change

1. Review the branch and successful tests, then merge the chosen change.
2. In the deployment checkout, check `git status` and use `git pull --ff-only`.
   Resolve local changes before updating. Do not reset or overwrite private files.
3. Run `npm run setup:cloud` and `npm run check:all`. For Core changes, also build
   its Docker validation target before deployment.
4. Check current playback. Preserve the current Core image under a rollback tag,
   stop Core cleanly, and back up the **entire** production data directory,
   including `guilds/`, plus the private Compose configuration. Store the backup
   outside Git with restricted permissions.
5. Build a new versioned Core image from this checkout. Set that tag in the
   private Compose file, then run `./services/core/core-control.sh start`.
6. Run `./services/core/core-control.sh status`, check logs and verify the affected
   Discord behavior. Confirm the expected queue and settings survived.

For website-only changes, build and deploy through your own hosting workflow.
For documentation-only changes, a bot restart is unnecessary. Cloud tasks and
GitHub Actions do not deploy the production services automatically.
