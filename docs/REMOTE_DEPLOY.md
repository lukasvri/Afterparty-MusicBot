# Deploy Core from another computer

`deploy-core` runs on the bot host. Your main computer only requests an update
over private SSH through Tailscale. Credentials, databases, test execution,
images, logs and backups stay on the bot host.

## What the command does

1. Acquires a deployment lock and requires a healthy bot, a clean `main` checkout
   and matching private data bindings. Playback must be paused on every server.
2. Fetches `origin/main` and exports tracked source into a temporary directory.
   Ignored local configuration and credentials are not exported or mounted in tests.
3. Builds Core's validation image, reruns its tests with networking disabled,
   then runs deployer tests, website typechecks, behavior tests and a production
   website build. Only dependency installation has network access after the
   validation image is built. Tests use synthetic data.
4. Builds a production image tagged with the Git commit. Checks playback again,
   fast-forwards the checkout, then stops Core and backs up the entire data tree,
   including `guilds/`, private Compose configuration and referenced environment files.
5. Verifies the backup, selects the new image in the private Compose file and
   starts it. Checks Discord readiness, Docker health, queue recovery, the actual
   running image and SQLite integrity.
6. If startup or post-start checks fail, stops the candidate, restores the
   pre-update data and exact previous image, and checks recovery. Candidate data
   is retained locally in a `data.failed-*` directory for investigation.

Backups, failed data and old images are retained until you deliberately remove
ones you no longer need. Check disk space before a large update. No cleanup
command deletes production volumes automatically. A failed update can leave the
source checkout at the fetched commit; `--status` records the running version.

The deployment only handles Core. Website builds are validation, not publication.
Automated tests and readiness checks do not replace listening in a real voice channel.

## One-time setup on the bot host

Requirements: Linux, Python 3.11+, Git, Docker with Compose, and Docker access for
an ordinary deployment user who owns the production data. This initial version
supports one Core service with a host bind mount at `/data`.

1. Keep the production Compose file, referenced environment files and data
   outside the Git checkout. Preserve existing paths; do not copy them into Git.
2. Copy [the example configuration](deploy-core.example.json) to a private
   directory outside Git. Fill in your host's existing paths and use mode `600`.
   The example paths are placeholders, not a data migration instruction.
3. Review and install the deployer from the repository:

   ```bash
   python3 scripts/install-deploy-core.py --config /absolute/private/deploy.json
   ~/.local/bin/deploy-core --status
   ~/.local/bin/deploy-core --check
   ```

   Installation stores a pinned copy of the deployer outside Git. A future
   deployment does not silently replace the installed deployment tool.
   Reinstall after reviewing changes to the deployer itself.
4. Configure private SSH over Tailscale. Permit only the intended main computer
   to the bot computer on TCP port 22 and only the intended non-root host user.
   Inspect existing rules as well: adding a narrow allow rule does not restrict
   a broader existing allow rule. Preserve unrelated network access.
5. After the policy is reviewed, enable Tailscale SSH on the bot host with
   `sudo tailscale set --ssh`. Authenticate any check-mode prompt locally through
   your browser. Do not share account passwords, private SSH keys or bot tokens.

See [Tailscale's SSH guide](https://tailscale.com/docs/features/tailscale-ssh).
SSH activation and policy changes are separate from installing this tool.

## Everyday use from your main computer

These commands work with an SSH client, including Windows PowerShell. Replace
`YOUR_USER` and `BOT_TAILSCALE_NAME` with your private deployment account and host.

```powershell
ssh YOUR_USER@BOT_TAILSCALE_NAME '~/.local/bin/deploy-core --status'
ssh YOUR_USER@BOT_TAILSCALE_NAME '~/.local/bin/deploy-core --check'
ssh YOUR_USER@BOT_TAILSCALE_NAME '~/.local/bin/deploy-core'
```

First review and merge the desired GitHub pull request. The default command
updates only to `origin/main`. It does not merge PRs, deploy arbitrary branches,
or need a copy of the bot's credentials on the main computer.

`--check` runs tests and builds without stopping or updating production.
A normal deployment skips the restart if its recorded commit and actual running
image already match. `--redeploy` explicitly repeats deployment of the same commit.
If music is playing or buffering, pause it on all servers and retry.

Progress is printed to the SSH session; full logs and deployment records remain
in the configured private state directory. The deployer ignores SSH hangup signals
and keeps child output in local log files, but host shutdown or a forced process
kill can still interrupt it. Reconnect and inspect `--status` before retrying.
If recovery itself fails, keep the backup and inspect locally before any further
update. Do not run `docker compose down -v`.
