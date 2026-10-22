# Cloudflare Workers migration preparation

[Installation](INSTALLATION.md) · [Configuration](CONFIGURATION.md)

This source supports a separate Cloudflare Workers build of the existing Vinext
website. It is not Cloudflare Pages, a static export, or a Cloudflare Tunnel for
Core. Core stays on its existing host. No account, database, DNS record, secret,
production deployment or automatic deployment is created by this change.

## Build without changing the current host

Use Node.js 24.17 or newer and the locked dependencies:

```bash
npm ci
npm run build:cloudflare
```

Before the second command, supply the following through private local environment
settings or the approved build service's settings. Do not commit their values:

| Build setting | Purpose |
| --- | --- |
| `CF_WORKER_NAME` | The intended Worker's name |
| `CF_D1_DATABASE_NAME` | The intended D1 database's name |
| `CF_D1_DATABASE_ID` | Its actual D1 UUID, not the Sites placeholder |

The command generates ignored `wrangler.cloudflare.local.json` from the public
`wrangler.cloudflare.jsonc` template and selects
`AFTERPARTY_DEPLOY_TARGET=cloudflare`. Missing or invalid identity fails the build
rather than silently selecting the Sites database. Identity is configuration,
not authentication; these settings do not grant Cloudflare access.

The Cloudflare build uses the existing Worker entry point, `nodejs_compat`, a
pinned compatibility date and the `DB` binding. It does not include the Sites
hosting adapter or replace its real D1 binding with the local Sites placeholder.
Deployable output is `dist/server/wrangler.json` with the generated server and
client assets. The original `npm run build` remains the Sites/default path for
rollback preparation. Do not mix output from the two targets: build the intended
target immediately before inspecting or deploying its artifact.

No build command applies remote SQL. A successful build does not establish
runtime secrets, database contents, login, playback or live availability.

## Runtime configuration and isolated staging

Configure website values as Worker runtime settings, separately from build
settings. The template sets `keep_vars: true` so deployment preserves dashboard-managed
non-secret runtime variables as well as separately managed secrets. Keep credentials in Cloudflare's secret store, never in the public
Wrangler template, client variables, source, CI output or screenshots.

- `ADMIN_BRIDGE_KEY` must match the selected Core's `PUBLIC_SITE_ADMIN_KEY`.
- `GUTTA_CORE_PUBLIC_URL` identifies that Core's HTTPS origin.
- `GUTTA_CORE_SITE_ORIGIN` identifies this website's HTTPS origin.
- `YOUTUBE_API_KEY` enables website search.
- `ADMIN_PASSWORD_HASH` and `OWNER_UPDATE_URL` are optional private settings with
  the existing restrictions in [Configuration](CONFIGURATION.md#website-variables).
- Set your independently hosted copy's public `COPYRIGHT_CONTACT_EMAIL` as
  described in the same reference.

Do not give an unreviewed staging Worker the production bridge secret or point it
at production Core. Core currently uses one configured website origin, including
the redirect URI for Discord's token exchange. Merely adding a `workers.dev`
callback in Discord does not make arbitrary preview origins work. Full staging
login and bridge tests require an isolated test Core, separate credentials and
an approved test Discord application/server, or a separately reviewed and
explicitly approved Core change. This preparation makes no such Core change.

Before promotion, verify HTTPS, static assets, `/patch-notes`, public pages,
search, login/logout, server isolation, room state, streaming transport and
playback against that isolated setup. Synthetic/local checks alone do not prove
live Discord audio or provider availability.

## D1: fresh databases and imported databases are different

`drizzle/` is the migration source directory, with binding name `DB`. Cloudflare's
[migration tooling](https://developers.cloudflare.com/d1/reference/migrations/)
tracks applied SQL in a database ledger. Do not combine direct SQL initialization
and ledger-based migration as if they were interchangeable.

For a **new empty disposable local database only**, an operator can use the
installed Wrangler against the generated root configuration:

```bash
npx --no-install wrangler d1 migrations apply DB --local \
  --config wrangler.cloudflare.local.json \
  --persist-to .wrangler/cloudflare-test
```

This is not a production migration command. Do not point this local test at an
existing local preview database. A second application to the same initialized
test database should report no pending migrations.

For an existing Sites database, stop before any remote migration command. The
legacy installation procedure executed `0000` through `0003` SQL directly, without
recording Wrangler's migration ledger. An exported/imported database can already
contain those tables and columns while Wrangler considers every migration new.
Blindly applying them can fail or damage a migration procedure.

An approved migration needs a private verified backup/export, an import rehearsal
on a separate database, comparison of schema and row counts, and an explicitly
reviewed baseline/ledger reconciliation plan based on the actual database. Do not
mark migrations applied without proving their schema is present. Confirm export
and import permissions first; source access does not establish access to the
Sites-managed database. Never upload database exports or production IDs to GitHub.
Do not run remote SQL from build, deploy or PR validation scripts.

## Future GitHub-to-Cloudflare builds

[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) can build
from GitHub without Codex or Sites. Connecting the repository, choosing an account,
creating resources, authorizing GitHub access and enabling deployment are separate
owner-approved account operations, not effects of this PR. No automatic deployment
workflow is added here.

After approval and isolated staging validation, configure the repository root as
the build root, Node.js 24.17+ and locked dependency installation (`npm ci`). Use
`npm run build:cloudflare` as the build command and the three private `CF_*` build
settings above. Review branch behavior explicitly: do not deploy arbitrary PRs
against a production Worker or D1 database.

Only an authorized operator should select `npm run deploy:cloudflare` as the deploy
command. It validates the built Cloudflare artifact and invokes Wrangler with
`dist/server/wrangler.json` explicitly. Running it is a real deployment, not a dry
run. Configure runtime secrets separately before allowing traffic. Do not enable
this pipeline until the owner approves deployment and any account costs.

## Controlled cutover and rollback

Keep Sites, its private host configuration and its database intact until the new
host has passed verification and the owner approves retirement. The public Sites
template and default build path remain available; this is a transition mechanism,
not a claim that the website still needs Sites after migration.

Before cutover, record the previous DNS configuration privately, confirm backups,
review active rooms/playback, define a write-freeze/final-copy strategy and set
explicit rollback criteria. Prevent both sites from accepting independent writes
against diverging databases. A DNS rollback alone cannot reconcile new writes.

Cloudflare [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
require a controlled DNS change: an existing CNAME on the chosen hostname prevents
creating that Custom Domain. Do not delete or replace the live record during
source preparation. Domain attachment, certificate checks, runtime origin changes
and any Discord callback update belong to the approved cutover window. Retain the
old deployment until post-cutover checks and data consistency are confirmed.

### Retiring the Sites writer

The Worker entry point supports an optional runtime setting,
`AFTERPARTY_HOST_TRANSITION`. Leave it absent or empty on the active Cloudflare
Worker. Normal application handling is unchanged in that state.

On the retiring Sites deployment, set `hold` before the final database copy.
Every request returns HTTP 503 with `Cache-Control: no-store` and
`Retry-After: 30`, before the application can access D1 or Core. Verify that the
hold is active before taking the final copy; a setting change may require the
host's deployment flow to become effective.

After the approved cutover and new-host checks, change the retired host to
`redirect`. It returns a temporary HTTP 307 to `https://ap.openworks.no`, preserving
the request path, query and method. The destination is fixed in source. Requests
already using that origin return maintenance HTTP 503 instead, preventing a loop
while old DNS answers remain cached. Unknown nonempty settings also fail closed
with HTTP 503. Do not remove the hold on a retired database without first
reconciling writes accepted by the new host.
