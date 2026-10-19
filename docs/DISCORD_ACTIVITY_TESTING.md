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
the playback revision. Open Search with empty history and submit a search; the
Activity must stay connected on its original launch URL without SDK CLOSE or a
new authorization. Activity history remains an isolated empty videos list.
Music search and video metadata have a 75-second browser budget and a 60-second
Core catalog bridge budget around one request-owned 50-second Core job. Cold
interactive searches return at most four results with serial metadata extraction;
overlap fails busy instead of building a queue. Disconnect and deadline cleanup
must stop owned extractor helpers before another job is admitted. Busy/deadline
errors must not fan out into direct-provider fallback. Ordinary state reads keep
their short deadlines. A stopped or memory-starved Core still needs an authorized
operational recovery; bounded work does not guarantee provider availability. Listen
to real voice audio during these steps.

Record the build SHA, client/device, pass/fail evidence and any provider/proxy
failure without private identifiers or tokens. Do not label the Activity ready
for server use until the real-client gates pass. Disconnect test clients and stop
only the separate test services when finished; preserve test data for review.


## Media routing and release gate (beta.6)

The owner's real Console error confirms that direct
`https://www.youtube.com/iframe_api` is blocked by the Activity CSP. This does
not prove that mapped playback is impossible or that a particular video refuses
embedding. [Discord URL mappings](https://docs.discord.com/developers/activities/development-guides/local-development)
are the supported routing mechanism; no policy relaxation or media relay is used.

The Activity keeps the official YouTube API, its ready/state events and existing
synchronization. Before mounting it, a scoped head-script observer uses the SDK's
`attemptRemap` URL function for official API/widget script paths only, following
its documented src-rewriting pattern. It disconnects and removes owned nodes on
Activity teardown. It never patches fetch, XHR, WebSocket or a nested frame's
content. The app-owned initial loader is mapped before insertion to avoid its
blocked-node onerror racing an asynchronous rewrite. The official API's
[pre-created iframe mode](https://developers.google.com/youtube/iframe_api_reference#Loading_a_video_player)
receives a mapped frame with `enablejsapi=1`, the actual parent origin, proper
referrer policy and fullscreen permission. No custom postMessage handlers,
forged origin, player HTML rewriting or stream endpoints are introduced.

### Owner-approved test-app mappings, not configured by this PR

Keep production applications and the existing root route unchanged. Initial
bootstrap mapping in Activities > URL Mappings:

| Prefix | Target | Purpose |
| --- | --- | --- |
| `/youtube` | `www.youtube.com` | Initial API, widget script and official embed frame |

Use no protocol in Target; put the specific prefix before the existing `/` route.
This is the minimum initial routing experiment, not a proven complete player
configuration. The public demo embed HTML also referenced root-relative `/s/...`
scripts. A subsequent trace may require `/s` -> `www.youtube.com/s`, before `/`,
but that additional same-origin third-party script mapping needs separate
review/approval and a real trace. Parent-document rewriting does not automatically
patch a nested iframe realm. Do not guess wildcard video/CDN/internal-API mappings.
Stop and diagnose the next blocked URL or origin error instead of relaying media
or weakening CSP. Standard proxy mapping itself has not been established as
prohibited, but provider restrictions and official-player identification remain.

Mapping a third-party frame under the Activity origin changes its same-origin
trust boundary. Activity cookies remain scoped to `/api/activity`, but that alone
is not proof that a same-origin frame cannot reach authenticated app APIs. Review
this boundary with the test-app mapping approval; do not treat transport mapping
as a security guarantee or grant it on production. No credentials are added to
the script/frame URLs by this adapter.

The pre-created iframe and API use actual origins; whether the mapped frame's
postMessage ready/state/control handshake works through Discord is unverified.
No local/mock event is evidence of that handshake. Keep YouTube error101/150
(owner embedding refusal),153 (client identification), loading/CSP failures and
autoplay denial distinct. Do not bypass a provider refusal.

Artwork remains a separate fixed-ID same-origin JPEG endpoint with a5-second
combined cancellation deadline,256KiB cap, no redirects/caller credentials and
cache headers. Activity flat discovery retains independent preview/verified
caches; selected IDs still resolve full metadata. One-job admission, total50s
catalog deadline, cancellation and extraction resource limits remain unchanged.

### Fullscreen capability, not an Activity-wide disable

The SDK has no fullscreen request command. This does not mean the browser API
cannot work. Activity and standalone both request native fullscreen from the
user gesture when allowed; otherwise the accessible fallback fills only the
current viewport and is labelled Restore stage. Escape, focus restoration and
visible exit controls remain. The Activity cannot grant a capability denied by
Discord's enclosing iframe. Inspect `document.fullscreenEnabled`, the client's
iframe delegation and an actual rejection before attributing a fullscreen bug.
SDK orientation/PiP settings are not fullscreen grants. See the
[Fullscreen Standard](https://fullscreen.spec.whatwg.org/#permissions-policy-integration).

### Required real Discord checks before merge/publication

1. Confirm the approved initial mapping loads `/youtube/iframe_api` and the
   mapped widget script, without the direct initial-script CSP failure.
2. Record the actual iframe request, subsequent blocked URL/status/directive,
   parent/frame origins and YouTube error code if any. Never record nonces,
   session cookies, OAuth tokens or complete HAR files in public GitHub.
3. Establish actual API onReady/state events and synchronized time/control in
   the mapped iframe before claiming embedded video works. Use an owner-approved
   existing test concert; automation must not alter live audio/queues to test it.
4. Verify cold/warm search, artwork in results/queue/stage, selected-ID validation,
   and unchanged Activity transport cancellation/session isolation.
5. Test native fullscreen where permitted and a denied case, plus fallback label,
   Escape, focus restoration and visible controls on desktop/mobile. Retest normal
   website video/fullscreen; do not label viewport expansion device fullscreen.

Without a permitted browser/client these gates remain pending. The code and
mocked DOM tests are review material, not a successful Discord integration test.


### Activity audio output and queue controls

The embedded player must play synchronized video **with audio** inside Activity.
The external link is only a failure fallback. A listener explicitly chooses local
Activity audio or Discord voice audio; until then the local player stays muted.
Local Activity audio requires the listener to confirm muting the bot for themselves
in Discord, then uses the existing local volume preference, an explicit unmute
and user gesture. The SDK has no supported per-user bot mute command, so the app
cannot verify this confirmation or automatically prevent a listener from leaving
their separate voice audio audible. It must never claim that it muted the bot.
Switching to voice output mutes the local player and asks the listener to unmute
the bot locally. No server voice, bot volume or other user's audio is changed.
Native iframe unmute while the voice/undecided policy is active is re-muted by
the local playback loop; policy mute is not saved as the user's volume preference.
Validate real autoplay recovery and absence of double audio in the target client.

Search/add and the queue remain inside the Activity view. Add still submits the
selected ID to the existing authoritative concert command. Queue reads preserve
per-guild permissions, revisions and filtered ordinary Discord music. Loading or
failed queue reads must not say the queue is empty; read-only retry is separate
from mutation. A generic Console thumbnail CSP error does not establish an order,
missing-item, moderation or stale-update queue bug. Capture the actual queue pane
and relevant read status after the owner's operation before claiming that defect
resolved. No live queue/playback mutation is part of source validation.
