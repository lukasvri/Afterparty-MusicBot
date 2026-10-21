# GitHub validation and tested builds

The canonical `.github/workflows/core.yml` validates pull requests and every
`main` push. It does not deploy Core or the website. Production updates remain a
separate owner-approved local operation.

## Checks and artifacts

- `deployer` runs the Python failure, recovery and release-verification tests.
- `core` builds the final Linux amd64 image through the Dockerfile's validation
  stage, reuses GitHub Actions build-cache layers, then probes and packages that
  exact loaded image. Packaging does not rebuild it or connect to Discord.
- `website` runs lint, typechecks, application tests and the production build,
  then packages that existing build output.
- `release` runs only after all three jobs succeed on canonical `main`. It signs
  the manifest and both payload digests and publishes commit-addressed build
  assets. It is intentionally skipped on PRs and must not be a required PR check.

The job names and workflow path are part of the host's provenance policy. Keep
these identities stable or update and test that policy in the same reviewed
change. Archive names, signed subjects and manifest fields are also contracts.

Actions use full commit SHAs and Node.js 24 runtimes. Jobs use `ubuntu-24.04` so a
change to `ubuntu-latest` does not silently change the build environment. Ordinary
jobs get read-only repository access; only `release` receives the write and OIDC
permissions needed for publication and attestation. Checkout does not retain
credentials. New PR commits cancel older runs for that PR; main push runs are
not canceled by a later push.

Temporary workflow artifacts expire after three days. They contain compressed
payloads, so artifact transport uses compression level zero. Published releases
retain the signed assets independently of temporary workflow artifact retention.
Build caches speed up validation; they do not replace the tests or signed source
and asset checks enforced by the server.

## Repository settings

Protect the default branch with a pull request, resolved review conversations,
up-to-date source and the GitHub Actions checks `deployer`, `core` and `website`.
Block deletion and force pushes, without a bypass list. A solo-maintainer
repository can require zero external approvals while keeping those checks
mandatory. Keep experimental `beta` and `dev` branches outside this ruleset.

Use read-only default workflow-token permissions and keep PR creation/approval
by Actions disabled. The release job explicitly declares its narrower exception.
Enable dependency alerts and security-update proposals, and retain secret
scanning and push protection when available for the public repository.

The Dependabot configuration proposes one grouped Actions update at a time each
week. npm version-update proposals are disabled; grouped npm security fixes may
still be proposed for both locked dependency trees. These are review proposals,
not automatic merges, bot updates or production deployments. Reconcile product
versions and release notes before accepting a dependency PR.

See [release policy](RELEASING.md) and [remote update checks](REMOTE_DEPLOY.md).
