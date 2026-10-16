# Afterparty identity

[Documentation](README.md) · [Artwork notes](assets/README.md)

<img src="assets/afterparty-banner.png" alt="Afterparty brand artwork with lowercase white lettering and a red dot" width="100%" />

The website and Discord music bot share the display name **Afterparty**. The visual identity is lowercase white lettering, a small red dot and a dark background.

## Use the existing assets

| Asset | Location | Use |
| --- | --- | --- |
| ap monogram | [`public/afterparty-mark.svg`](../public/afterparty-mark.svg) | Scalable interface mark |
| Favicon | [`public/favicon.svg`](../public/favicon.svg) | Browser icon |
| Variable Latin font | `public/fonts/inter-latin-wght-normal.woff2` | Self-hosted Inter display typography |
| README banner and previews | [`docs/assets/`](assets/README.md) | Repository presentation |

The application wordmark uses Inter 900. The monogram uses vector glyph outlines, so it does not need a remote font request. Keep the SIL Open Font License in [`public/fonts/Inter.LICENSE`](../public/fonts/Inter.LICENSE).

Use the `Logo` component in `components/afterparty-navigation.tsx` for shared website branding. It is reused by the service pages. Keep the dot round and red, retain generous spacing around the mark, and use accessible labels for standalone icons. The application accent is `#ff263e`; the documentation banner uses the same black, white and red direction.

The AI-generated banner is documentation artwork. It is separate from the canonical vector UI mark. Screenshots show an isolated local preview; see [asset notes](assets/README.md) for provenance.

## Compatibility

Internal identifiers are stored or exchanged by existing installations. Changing a display name does not rename them.

Preserve package and container names, data paths, environment variables, older browser preference inputs, the `gutta-krutt-core` API engine and ticket audience, `gutta-krutt-oauth-v1` encryption context and `krutt:` Discord component IDs. These are integration and persistence contracts. New browser writes use the Afterparty keys while compatibility adapters continue to read older values.

Keep translation lookup strings and call sites aligned. Historical release entries retain their original wording. Stored server names are not automatically migrated. The canonical source repository is [`lukasvri/Afterparty-MusicBot`](https://github.com/lukasvri/Afterparty-MusicBot).

## Application identity on Discord

The source controls bot help, idle activity and public interface wording. Discord's application display name, bot username and server nicknames are configured separately.

To update an existing application, use the same Discord application ID and credentials. Set the application display name and bot username to `Afterparty` in Developer Portal, then check any server nickname that overrides it. Suggested description:

> Afterparty plays music in Discord with shared queues, favorites and website controls.

Review installation, OAuth and support/privacy links after saving. Existing invitations use the application ID, not its display name.

## URLs and rollout

Keep existing URLs working. If a domain changes, coordinate DNS, hosting, HTTPS and redirects, then update Core's `PUBLIC_SITE_URL`, the website's `GUTTA_CORE_SITE_ORIGIN` and the exact Discord OAuth redirect at `/api/auth/discord/callback`. Change `GUTTA_CORE_PUBLIC_URL` only if Core's own origin moves.

Follow [installation](INSTALLATION.md), [configuration](CONFIGURATION.md) and [operations](../services/core/PUBLIC_RELEASE.md) for an approved rollout. Back up production data and check active playback before updating Core. Verify desktop/mobile branding, both website languages, bot help and Discord sign-in after deployment.
