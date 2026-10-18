# UI and admin settings continuation and cloud validation

The owner requested cloud continuation before shutting down the local computer
on 18 October 2026. This is a checkpoint, not a finished or deployed release.

## Source and requested outcome

- Repository: `lukasvri/Afterparty-MusicBot`.
- Branch: `fix/unified-ui-admin-settings-20261018`, based on freshly fetched
  main `c92a91f6f1c3c33ba8f4e972c6808d6b2567ccc6` (owner merged PR #67).
- Make TV, fullscreen, room settings, administration and the stage illustration
  use coherent spacing, typography and the existing black/white/red tokens.
- Move persistent bot configuration to admin and reduce slash-command clutter.
- Preserve queue behavior, playback clocks, iframe identity, permission checks,
  server isolation, stored settings and compatibility handlers. English remains
  the default; do not resume Rust work.
- Never merge, enable auto-merge, publish a release, deploy, register production
  Discord commands or use real accounts/data. Return a reviewed draft PR.

## Implemented, awaiting combined validation

- TV constrains the complete video panel and its invitation card together.
  Previously, at 2560x1080 a 1600 px video sat inside a 2218 px content panel.
  QR cards no longer stretch to the whole panel height; text/controls scale up.
- Nickname fields are bounded and align with the TV action; fullscreen/shared
  controls use the same radius, neutral border and typography tokens.
- PA cabinets share one projection with non-overlapping seams. LED graphics are
  simpler and separated from the performer; decks and mixer are unchanged.
- Admin has three groups containing ten working settings, associated units and
  bounds, acknowledged saves and durable errors. Only implemented fields are
  submitted. Two inactive stored fields are preserved but omitted from the UI.
- Discord registration is reduced from 33 to 17 commands. `/play` has `query`,
  `next`, `now` and `shuffle`. Cached `/config` and `/crossfade` calls privately
  link to the current guild's admin page without mutating settings. Other old
  handlers remain compatible. Deep links preselect only authorized guilds.
- Product version 2.2.6 is synchronized in both manifests/locks and canonical
  `lib/releases.json`; `CHANGELOG.md` is generated. Historical 2.2.5 is intact.

## Evidence already obtained

- 36 baseline design contexts across nine pages, two languages and two widths.
- 15 baseline TV/settings/fullscreen renders across 2560x1440, 2560x1080,
  1920x1080, 1280x720 and 390x844. Baseline geometry regression is actually red.
- Admin baseline at 1440/390: two inactive controls and zero field groups,
  observed red before implementation.
- Three initial Discord cleanup regressions observed red before source edits.
- 45 focused Discord/API authorization tests passed, plus one actual Core
  settings test using isolated SQL, OAuth grants, two guilds and atomic bounds.
- Website/Core types and focused lint passed before the final CSS adjustments
  and last Core test. Release validation and diff checks passed.
- Selected synthetic baseline screenshots/metrics are in `docs/assets/`.
  Owner screenshots are not needed to reproduce the defects.

**At the checkpoint, no combined production build, green after-browser test,
after-render inspection or complete final suite had run. The cloud completion
below records the subsequent verification.**

## Required cloud work

1. Fetch main and this branch; preserve the checkpoint. Read `AGENTS.md`,
   `docs/AI_CONTEXT.md`, `docs/AI_WORKFLOW.md` and `docs/BRANDING.md`.
2. Use the cloud runtime instructions if present. Install locked dependencies
   with `npm run setup:cloud`; use Node 24.17+, Python 3.11+ and FFmpeg.
3. Build a fresh preview with `npm run build`, then start an isolated local
   preview on `127.0.0.1:8787`. The previous Windows preview is irrelevant.
   A raw Node preview can use `node node_modules/vinext/dist/cli.js start
   --port 8787 --hostname 127.0.0.1`; its browser APIs are intercepted fixtures,
   so this does not establish real Cloudflare bindings/OAuth connectivity.
4. Set `CHROMIUM_PATH` to an available cloud Chromium. Run
   `UI_PHASE=after node scripts/tv-mode.browser.ts` and
   `ADMIN_SETTINGS_PHASE=after node scripts/admin-settings.browser.ts`.
   Inspect actual after images, especially 2560x1080, mobile fullscreen,
   nickname alignment and the authenticated admin settings page.
5. Verify iframe/stage/panel content widths match, 16:9 without cropping,
   no desktop scrolling, compact QR card, bounded nickname, aligned action,
   usable 44/48 px controls and the same iframe through TV/fullscreen changes.
6. Run `npm run check:all`, the new browser regressions, existing party/admin/
   admin-seek/concert-queue/video-start/sync workflows and release checks.
   Use synthetic data only. Fix real regressions and rerun affected checks.
7. Add selected sanitized after screenshots and final measured evidence.
   Update notes/docs if scope changes, fetch upstream again, push this same
   branch and update its draft PR. Verify CI on the exact final head.
8. Include the exact generated release body in the PR if draft Release creation
   is unavailable. Reply to the owner in Nynorsk with no em dash.

Windows-only historical failures (`fcntl` imports and a POSIX decoder fixture)
are not reasons to skip Linux cloud tests. Local output folders and all local
computer tools may be unavailable after shutdown; source/tests and the selected
baseline evidence in GitHub are sufficient to continue.


## Cloud completion, 18 October 2026

The checkpoint was recovered in a separate cloud worktree. Existing checkouts
were preserved. Main was fetched and rechecked at
`c92a91f6f1c3c33ba8f4e972c6808d6b2567ccc6`; no newer main required integration.
The final implementation is recorded by source commit
`c9f41efefa9f685562dd2ba4a6fe495565eca24b` on the same PR branch. CI status for
the final submitted head is tracked in [PR #68](https://github.com/lukasvri/Afterparty-MusicBot/pull/68).

Actual after-render review reproduced and corrected three remaining issues:

- Mobile empty-room copy overlapped the logo and performer. Text now has its own
  area above the 16:9 illustration; current media, TV and fullscreen retain their
  own layout rules.
- The fixed empty-room heading was line-clamped at 1280x720. It now remains
  complete while long song titles keep their existing clamp.
- New admin groups, help and save messages ignored a saved Norwegian preference.
  They now follow the selected language, including existing confirmations and
  errors, without changing drafts or submitting settings during language changes.

All three failures were observed with red browser assertions before their fixes.
The lead reviewed the combined work; independent subagents handled UI geometry
and admin/Discord validation with non-overlapping file ownership. Rust remained
paused and no Rust code was changed.

### Completed validation

- Node 24.19.0, Python 3.12, FFmpeg and cloud Chromium 154 on Linux.
- `npm run setup:cloud` and `npm run check:all` passed: zero-warning lint,
  website/Core typechecks, 56 Python tests, 113 website unit tests, 399 Core tests
  including real FFmpeg audio, and a production build. The final heading-only
  layout change was followed by successful lint, typecheck and a fresh build.
- `UI_PHASE=after node scripts/tv-mode.browser.ts` passed all five viewport
  sizes, ten welcome/empty-room scene geometries and player-identity checks.
  All 25 generated UI images were opened and reviewed. At 2560x1080, iframe and
  stage were 1603.55x901.98, the complete panel was 1605.55px wide including its
  two borders, and the invitation card was 360x652.59 with a 240px QR image.
  The desktop nickname was bounded to 360px with zero bottom-alignment error.
- `ADMIN_SETTINGS_PHASE=after node scripts/admin-settings.browser.ts` passed
  English/Norwegian at 1440px and 390px, including live language changes,
  confirmed and unconfirmed saves, persistent errors, polling, unauthorized deep
  links and per-guild draft isolation. Real Core/SQL/OAuth tests verify all ten
  fields, atomic bounds and preservation of omitted compatibility settings.
- Existing party, admin, admin-seek, concert-queue, queue-add (8), language (10
  contexts), video-start (27), sync (4) and service-page workflows passed.
  The final 27 video tests also passed on the final implementation build.
- The broad design audit passed 36 contexts across nine pages, two languages
  and desktop/mobile. The versioned footer link and all canonical 2.2.6 title,
  version and note bullets were rendered and visually checked at 1440/390.
- Release consistency and diff checks passed. Version remains the checkpoint's
  synchronized 2.2.6; 2.2.5 and older history are preserved.

Selected synthetic after screenshots and measured geometry are committed in
[the evidence index](assets/README.md), including
[wide TV](assets/ui-tv-after-20261018.png),
[mobile fullscreen](assets/ui-fullscreen-mobile-after-20261018.png),
[mobile empty-room composition](assets/ui-stage-mobile-after-20261018.png),
[English admin](assets/admin-settings-after-20261018.png),
[Norwegian mobile admin](assets/admin-settings-mobile-after-20261018.png) and
[measured geometry](assets/ui-after-metrics-20261018.json).

These checks use isolated local fixtures and synthetic accounts, grants and
media surfaces. They do not establish real Discord playback, source availability
or production OAuth/hosting connectivity. No production login, registration,
data access, merge, auto-merge, release publication or deployment was performed.
Release-draft creation remains unavailable; the exact generated 2.2.6 body is
included in PR #68 instead. Production slash registration remains an owner-run
operation after review; it was never invoked by this validation.
