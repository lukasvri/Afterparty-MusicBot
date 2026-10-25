# Documentation artwork

[Documentation](../README.md) · [Branding](../BRANDING.md)

| File | Source and purpose |
| --- | --- |
| `afterparty-banner.png` | AI-generated brand artwork made for this repository: black DJ platter, white lowercase lettering and red accents. It illustrates the Afterparty identity. |
| `afterparty-desktop.png` | Screenshot of the local website preview at 1440 × 1000, in English. |
| `afterparty-mobile.png` | Screenshot of the same preview at a 390 px viewport, in English. |
| `v3-classic-desktop-20261023.png`, `v3-classic-mobile-20261023.png` | Existing website baseline from `e69a2c1`, with a synthetic room and the search tab open, at 1440x1000 and 390x1000. External artwork/media is blocked. |
| `v3-familiar-desktop-20261025.png`, `v3-familiar-mobile-20261025.png` | Native alpha.2 familiar-layout follow-up: synthetic room/queue at 1920×1080 (full page) and 390×844 (viewport), reduced motion and no activated audio or external media. App transport/volume/seek duplicates are removed. |
| `v3-familiar-startup-20261025.json` | Built-Worker decoded script responses and individually recomputed gzip for the familiar-layout follow-up at 1440px/390px; lazy-library and active-room scenery assertions pass. These are local response sizes, not field or wire-transfer measurements. |
| `v3-svelte-desktop-20261023.png`, `v3-svelte-mobile-20261023.png` | Opt-in SvelteKit `/v3` candidate with synthetic room/queue/search data at the same viewport sizes. Audio is not activated in these images. These show a partial migration, not full feature parity or deployment. |
| `svelte-room-measurements-20261023.json` | Successful local production-Worker script response sizes, uncompressed and individually gzipped. Fresh Chromium contexts, synthetic data and blocked external requests. Includes method and scope limitations; this is not a Lighthouse/Web Vitals or audible-media benchmark. |
| `dj-console-before-20261018.png`, `dj-console-after-20261018.png` | Matching 1440 px local-preview crops of the decorative stage before/after the TypeScript interface pass, using Norwegian UI preferences and reduced motion. |
| `admin-mobile-before-20261018.png`, `admin-mobile-after-20261018.png` | Matching 390 px synthetic admin-login previews showing navigation and shared-interface changes. |
| `stage-pa-lighting-after-20261018.png` | Follow-up 1440 px English welcome-stage crop: opaque concert PA arrays, subwoofers, red/white lighting and a halo contained inside the LED screen, with motion switched off. Compare with the earlier `dj-console-after-20261018.png` scene above. |
| `welcome-footer-mobile-20261018.png` | Follow-up 390 px English welcome-page screenshot: the top patch-notes banner is removed and the current-version link is in the footer. |
| `tv-layout-desktop-20261018.png`, `tv-layout-mobile-20261018.png` | TV follow-up screenshots at 1280x720 and 390x844, with synthetic room data and a clearly labelled synthetic source player. The QR code points only to the local public room URL. These images demonstrate layout, not live media playback. |
| `ui-tv-before-20261018.png`, `ui-settings-before-20261018.png`, `ui-before-metrics-20261018.json`, `admin-settings-before-20261018.png` | Synthetic baseline evidence for the 2.2.6 UI/admin correction: wide/short TV layout, oversized nickname field, measured geometry and authenticated settings. The continuation checkpoint is documented in `docs/UI_ADMIN_HANDOFF.md`; cloud completion and after-render verification are recorded there. |

| `ui-tv-after-20261018.png`, `ui-settings-after-20261018.png`, `ui-fullscreen-mobile-after-20261018.png` | Verified 2.2.6 after-renders: 2560x1080 TV and nickname/settings alignment, plus a 390x844 fullscreen viewport capture. The clearly labelled iframe is synthetic. |
| `ui-stage-welcome-after-20261018.png`, `ui-stage-desktop-after-20261018.png`, `ui-stage-mobile-after-20261018.png` | Final welcome and empty-room stage renders: aligned PA seams, a logo/ring above the performer, complete desktop headings and mobile copy separated from the illustration. |
| `admin-settings-after-20261018.png`, `admin-settings-mobile-after-20261018.png` | Authenticated synthetic settings previews at 1440px in English and 390px in Norwegian. Three groups contain ten implemented controls, with no real account or server data. |
| `ui-after-metrics-20261018.json`, `ui-release-notes-after-20261018.png` | Final measured iframe/panel/QR/settings/scene geometry and the mobile rendering of canonical 2.2.6 notes. Metrics identify the tested source commit. |

The screenshots use synthetic room and bot API responses and block external media requests. They show the welcome interface without real accounts, Discord IDs, credentials or listening data. They do not establish live production connectivity or playback.

README images use repository-relative paths and GitHub-compatible HTML. The documentation banner is separate from the application icon. Use the existing vector files in `public/` for UI branding; do not duplicate or extract the logo from the raster banner. Font and glyph notices are in [third-party notices](../../THIRD_PARTY_NOTICES.md).

### Animated stage follow-up, 25 October 2026

`v3-stage-desktop-20261025.png` and `v3-stage-mobile-20261025.png` show the
welcome screen in an isolated local built Worker at 1920×1080 and 390×1000.
Animation was enabled for the capture; no room, provider audio or account was
connected. The scene is native decorative SVG, with the controls oriented toward
the DJ. See [UI review](../UI_REVIEW.md) for layout and animation checks.

### Navigation and theater UI pass, 25 October 2026

`v3-ui-theater-desktop-20261025.png` (1920px) and
`v3-ui-admin-mobile-20261025.png` (390px) use synthetic local browser fixtures.
The theater image uses an empty local iframe with test buttons, not real YouTube
media. They show layout and navigation only, with no production account or audio.
See [UI review](../UI_REVIEW.md) for behavior and viewport checks.

`v3-ui-games-desktop-20261025.png` captures the 1920×1080 game entry
walkthrough, additionally checked at 4K, QHD and 390px. It uses an empty local
API fixture; no game or room is created by the capture.
