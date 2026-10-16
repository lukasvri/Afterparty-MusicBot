# Final source release check

16 October 2026. Base: freshly fetched `main` at `98603ce`, including the merged documentation cleanup. This records source validation, not production deployment. Website and Core remain at the shared source version `2.1.1`; no new release or tag is published by this task.

## Result

Application tests, typechecks, production build, browser fixtures, version consistency and production dependency audits pass. The full release gate remains incomplete because repository lint still fails and live host validation has not been performed.

| Check | Result |
| --- | --- |
| Locked installation and `npm run check:all` | Pass: 56 Python operations/recovery tests, 64 website tests, 148 Core tests, both TypeScript checks and website build |
| Real synthetic audio | Pass in Core tests, including FFmpeg stereo decoding, crossfade and Opus at 96 and 192 kbit/s |
| `npm run release:check` | Pass: shared versions and generated notes agree |
| Chromium party and concert queue | Pass with isolated API and player fixtures |
| Chromium video startup | All 13 tests pass |
| Chromium service pages | Home, admin, install, support, privacy, terms and patch notes load; desktop/mobile fit; no visible platform branding or platform login links |
| Website and Core production npm audits | Zero findings in both dependency trees |
| Documentation references | Local paths, image references and heading anchors checked |
| New auth, hosting and page-check tooling lint | Pass without warnings |
| Repository-wide lint | Fails: 109 errors and 29 warnings, matching the pre-change baseline |
| Live Discord listening, real reconnects and host capacity | Not run in this cloud task |
| Production update, container validation and rollback on the deployment host | Not performed |

## What changed

The application no longer uses hosting account identity for administration. Discord OAuth and the owner-password fallback remain, including per-guild access checks. New regressions exercise rejected identity headers, password expiry/rotation, both session revocations and owner-server isolation. `/api/me` now checks the incoming password session as well.

Unused connector preview code and its direct dependencies are removed. Twelve lockfile package entries disappear; retained dependency versions are unchanged. Website pages, browser rooms, video, shared queues, Core audio, database migrations, private host configuration selection and hosting build output remain. Build-output tests check selected bindings, migration copies and preserved private source files.

The public interface and policy text use Afterparty presentation. The existing website hostname remains because the website is staying on its current host. Host-required configuration/output paths, working privacy-provider links and third-party copyright notices remain for compatibility and attribution. The application does not control provider-managed changes outside this repository.

## Before a production update

An installation that previously used only hosting identity must configure and verify Discord OAuth or an owner password before applying this change. See [configuration](CONFIGURATION.md). The owner password does not grant another server's administration.

Resolve the existing lint backlog before calling the full source gate green. On the deployment host, use the [host readiness](HOST_READINESS.md) and [operations](../services/core/PUBLIC_RELEASE.md) workflows to validate the container, backups and recovery, then verify real listening and reconnects with the intended voice-session limit. Source tests do not establish live provider availability or what a person hears.

After the reviewed website update, verify the live `/admin` sign-in and logout, `/install` invitation, room creation and concert playback. Keep the current origin and Discord OAuth callback until a separate domain migration is planned. This task does not deploy the website, restart the bot or change its hosting address.

## Reproduce the browser checks

Build the website and start an isolated local preview with `npm run start`. With Playwright and Chromium available, set `PREVIEW_URL`, and `PLAYWRIGHT_MODULE`/`CHROMIUM_PATH` if needed, then run:

```bash
node scripts/party.browser.mjs
node scripts/concert-queue.browser.mjs
node scripts/video-start.browser.mjs
node scripts/service-pages.browser.mjs
```

These fixtures require a local preview and use synthetic responses. They do not operate a production bot or account.
