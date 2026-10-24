# Deploy the SvelteKit beta with the existing test bot

This runbook targets the owner-requested `https://ap.beta.openworks.no` beta.
It does not authorize a production update, merge or replacement of the existing
bot. Run host operations from the connected server laptop. Cloud development
checks and a Wrangler dry run do not establish that the beta is online.

## Reuse the laptop's beta installation

Inspect the existing beta's Compose project, environment-file references, data
mounts, ports and public proxy before changing anything. Identify the Afterparty
test Discord application and its Core service from that installation, without
printing credentials or personal identifiers. The production Core and production
database are separate resources and must not be used for this beta.

The target topology is:

```text
ap.beta.openworks.no -> afterparty-web-beta (SvelteKit)
  AFTERPARTY_API -> existing beta API Worker -> existing beta D1
                                          -> test Core on the laptop
                                          -> Afterparty test Discord bot
```

`apps/web/wrangler.beta.jsonc` names the API service `afterparty-api-beta` as a
template. Check the actual existing beta Worker name before deployment. If it
differs, use a private local copy of this configuration and update the binding;
keep its relative Worker/assets paths valid. Do not rename or replace an existing
deployment just to match the template. Do not commit deployment-specific IDs,
private configuration or database exports.

Confirm the API Worker uses the beta's own D1 binding and these existing runtime
settings, supplied through the host's private configuration and Cloudflare's
secret store:

- `GUTTA_CORE_PUBLIC_URL`: the test Core's externally reachable HTTPS origin.
- `GUTTA_CORE_SITE_ORIGIN`: `https://ap.beta.openworks.no`.
- `ADMIN_BRIDGE_KEY`: the test Core's matching `PUBLIC_SITE_ADMIN_KEY`.
- The beta's catalog and other required keys from [Configuration](CONFIGURATION.md).

Core's `PUBLIC_SITE_URL` must be `https://ap.beta.openworks.no`. Its bot token and
Discord OAuth credentials must belong to the existing Afterparty test application.
Register the matching callback
`https://ap.beta.openworks.no/api/auth/discord/callback` on that test application.
Keep all values in their existing private files or secret stores, out of chat,
shell arguments and logs.

If the test Core has no public HTTPS route, establish one for its existing beta
port using the laptop's approved proxy/tunnel setup. Do not reuse the production
Core endpoint. Verify that a public health request reaches the test service before
setting the API URL. A missing route does not require creating another bot or
discarding the beta's existing data. Back up the beta configuration and data before
any necessary service recreation; preserve mounts and environment-file references.

## Build and deploy the candidate

Use a separate checkout of the reviewed candidate ref on the laptop, preserving
the running installation. Install locked dependencies and validate as described
in [the migration guide](SVELTEKIT_MIGRATION.md#validation). The Svelte frontend
introduces no Core protocol or D1 schema change. Verify compatibility with the
installed beta Core before choosing any separate update. If the existing beta API
needs a source update, build it separately with its verified beta-only identity using
[the Cloudflare instructions](CLOUDFLARE.md). Never deploy the default Sites build
or production configuration to obtain the API binding.

From the candidate checkout:

```bash
npm run build:web
cd apps/web
node --import ./scripts/runtime.ts node_modules/wrangler/bin/wrangler.js deploy \
  --config wrangler.beta.jsonc --dry-run
```

After confirming that the service binding resolves to the existing beta API,
that the hostname is reserved for this beta and that the host's Cloudflare
credentials target the correct account, the owner-authorized beta publication is:

```bash
node --import ./scripts/runtime.ts node_modules/wrangler/bin/wrangler.js deploy \
  --config wrangler.beta.jsonc
```

Substitute the private configuration path in both commands when necessary. This
second command publishes and attaches the custom domain. Preserve any existing
beta route/configuration for rollback. Do not remove a conflicting DNS record
until its ownership and purpose are established. No CI auto-deployment is added.

## Verify and roll back

The beta-only `AFTERPARTY_BETA_ENTRY=1` setting redirects `/` to `/v3` with room
query parameters preserved. `/?classic=1` opens the existing interface, including
Discord controls. The Svelte interface now includes browser rooms, library/playlists, public
concert controls, administration, games and public information pages. Bridge mode
keeps API routes and OAuth callbacks on the existing beta API Worker. Native API
mode is a separate reviewed option described in the migration guide; do not
enable it on the beta without supplying its existing D1/Core configuration.

Check HTTPS and assets, the root redirect, Classic, private-room host/guest
permissions and persistence, search, playback controls, login/logout and the test
bot's selected-server isolation. Verify actual Discord voice playback separately
with the test bot. Synthetic tests do not establish audible playback. Record the
deployed commit, Worker version and test outcomes without private identifiers.

For rollback, restore the previous beta Worker version/domain route and beta
configuration. Disabling `AFTERPARTY_BETA_ENTRY` restores the Classic root while
retaining `/v3`. No database rollback or ownership-storage deletion is needed.
Do not change production, merge the draft PR or enable automatic updates as part
of this beta deployment.
