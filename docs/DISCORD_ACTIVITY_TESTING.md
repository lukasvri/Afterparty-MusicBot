# Isolated Discord Activity integration test

This source adds an opt-in `/activity` document and SDK adapter. It has not been
launched in a real Discord client. Mocked SDK, API and browser checks do not prove
Discord proxy cookies, provider embedding, autoplay or audio continuity. Keep the
[concert beta gates](V3_BETA_ACCEPTANCE.md) open until an authorized test records
those results. No Portal, credentials, deployment or real-user changes accompany
this source.

## Isolation before configuration

Use a separate Discord application/bot and a separate Core instance for this test.
The application used by the Activity must be the same application as that test
Core's bot and OAuth client. Reusing the production bot token would connect another
client to production guilds; Core starts sessions for every guild that bot has
joined and registers guild commands at startup. `DISCORD_GUILD_ID` is the initial
server, not a gateway allowlist. The Activity allowlist does not restrict the bot's
ordinary startup behavior. Install the test bot only in approved test guilds.

Use a separate checkout pinned to the reviewed Activity commit, a fresh Core data
volume, a separate website/D1 database and a new bridge secret. Do not copy live
SQLite, D1, `.env`, cookies, provider credentials or hosting files. Leave
`LEGACY_DATA_DIR` unset. On one host, the default Compose project, fixed container
name, image tag and port would collide with production. Use a reviewed, ignored
test Compose file with a unique project/container/image/volume and a different
loopback port, or use a separate test host. Keep Core off public raw ports.
Do not run the repository's default `docker compose up` in a production checkout.

The test still needs a working Core voice host and a website runtime with D1.
No new paid service or production domain is assumed. The owner must choose the
existing machine, test HTTPS origins and approved proxy/tunnel before any setup.

## Exact configuration names

| Location | Setting | Test value |
| --- | --- | --- |
| Core | `DISCORD_TOKEN` | Private token for the separate test bot |
| Core | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Same test application's OAuth credentials |
| Core | `DISCORD_GUILD_ID` | Initial approved test guild ID |
| Core | `PUBLIC_SITE_URL` | Test website HTTPS origin |
| Core | `PUBLIC_SITE_ADMIN_KEY` | New test-only random bridge secret |
| Core | `DATA_DIR`, `CORE_PORT` | Isolated volume path and chosen internal port |
| Core | `DISCORD_ACTIVITY_ENABLED` | `true` only after test setup approval |
| Core | `DISCORD_ACTIVITY_CLIENT_ID` | Exact test application ID; must equal Core OAuth application |
| Core | `DISCORD_ACTIVITY_TEST_GUILD_IDS` | Comma-separated exact approved guild IDs, at most 20 |
| Website | `ADMIN_BRIDGE_KEY` | Same test-only bridge secret |
| Website | `GUTTA_CORE_PUBLIC_URL` | Test Core HTTPS proxy origin |
| Website | `GUTTA_CORE_SITE_ORIGIN` | Test website HTTPS origin |
| Website | `DISCORD_ACTIVITY_ENABLED` | `true` only for the isolated test website |
| Website | `DISCORD_ACTIVITY_CLIENT_ID` | Same exact test application ID |
| Website | `DISCORD_ACTIVITY_LAUNCH_ROOT` | `true` only on a dedicated test website to serve the Activity at `/`; requires Activity enabled and a valid application ID |
| Website | `DB` binding | Separate test D1 database |

`MUSIC_TEXT_CHANNEL_ID` and `MAX_ACTIVE_VOICE_SESSIONS` can restrict the test's
initial player location and voice capacity. They do not replace permission checks.
Provider keys are optional for Core fallback; website search requires its usual
`YOUTUBE_API_KEY`. Do not request or paste any secret in chat or a public PR.

The website adds `drizzle/0004_activity_test_sessions.sql`. Apply all migrations
in order only to a new empty test database; for an existing beta test database,
apply only this new migration after backup and schema inspection. Generated
Drizzle metadata is included. Production migrations are not authorized here.

## Owner-approved Portal steps

Use the official [Activity setup guide](https://docs.discord.com/developers/activities/building-an-activity)
for the current Portal UI. These are required configuration steps, not actions
performed by this PR:

1. Identify the separate test application and invite eligible testers. Check the
   current unverified Activity eligibility rules and the target server's total
   member count, including bots. Server size alone does not grant tester access.
2. Install that test bot with `bot` and `applications.commands`, using the existing
   documented View Channels, Send Messages, Embed Links, Read Message History,
   Connect and Speak permissions. Do not grant Administrator. Core uses Guilds and
   Guild Voice States, not privileged Message Content.
3. Enable Activities. Keep Discord's default Launch entry-point handler; the
   current source does not add a custom Activity launch interaction to the bot.
4. Map `/` to the approved test HTTPS host. Discord's guide demonstrates root
   mapping, not a guaranteed custom launch-path field. On a dedicated test website,
   set `DISCORD_ACTIVITY_LAUNCH_ROOT=true` together with the matching Activity
   configuration. The root renders the same Activity entry without a redirect or
   path rewrite, so the SDK launch query remains in the browser URL and hydration
   uses the root route. Only root GET/HEAD documents get Activity framing; API,
   admin and other documents retain their existing protection. With the root flag
   absent, false, or Activity disabled, `/` stays the ordinary website.
   Alternatively use a reviewed launch-document reverse proxy or a verified
   launch-path setting if the Portal offers one. Assets and `/api/activity/*` must
   remain unchanged. This is an explicit owner configuration gate, not a claim
   that a Portal toggle alone launches this source.
5. Add the SDK OAuth redirect placeholder described by Discord's Activity guide
   (`https://127.0.0.1`). The SDK flow exchanges codes without a website redirect.
   If testing ordinary website login too, retain its separate exact test-website
   `/api/auth/discord/callback` redirect. Do not change production redirects.
6. The Activity requests only `identify` and `guilds`. Bot installation is separate;
   the embedded sign-in does not request installation scope or new permissions.

The [networking guide](https://docs.discord.com/developers/activities/development-guides/networking)
requires proxy-domain partitioned cookies. This implementation uses a separate
HttpOnly/Secure/SameSite=None/Partitioned Activity cookie with the exact configured
`<application-id>.discordsays.com` domain. Real proxy forwarding must be verified.
Do not disable browser security, relax all origins, rewrite YouTube restrictions
or expose Core credentials to make a test pass.

## Source behavior and limits

The user explicitly connects, SDK readiness completes, and a one-use state binds
the authorization code exchange. Core verifies Discord identity, guild membership,
the test allowlist and installed guild. The browser receives an access token only
in memory for SDK authentication; encrypted grants remain server-side. Sessions
expire within 30 minutes and are separate from ordinary admin login. SDK guild,
user, channel and instance data alone never grants permission. This iteration
selects the verified guild's existing concert, not a separate channel/instance
concert. It does not claim to verify voice-channel attendance.

Only `/activity` and an explicitly enabled root launch document permit Discord framing. Activity traffic uses a fixed API bridge
allowlist, with server-owned scope and participant identity. The standalone app's
OAuth cookies/origin policies remain unchanged. Room creation, directory and admin
navigation are excluded. Playback commands require a verified server manager;
queue votes and social participation retain their scoped rules. Playback uses a bounded polling fallback with a ten-second Activity floor; social uses the authenticated POST stream.
Direct Core ticket/WebSocket fallback is intentionally unavailable through this
adapter. Public state reads remain public data; writes recheck authorization.

YouTube's existing player is reused without a CSP/proxy bypass. If the provider or
Discord blocks it, record that result and leave video compatibility unaccepted.
External links, fullscreen, clipboard and QR behavior also require real-client
checks. The SDK does not become playback-clock or Discord-audio authority.

## Minimal supervised test

Start with two clients, not a full-server capacity claim. The unchanged shared
600/minute Core peer budget and Activity budgets still apply behind proxies.
After the owner configures and authorizes the isolated environment, verify the
pinned build and Core health. Start a concert with the separate test bot in the
approved guild, then launch its Activity from Discord. Connect as a manager and
as an ordinary member on desktop/mobile. Verify the correct guild concert, denied
cross-guild actions, role demotion, reactions/bingo/highlights, reconnect and expiry.
Confirm only managers can issue playback controls and social actions never alter
the playback revision. Listen to real voice audio during these steps.

Record the build SHA, client/device, pass/fail evidence and any provider/proxy
failure without private identifiers or tokens. Do not label the Activity ready
for server use until the real-client gates pass. Disconnect test clients and stop
only the separate test services when finished; preserve test data for review.
