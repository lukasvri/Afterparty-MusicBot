# Security

Do not publish credentials, private logs or exploit details in public issues. Use GitHub's private vulnerability reporting under **Security** if available. Otherwise, open an issue that only asks the maintainer for a private contact channel.

## If a credential is exposed

Revoke it with the provider and generate a replacement. Update the affected service and recreate or redeploy it. Removing the file from the latest commit does not remove the credential from Git history.

## Deployment basics

Use a separate random bridge secret, HTTPS between the website and Core, and the loopback port binding provided in Compose. Public state must not expose Discord member information. Back up consistently before upgrades and keep backups and environment files outside Git.

The [configuration reference](docs/CONFIGURATION.md) explains which values belong in each service.
