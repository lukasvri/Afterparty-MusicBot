# Configuration reference

[← Installation guide](INSTALLATION.md) · [README](../README.md)

Core and the website run in different processes. Setting a value in one does not automatically configure the other. Copy only the example files; fill in real values locally.

## Core variables

File: `services/core/.env`. Docker Compose loads this file. After editing it, run `docker compose up -d --force-recreate` from `services/core/`.

| Variable | Required? | Value |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Your Discord bot token, not the OAuth client secret |
| `DISCORD_GUILD_ID` | Yes | The initial owner server ID; the bot must already be installed there |
| `PUBLIC_SITE_URL` | Yes | Your website origin, for example `https://afterparty.example.com` |
| `PUBLIC_SITE_ADMIN_KEY` | Yes | A random bridge secret shared only with your website runtime |
| `DISCORD_CLIENT_ID` | For admin setup | Your Discord Application ID; the running bot can also supply its own ID |
| `DISCORD_CLIENT_SECRET` | For Discord admin login | The OAuth client secret for the same application |
| `MUSIC_TEXT_CHANNEL_ID` | Optional | A text channel for the owner server's player messages |
| `YOUTUBE_API_KEY` | Optional for Core | YouTube Data API key; Core has a search fallback |
| `SPOTIFY_CLIENT_ID` | Optional | Your Spotify application client ID |
| `SPOTIFY_CLIENT_SECRET` | Optional | Matching Spotify client secret |
| `LASTFM_API_KEY` | Optional | Enables Last.fm-backed radio recommendations |
| `MAX_ACTIVE_VOICE_SESSIONS` | Optional | Simultaneous voice-session limit; default `8`, not a measured capacity guarantee |

Compose sets `DATA_DIR=/data` and `CORE_PORT=3990`. Keep these consistent with its volume and port configuration. The Docker image supplies Node, FFmpeg and yt-dlp.

## Website variables

Local file: `.dev.vars` in the repository root. In production, use the hosting platform's environment and secret settings.

| Variable | Required? | Value |
| --- | --- | --- |
| `ADMIN_BRIDGE_KEY` | Yes for Core integration | Exactly the same value as Core's `PUBLIC_SITE_ADMIN_KEY` |
| `GUTTA_CORE_PUBLIC_URL` | Yes for Core integration | Core's HTTPS origin, for example `https://core.example.com` |
| `GUTTA_CORE_SITE_ORIGIN` | Recommended | Your website origin; otherwise derived from the request URL |
| `YOUTUBE_API_KEY` | For website search | YouTube Data API key with access to the required API |
| `DISCORD_ACTIVITY_LAUNCH_ROOT` | Dedicated Activity test website only | Default `false`. With Activity enabled and a valid configured Activity client ID, serves the Activity entry at `/` and permits Discord framing for root GET/HEAD documents. Never enable on the ordinary website. |

Discord OAuth credentials belong in **Core's** environment. They are not browser configuration. The website calls Core to perform the token exchange.

The website also requires a **D1 database binding named `DB`**. A binding is not an API key. The generic `.openai/hosting.json` declares the binding name; your hosting platform must supply the actual production database.

`ADMIN_PASSWORD_HASH` is an optional owner-password mechanism, not required for the recommended Discord OAuth setup. Do not put a plaintext password in that setting. Hosting account headers do not grant administration. Existing installations that used only hosting identity must configure Discord OAuth or the password fallback before updating.

To generate the supported PBKDF2 hash locally in Bash, read the password without echoing it or saving it in shell history:

```bash
read -rs -p 'Afterparty owner password: ' afterparty_admin_password
printf '\n'
printf '%s' "$afterparty_admin_password" | node --input-type=module -e '
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
const password = readFileSync(0, "utf8");
if (!password.length || password.length > 200) throw Error("Use 1 to 200 characters.");
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256");
console.log("pbkdf2$100000$" + salt.toString("hex") + "$" + hash.toString("hex"));
'
unset afterparty_admin_password
```

Store only the resulting hash as `ADMIN_PASSWORD_HASH` in the website's secret settings. Keep it private. Rotating the hash invalidates existing password sessions. Password access is limited to the initial owner server; administration of other servers requires Discord sign-in.

Optionally set `OWNER_UPDATE_URL` as a website runtime secret to an existing private
HTTPS update page. The control room shows a discreet update icon beside Sign out only to valid
owner-password sessions. Its localized tooltip is "Update bot and website". Anonymous visitors, Discord-only
administrators and bridge-key callers do not receive the address. Keep private
hostnames out of tracked files. The updater retains its own access controls;
the website link does not grant update rights. A Tailscale-hosted updater still
requires Tailscale access on the device and the bot host to be online.

## Matching values

```text
Core PUBLIC_SITE_ADMIN_KEY   = Website ADMIN_BRIDGE_KEY
Core PUBLIC_SITE_URL        = Website public HTTPS origin
Website GUTTA_CORE_PUBLIC_URL = HTTPS proxy or tunnel to Core:3990
Discord OAuth redirect      = Website origin + /api/auth/discord/callback
```

The bot token, OAuth client secret and bridge secret are different credentials. Do not reuse one for another purpose.

## Secret handling

- `.env` and `.dev.vars` are ignored by Git. The tracked examples contain empty credentials and example domains.
- Do not prefix server secrets with `NEXT_PUBLIC_`, paste them into issues or include them in screenshots.
- Keep backups outside Git with restricted filesystem permissions.
- If a credential is exposed, revoke it at the provider and update your services. Deleting a file from the latest commit does not remove it from Git history.

## Optional Discord Activity test mode

The default-off Activity adapter uses separate scoped sessions and test guilds.
See [isolated Activity testing](DISCORD_ACTIVITY_TESTING.md) for the exact Core
and website variables, additive test database migration, root-document routing,
Portal steps and real-client gates. Do not enable it on a production installation
merely because the source contains an Activity route.

## Catalog search resource limits

HTTP catalog reads are separate from playback/radio lookups. Core admits one
request-owned catalog job at a time with a total 50-second deadline, including
provider calls, extractor admission and metadata. Cold search returns up to four
results and hydrates one metadata item at a time. Concurrent catalog readers get
a busy response instead of accumulating queued jobs. Completed metadata remains
cached. A disconnected reader cancels only its own work; its slot stays occupied
until owned extractor processes and POSIX helper groups have exited.

The website uses a 60-second Core catalog bridge budget and a 75-second browser
search/metadata budget. Busy and deadline responses do not trigger direct-source
fallback; other supported fallback retains caller cancellation. Worker builds enable
`enable_request_signal` so incoming disconnects can reach the bridge. Ordinary state
reads keep their shorter deadlines. These bounds do not replace host capacity
planning, monitoring or the real-client acceptance checks.
