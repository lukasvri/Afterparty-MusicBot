# Documentation artwork

[Documentation](../README.md) · [Branding](../BRANDING.md)

| File | Source and purpose |
| --- | --- |
| `afterparty-banner.png` | AI-generated brand artwork made for this repository: black DJ platter, white lowercase lettering and red accents. It illustrates the Afterparty identity. |
| `afterparty-desktop.png` | Screenshot of the local website preview at 1440 × 1000, in English. |
| `afterparty-mobile.png` | Screenshot of the same preview at a 390 px viewport, in English. |
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
