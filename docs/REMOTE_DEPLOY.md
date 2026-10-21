# Deploy Core from another computer

`deploy-core` runs on the bot host. Your main computer only requests an update
over private SSH through Tailscale. Credentials, databases, logs and backups stay
on the bot host. Tests and production builds run once in GitHub Actions.

## What the command does

1. Acquires a deployment lock and requires a healthy bot and matching private
   data bindings. Music continues during validation and builds.
2. Fetches `origin/main` and exports tracked source into a temporary directory.
   Local edits, staged files, untracked files and ignored configuration are not
   exported or mounted in tests. The working branch and local files stay unchanged.
   If a production commit is recorded, the fetched commit must descend from it.
3. Requires the exact commit's successful canonical main-push workflow, including
   the Core, website, deployer and release jobs. Downloads its commit-addressed
   build assets and verifies GitHub's asset digests, the manifest, image ID,
   revision label, platform and runtime user. There is no local source-build or
   test fallback when CI or assets are missing.
4. Imports the tested image and runs a short, unprivileged, read-only runtime
   probe with no network, secrets or production data. The probe is limited to
   256 MiB RAM, no swap and half a CPU. Start requires 1024 MiB available memory;
   a guard requires a healthy existing Core and 512 MiB remaining memory.
   Automatically pauses
   active playback on each server immediately before the switch, then stops
   Core and backs up the entire data tree,
   including `guilds/`, private Compose configuration and referenced environment files.
5. Verifies the backup, selects the new image in the private Compose file and
   starts it. Checks Discord readiness, Docker health, queue recovery, the actual
   running image and SQLite integrity.
   Resumes only the tracks this deployment paused; manually paused servers stay paused.
6. If startup or post-start checks fail, stops the candidate, restores the
   pre-update data and exact previous image, and checks recovery. Candidate data
   is retained locally in a `data.failed-*` directory for investigation.
   Restores automatically paused playback after successful recovery as well.

Backups, failed data and old images are retained until you deliberately remove
ones you no longer need. Check disk space before a large update. No cleanup
command deletes production volumes automatically. The source checkout is never
fast-forwarded or reset; `--status` records the running version.

The deployment only handles Core. It also verifies and caches the matching
compiled website for the host's separate Sites coordinator. That coordinator
must preserve the compiled bytes and use the supported Sites source/package
workflow with no remaining build commands. Only the project identity in the
source and generated hosting manifests is bound locally; application code and
storage bindings remain exactly those checked by CI.
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

`--check` verifies/downloads the GitHub build, imports the image and runs the
isolated runtime probe without stopping or updating production. It does not
install dependencies, run the full test suite, create a backup of live databases,
or publish the website. A consistent backup is still taken immediately before a
real switch, as described above.
A normal deployment skips the restart if its recorded commit and actual running
image already match. `--redeploy` explicitly repeats deployment of the same commit.
An already current deployment and `--check` do not pause music. Actual updates
and `--redeploy` pause active playback only after validation and building finish,
then resume it after the new bot is healthy or the previous bot is recovered.
If someone changes the track, disconnects, or sends a newer transport command
through the website during this interval, automatic resume leaves that server
unchanged. The final idle check still aborts safely if playback restarts before
Core can be stopped.

A private `playback-resume.json` journal in the deployment state directory records
opaque server and track hashes plus idempotent command IDs before pausing. It
contains no credentials or Discord IDs. Partial failures retain only unresolved
servers; the next normal run retries recovery before starting another update.
`--check` refuses pending recovery without changing playback. Keep the journal
if the bot cannot become healthy; resume recovery requires a healthy Core.
Playback recovery failure reports an error even if the image update succeeded.

Progress is printed to the SSH session; full logs and deployment records remain
in the configured private state directory. The deployer ignores SSH hangup signals
and keeps child output in local log files, but host shutdown or a forced process
kill can still interrupt it. Reconnect and inspect `--status` before retrying.
If recovery itself fails, keep the backup and inspect locally before any further
update. Do not run `docker compose down -v`.

## Build availability and first rollout

The release job runs only after all three CI validation jobs succeed on a push
to canonical main. It publishes a prerelease named `build-<full commit SHA>`
containing `core-image.tar.gz`, `website.tar.gz` and `release.json`. These are
public, secret-free build assets, not a production deployment or an application
release announcement. The release is excluded from GitHub's latest-release
selection. Published assets are never overwritten by this workflow.

Pull requests run validation and upload temporary workflow artifacts, but do not
publish build releases or deploy anything. A host needs no GitHub token to read
the public build releases. Missing assets, failed/pending CI, wrong revisions,
partial job results and checksum failures stop before playback or Core is touched.
Incomplete draft build releases require review rather than automatic replacement.

After merging this workflow change, wait for its first main-push run and build
release to succeed. Older commits have no reusable build assets and are
deliberately unavailable to the new update path. Reinstall all three pinned
deployer files together. For development changes, `npm run setup:cloud` followed
by `npm run check:all` remains the full validation workflow; production hosts do
not repeat it.
