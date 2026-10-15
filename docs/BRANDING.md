# Afterparty branding

The website and Discord music bot share the display name **Afterparty**.
This source change updates navigation, accessible labels, page metadata,
admin and invite text, translations, scenery, bot help and idle activity,
fallback display names, operational messages and public documentation.
There is no web app manifest in this repository. The favicon and stage monogram use a lowercase white `ap` with a red dot.
The wordmark uses Inter 900, with a self-hosted Latin variable font and its
SIL Open Font License preserved in `public/fonts/Inter.LICENSE`.

## Compatibility

Keep the repository URL, package names, container names, data paths, environment
variables, `gutta-language` browser preference, `gutta-krutt-core` API engine and
ticket audience, `gutta-krutt-oauth-v1` encryption context and `krutt:` component
IDs unchanged. These are integration or persistence contracts, not display names.
Translation lookup strings and their call sites change together. Historical
release entries retain their original wording. No stored server names are migrated.

## Manual rollout

1. Review and merge this source change, then deploy the website and update Core
   using the existing [release process](RELEASING.md). Back up production data and
   check active playback before an approved Core update. This change does not
   authorize or perform a deployment, restart or external rename.
2. In the existing application in Discord Developer Portal, set the application
   display name and bot username to `Afterparty`. Check any server-specific bot
   nickname that could override the displayed username. Keep the same application
   ID, token, permissions and installation settings.
3. Suggested application description: `Afterparty spelar musikk i Discord med
   felles kø, favorittar og styring frå nettsida.` Review the authorization and installation screens
   after saving. Existing invite URLs use the application ID, not its display name.
4. A new domain is optional and is not selected or provisioned by this change.
   Keep current URLs working. If a domain is approved later, coordinate DNS,
   hosting, TLS, redirects and public support/privacy links. Update Core
   `PUBLIC_SITE_URL`, website `GUTTA_CORE_SITE_ORIGIN`, and the exact Discord OAuth
   redirect `https://<website>/api/auth/discord/callback`. Change
   `GUTTA_CORE_PUBLIC_URL` only if Core's own origin moves. See
   [installation](INSTALLATION.md) and [configuration](CONFIGURATION.md).
5. After deployment, verify the title and logo on desktop and mobile, both site
   languages, invite text, Discord sign-in, bot help and idle presence. Existing
   server names and historical messages may still contain the previous name.

The GitHub repository name and hosting project name can remain unchanged.
