# Final source release check

16 October 2026. This check starts from freshly fetched `main` at `9429b3a`.
Website and Core share version `2.1.1`. No release tag is created by this check.

## Source validation

The repository lint backlog is resolved without disabling rules, adding ignores
or suppressing warnings. `npm run lint` now rejects warnings, and lint runs in
`npm run check:all`, website CI and the host deployment preflight.

| Check | Result |
| --- | --- |
| Repository lint | Zero errors and zero warnings |
| Website unit and integration checks | 67 pass, including storage notifications and blocked persistence |
| Operations and recovery checks | 56 Python tests pass |
| Core typecheck and tests in Docker | 170 tests pass, including real FFmpeg decoding, crossfade and Opus |
| Website TypeScript and production build | Pass |
| Version consistency | Shared versions and generated release notes agree |
| Browser party and concert fixtures | Private setup, search, queue, moderation, saved evenings, QR, TV, language and responsive layout |
| Browser video fixtures | Host/guest startup, autoplay fallback, radio progression, stale revisions, buffering and iframe preservation |
| Browser service pages | Home, admin, install, support, privacy, terms and patch notes load on desktop and mobile |

Core validation runs with FFmpeg inside the validation Docker image. Browser
fixtures use synthetic APIs against an isolated local production preview. They
never connect a production Discord account or database.

## Changes relevant to the checks

Saved audio, language, display preferences and evening libraries subscribe to
browser storage with stable hydration snapshots. Changes in another tab
invalidate the memory fallback. Blocked persistence still retains the current
page's state and reports a failed durable write.

Player and live-stream callbacks observe committed React values. Video quality,
volume, mute and language updates do not recreate the player or its stream.
Admin server changes reset the selected server's form state. Background polling
preserves unsaved settings, and response generation checks reject old replies.

Provider responses, saved queues, Discord interactions and synthetic fixtures
use explicit types. Internal page links and image elements use the framework's
components. Existing external image delivery and OAuth links remain supported.

## Reproduce

With Node.js 24.17+, Python 3.11+ and FFmpeg installed:

```bash
npm run setup:cloud
npm run check:all
```

Build the website and start an isolated local preview with `npm run start`.
With Playwright and Chromium available, set `PREVIEW_URL`, and optionally
`PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`, then run:

```bash
node scripts/party.browser.mjs
node scripts/concert-queue.browser.mjs
node scripts/video-start.browser.mjs
node scripts/admin.browser.mjs
node scripts/service-pages.browser.mjs
```

## Production boundary

Source checks do not establish provider availability, audible Discord quality,
real load across multiple servers or cold boot recovery of the PC. The host's
[readiness](HOST_READINESS.md) and [operations](../services/core/PUBLIC_RELEASE.md)
checks remain required for production updates. Preserve the complete per-server
backup, existing private configuration and current OAuth callback. Verify live
health and the published site after deploying the same GitHub revision to both.
