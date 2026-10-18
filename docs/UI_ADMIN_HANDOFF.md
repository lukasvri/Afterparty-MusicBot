# UI and admin settings continuation

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

**No combined production build, green after-browser test, after-render inspection
or complete final suite has run for this checkpoint. Do not claim otherwise.**

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
