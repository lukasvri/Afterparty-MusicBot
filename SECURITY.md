# Security

Do not publish credentials, private logs or exploit details in public issues. Use GitHub's private vulnerability reporting under **Security** if available. Otherwise, open an issue that only asks the maintainer for a private contact channel.

## If a credential is exposed

Revoke it with the provider and generate a replacement. Update the affected service and recreate or redeploy it. Removing the file from the latest commit does not remove the credential from Git history.

## Deployment basics

Use a separate random bridge secret, HTTPS between the website and Core, and the loopback port binding provided in Compose. Public state must not expose Discord member information. Back up consistently before upgrades and keep backups and environment files outside Git.

The [configuration reference](docs/CONFIGURATION.md) explains which values belong in each service.

## Dependency scan scope

The native website uses SvelteKit-generated script/style nonces, blocks framing
and plugins, and limits browser connections to its own host, the configured HTTPS
Core origin (plus its WebSocket origin), and the validated optional Sentry
ingestion origin. YouTube scripts/frames and HTTPS media/artwork remain allowed.
Element style attributes remain enabled for player geometry and transitions.
Responses add nosniff, a referrer policy, device permission restrictions and
host-scoped HSTS on HTTPS only, without includeSubDomains or preload.

Validate the production preview's public, login, room and playback journeys
before promoting a release. A source change or local fixture does not verify
the installed host or audible Discord playback.

Install both locked dependency trees, at the repository root and in `services/core`,
when checking dependency advisories. Root npm overrides do not apply to Core
when it is installed as a separate project.

A clean dependency audit does not establish that all bundled code is patched.
Wrangler distributes a prebuilt CLI bundle with embedded libraries; npm overrides
replace separately installed modules but cannot rewrite these embedded copies.
Review upstream security fixes and bundled dependency versions when changing the
Cloudflare toolchain. Do not treat cleared Dependabot alerts as proof that all
upstream tooling vulnerabilities have been resolved.
