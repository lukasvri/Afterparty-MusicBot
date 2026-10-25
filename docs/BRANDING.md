# Afterparty identity

[Documentation](README.md) · [Artwork notes](assets/README.md)

<img src="assets/afterparty-banner.png" alt="Afterparty brand artwork with lowercase white lettering and a red dot" width="100%" />

The website and Discord music bot share the display name **Afterparty**. The visual identity is lowercase white lettering, a small red dot and a dark background.

## Use the existing assets

| Asset | Location | Use |
| --- | --- | --- |
| ap monogram | [`public/afterparty-mark.svg`](../public/afterparty-mark.svg) | Scalable interface mark |
| Favicon | [`public/favicon.svg`](../public/favicon.svg) | Browser icon |
| Variable Latin font | `public/fonts/inter-latin-wght-normal.woff2` | Self-hosted Inter body and display typography |
| README banner and previews | [`docs/assets/`](assets/README.md) | Repository presentation |

The application wordmark uses Inter 900. The monogram uses vector glyph outlines, so it does not need a remote font request. Keep the SIL Open Font License in [`public/fonts/Inter.LICENSE`](../public/fonts/Inter.LICENSE).

Native routes and `apps/web/src/lib/ui/PublicPage.svelte` use the canonical vector mark for website branding. Keep the dot round and red, retain generous spacing around the mark, and use accessible labels for standalone icons. The application accent is `#ff263e`; the documentation banner uses the same black, white and red direction.

The AI-generated banner is documentation artwork. It is separate from the canonical vector UI mark. Screenshots show an isolated local preview; see [asset notes](assets/README.md) for provenance.

## Shared interface language

Use the shared variables in `apps/web/src/lib/ui/AppTheme.svelte` for neutral dark surfaces, light
text, the red accent, control/panel radii and the visible keyboard focus ring.
Body and display typography use the existing self-hosted Inter font. Service
pages and administration use the same navigation proportions and action
hierarchy as music and rooms; keep mobile links and primary actions usable
without wrapping the navigation or shrinking touch targets.

Shared application chrome and fluid TV tokens live in that root-rendered theme. Discovery and library styles stay scoped to their own surfaces. Use the
shared neutral surface, border and muted-text tokens for everyday fields,
secondary buttons and selected tabs. Selected controls keep a restrained red
indicator. Reserve the red accent for active controls, primary actions,
meaningful playback/status indicators and destructive intent. Keep short labels
readable, preserve full accessible names when display text is truncated, and use
at least 44-pixel targets for the main touch controls. See the
[alpha.14 interface review](UI_REVIEW.md) for the reviewed surfaces and evidence.

The decorative stage remains code-native SVG, separate from the logo. Its two
decks share one component and projected control plane around a centered
four-channel mixer. Preserve that geometry, align the hands with the controls,
and honor reduced motion when changing the scene. This is an illustration,
not a photograph or a claim of real hardware operation. Existing player,
permission and playback-clock components remain independent of the artwork.

Use opaque concert PA modules with rigging, grilles and ground subwoofers,
not exposed hi-fi driver towers. Keep rear light behind their cabinets and
anchor each beam to its fixture. Restrained red and neutral white lighting
shares the interface palette. Backdrop graphics, including the rotating halo,
must stay inside the LED screen in both scene compositions and at every
animation angle. Both reduced motion and the in-app motion switch apply.

Match video, TV, fullscreen and administration controls to the shared neutral
surface, border, radius, focus and typography tokens. Short settings fields
must have bounded widths and align with related actions. Size the complete
player panel when a viewport limits its height; constraining only the video
child can leave an unused strip inside the panel. TV invitation cards should
fit their content rather than stretch to the video's full height. Verify the
actual iframe replacement and its outer panel at wide and short viewports.

Stage PA modules share one projection and non-overlapping seams. Keep logo,
backdrop graphics and performer silhouettes visually separated throughout
animation; fewer coherent shapes are preferable to intersecting detail.

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

Follow [installation](INSTALLATION.md), [configuration](CONFIGURATION.md) and [operations](../services/core/PUBLIC_RELEASE.md) for an approved rollout. Back up production data and check active playback before updating Core. Verify desktop/mobile branding, public website journeys, bot help and Discord sign-in after deployment.
