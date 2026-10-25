# Private Afterparty update channels

This directory is the reviewed source for the Production/Beta selector in an
existing private operations panel. It does not deploy a website, start a bot,
configure credentials or enable automatic updates.

Production keeps the original panel and its handlers. Selecting Beta uses the
existing beta-only API and the same visual components. Beta updates the website
with the existing test bot. It does not restart either bot.

## Install or update

The browser controller and display model are strict TypeScript. The website
build compiles them once using esbuild and includes standalone browser assets
and a checksum/source manifest in `dist/.openai/update-panel`. This directory is
inside the signed website archive and outside its public `dist/client` assets.
The host still needs only Python; it never installs Node or builds TypeScript.
The small HTML fragment and stylesheet remain the Python panel's integration
boundary, with no second client runtime.

Verify the website archive using the existing signed-release/provenance process,
then use its private assets with the matching reviewed source checkout. Supply
the existing authenticated panel directory outside the Git checkout:

```sh
python3 operations/update-panel/install.py --panel-dir /path/to/private/panel --assets-dir /path/to/verified/dist/.openai/update-panel
python3 operations/update-panel/install.py --panel-dir /path/to/private/panel --assets-dir /path/to/verified/dist/.openai/update-panel --apply
```

The first command validates without writing. Both commands reject missing,
stale or altered compiler output before making changes: the manifest must match
the reviewed TypeScript, CSS and HTML sources, and each compiled asset must match
its full checksum and content-hashed filename. Checksum validation supplements
the signed artifact verification; it does not establish the artifact's origin. The second backs up the index,
server, adapter and existing channel source. It installs content-hashed assets
and a small index-rendering hook. Restart only the panel's web service to load
Python changes. The installer never runs systemctl or a deployment command.

The rendering hook restores this integration after the base HTML/assets are
rebuilt, using the installed `channel-ui-source` directory. That private directory keeps
the reviewed inputs, manifest and compiled assets so recovery also needs no
Node or access to the original archive. Previously installed JavaScript source
layouts remain readable by the hook. When upgrading the
Python panel server itself, run this installer again. It rejects an unfamiliar
server template instead of silently editing it. Reviewed source changes require
rerunning the installer; fetching Git alone does not install executable code.

Both project and channel selections survive a reload in the same browser tab.
Selection and polling only read status. A new release still requires a fresh
server check and an explicit confirmation pinned to the displayed full commit.
An already deployed version cannot be started again through this adapter.

## Required existing server contract

- Owner authentication, Host/Origin validation and CSRF enforcement must already
  protect the panel and `/afterparty-update/api/beta/{status,check,run}`.
- The beta transaction service, existing beta configuration, and independent
  production update flow must already be installed. This UI does not provision
  them or modify target identifiers, credentials or databases.
- The base panel must retain its `operations-panel` mount, `project-content`,
  `.project-switcher`, `.project-header` and existing visual component classes.
- The route for `_astro/*.js` and `_astro/*.css` must serve authenticated static
  assets. The installer does not change the gateway or authentication policy.

GitHub rate limits are reported with a retry countdown and prevent repeated
background checks until the provider permits them. The last deployed source
and completed job remain visible if a new check fails. No token or extra
GitHub permissions are introduced.

The adapter reports safe progress derived from the current transaction and the
last successful job. A status check does not erase completed progress. Private
hosting identifiers, log contents and credentials are never returned to the UI.

## Validation

```sh
node --test operations/update-panel/test_model.ts operations/update-panel/build.test.ts
python3 -m unittest discover -s operations/update-panel -p 'test_*.py'
```

Tests use synthetic state and temporary directories. They verify same-version
blocking, frozen confirmation, stale errors, progress, HTML replacement,
idempotence, CSRF template preservation, dry-run behavior, compiler/source
freshness, tamper/path/symlink rejection, legacy source recovery and rebuild
retention. The Python suite uses synthetic compiled assets and has no Node
prerequisite; the TypeScript compiler test also verifies real output with the
Python asset loader.
Validate project/channel switching, reload, a read-only status check and mobile
layout against the authenticated panel. Do not publish merely to test the UI.

## Recovery

Restore the prior index, server, adapter and `update_panel.py` from the installer
backup. If the beta runner was patched, restore its backed-up `beta_update.py`
and prior `github_checks.py` alongside it. Restore its `channel-ui-source` directory when present, or remove the
index-rendering hook when reverting to a version without it. Restart only the
panel web service. Old hashed assets are retained for already open clients.
