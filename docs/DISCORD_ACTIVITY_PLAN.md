# Discord Activity feasibility

Afterparty now has an opt-in Activity integration test route in the beta.2 source.
Real Discord compatibility has not been established. See the
[isolated testing setup](DISCORD_ACTIVITY_TESTING.md) for implemented boundaries
and pending configuration. This planning document is not launch approval. The v3 social panel and the Discord Activities platform are different
things. The concert beta does not depend on shipping an Activity.

Discord runs Activities in an iframe. Its documented launch flow uses the
`LAUNCH_ACTIVITY` interaction response (type 12). The Embedded App SDK flow is
`ready`, `authorize`, server-side authorization-code exchange, then `authenticate`.
See [how Activities work](https://docs.discord.com/developers/activities/how-activities-work)
and [building an Activity](https://docs.discord.com/developers/activities/building-an-activity).

## Proposed source integration

1. Add a dedicated Activity entry route that reuses the concert/player UI and
   existing room, queue, votes and optional activities. Keep Core authoritative
   for the playback clock, Discord voice, queue and permissions. The SDK does not
   by itself synchronize this application's playback.
2. Add an Activity authentication adapter with server-side code exchange. Current
   `lib/discord-auth.ts` uses redirect OAuth, `SameSite=Lax` cookies and an admin
   callback. Owner cookies in `lib/password.ts` use `SameSite=Strict`. Do not
   globally weaken cookies or reuse owner recovery as guild authorization.
3. Bind the selected guild/channel/Activity instance to verified server access.
   Reuse `lib/social-server.ts` and Core OAuth membership checks, but define channel
   visibility and instance-to-concert mapping explicitly. SDK context identifiers
   select context; they do not prove authority or voice-channel membership.
4. Configure narrow framing and network policies for that route. `next.config.ts`
   currently sends `X-Frame-Options: DENY` and `frame-ancestors 'none'` globally.
   Preserve ordinary website/admin protection and inspect actual hosting headers.
5. Inventory relative SSE/social API routes and absolute Core ticket/WebSocket
   URLs in `lib/core-server.ts` and `/api/realtime`. Prefer the website's existing
   authenticated bridge. Validate Discord proxy URL mappings for assets, API and
   streams without exposing Core secrets or trusting arbitrary forwarded headers.
6. Add a separate Activity launch interaction to the Discord integration.
   `services/core/src/discord.ts` currently shares a website link for `/concert`.
   Launching an iframe must not implicitly pause, seek or replace a concert.

Discord's [networking guide](https://docs.discord.com/developers/activities/development-guides/networking)
describes the `discordsays.com` proxy, URL mappings, CSP/cookie constraints and
unsupported WebRTC. The existing Core voice architecture does not require a
WebRTC replacement. Origin checks in `lib/server.ts` and Core must remain
meaningful after proxy adaptation; broad origin allowlists are not an acceptable
compatibility shortcut.

## Feasibility tests before committing to launch

YouTube embedding is the principal unproven dependency. `lib/youtube-player.ts`
loads the external iframe API; `app/afterparty.tsx` supplies the current origin and
player permissions. Test nested framing, proxy/CSP behavior, referrer identity,
embed restrictions, consent, autoplay and sound in actual Discord desktop and
mobile clients. Browser fixtures do not establish that these work inside Discord.
Do not promise video parity before those tests pass.

Also test authenticated streaming, expired sessions, reconnect, external timestamp
links, clipboard/QR sharing, embedded storage isolation, keyboard focus and mobile
layouts. Website host credentials and saved preferences may not carry into the
embedded context. Preserve the social beta's separate revisions and load limits.

Discord documents restricted unverified Activity testing for invited testers/team
members, small servers (fewer than 25 members) and DMs in its
[verified and unverified Activities guidance](https://support-dev.discord.com/hc/en-us/articles/26576097154199-What-are-Verified-and-Unverified-Activities).
Check current eligibility and configuration before an authorized test. Production
verification/distribution is a separate decision.

The integration test adds the pinned Embedded App SDK and isolated source adapters.
No Developer Portal setting, OAuth credential, URL mapping, installation, publication
or production configuration has been changed.
Implementation and real-client testing require a defined Activity scope and
separate authorization. Music licensing and public-live issue #37 remain open
regardless of embedding feasibility.
