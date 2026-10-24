# Student development tools

## Open an isolated Afterparty environment

On this repository's review branch, choose **Code > Codespaces > New with options**.
Review billing, then select a small machine (start with 2 cores). This consumes
account quota. The `.devcontainer` configuration uses the maintained Node 24
Bookworm image, Python 3.11 and FFmpeg. The existing `npm run setup:cloud`
command installs all three locked dependency trees, including `apps/web`.
Installation failures stop setup; servers and tests do not start automatically.

Run the commands you need in the Codespace terminal:

```sh
node --version
python3 --version
ffmpeg -version
npm run check:all
npm run dev
```

For the optional SvelteKit candidate, follow [Run locally](SVELTEKIT_MIGRATION.md#run-locally):
build the existing website, start its local API on port 8787 with synthetic
storage, then build and preview the candidate on port 5174. `npm run dev:web`
provides HMR only after that API is available; `npm run dev` on port 5173 does
not supply it. Open `/v3` on the candidate's forwarded port. Keep the API on
loopback, without forwarding it publicly.

Node must meet the repository's 24.17+ minimum. The image follows maintained
Node 24 updates rather than locking an obsolete patch. Rebuild the environment
to pick up image changes.

Use the forwarded port 5173 for the existing website or 5174 for the SvelteKit
candidate. Keep their visibility **Private** in the Ports panel. Other ports
are not automatically forwarded by this configuration. Codespaces defaults
forwarded ports to private; repository labels do not lock that account setting.

Do not import production secrets, host configuration, databases or private
network access. Use the existing synthetic tests. Core is not started. A cloud
preview does not establish Discord OAuth, audible playback or production health.
The Docker build context contains only the Dockerfile, not the repository or
local private files. Keep OpenWorks in a separate environment.

## Student benefits and account setup

The owner confirmed that the Student Developer Pack is active on 24 October
2026. Individual partner subscriptions and remaining account quotas have not
been independently verified.

| Benefit | Use here | Status |
| --- | --- | --- |
| GitHub Pro / Codespaces | Isolated development and validation | Repository configuration prepared; no cloud environment started |
| Copilot Student | Code completion and repository-aware assistance | Instructions prepared; subscription activation not verified |
| Codecov | Compare test coverage in pull requests | Deferred until coverage reports and repository access are deliberately configured |
| Polypane | Responsive and accessibility review | Optional one-year student offer; license and installation not activated |
| Sentry | Runtime error investigation | Deferred pending a concrete need, data filtering and separate service approval |

See the current [Student Developer Pack](https://education.github.com/pack)
before redeeming an offer. Availability, eligibility and renewal terms can change.
OpenWorks remains a static portal without analytics or a monitoring SDK.

Codespaces compute and storage are shared across your personal account, including
both repositories. GitHub Pro currently includes 180 core-hours and 20 GB-month
of storage monthly, not 180 hours on every machine. A 2-core machine uses two
core-hours per active hour. Check your actual
[usage and billing](https://github.com/settings/billing) before creating one.
Keep paid overage blocked using your account's budget controls. Stop idle
environments and delete unused ones after saving work; stopped environments
still consume storage. Custom development images also consume storage. This
configuration does not create prebuilds or change spending settings.

## Copilot

If needed, [activate Copilot Student](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students)
on the same verified GitHub account. Sign in to that account in your editor and
use the repository's `.github/copilot-instructions.md`. These instructions guide
assistance; they do not enforce permissions or replace review and tests. No
extension or subscription is installed or enabled by these source changes.

## Other offers

Keep existing Cloudflare hosting and independent project credentials. Cloud
credits, new domains and replacement databases are not needed for this setup.
Do not start time-limited trials merely to reserve them. Codecov requires real
coverage instrumentation; adding an upload step without a report is not an
integration. Sentry would need a separate review of outbound data and quotas.

## Verification boundary

Configuration and documentation can be reviewed locally. A successful image
build, dependency installation, private browser preview and test run in a real
Codespace are still required to establish that the cloud environment works.
No Codespace, partner account, service authorization or production deployment
is created by this change.

References: [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces),
[included usage](https://docs.github.com/en/codespaces/troubleshooting/troubleshooting-included-usage),
[port security](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces).
