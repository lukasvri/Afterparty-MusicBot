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
| `DEEZER_METADATA` | Optional | Exact value `1` enables Deezer track/album/playlist metadata lookup and matching through existing sources, including supported `link.deezer.com/s/…` shares and bounded `utm_*` tracking on canonical links. Default off; at most 500 entries within the configured playlist limit. No Deezer preview/full-audio streaming or Guess the Song inventory is enabled. |
| `LASTFM_API_KEY` | Optional | Enables Last.fm-backed radio recommendations |
| `GUESS_SYNTHETIC_TEST` | Optional | Exact value `1` enables five fictional generated test tones for the game preview; default off. No real songs or external provider audio. See [test guide](GUESS_SYNTHETIC_TEST.md). |
| `GUESS_DEEZER_PREVIEWS` | Optional | Exact value `1` enables a limited local pilot with up to eight explicitly approved Deezer track previews. Default off; mutually exclusive with YouTube and synthetic quiz modes. Requires the private inventory path below. Snapshot expires within five minutes without automatic refresh. See [pilot setup](GUESS_CATALOG_SOURCES.md#local-pilot-configuration). |
| `GUESS_DEEZER_INVENTORY_PATH` | Optional | Absolute path to a private, regular JSON file of at most 32 KiB containing approved track IDs, categories, permission references and expiry. Never upload it to GitHub. Ignored unless preview pilot is enabled. |
| `GUESS_YOUTUBE_CLIPS` | Optional | Alpha builds automatically prepare the bundled eight-song quiz when this is unset, empty or `auto`, unless another quiz source is explicitly selected. `0` disables it. `1` selects YouTube explicitly. Stable, beta and rc builds remain default-off. Clips use the private participant transport and expire after at most 30 minutes from preparation start or earlier custom recording expiry. |
| `GUESS_YOUTUBE_PACK` | Optional | Alpha builds default to `edm-festival-hits` when no custom inventory is selected. No extra environment setup, song file or approval file is needed for this preset. Publication metadata does not establish a music license. Mutually exclusive with a custom YouTube inventory path. See [quiz use](GUESS_CATALOG_SOURCES.md#play-the-bundled-pack). |
| `GUESS_YOUTUBE_INVENTORY_PATH` | Optional | Absolute path to a private regular JSON file of at most 32 KiB containing curated video IDs, answers, categories, clip offsets/durations and the existing permission records. See [YouTube clip setup](GUESS_CATALOG_SOURCES.md#youtube-audio-clip-pilot). |
| `MAX_ACTIVE_VOICE_SESSIONS` | Optional | Simultaneous voice-session limit; default `8`, not a measured capacity guarantee |

Run `npm run guess:check` from `services/core/` with the intended quiz variables
already loaded to check the configured source without starting the bot or web
server. For a private local environment file, use
`node --env-file=.env src/guess-check.ts`. The command returns a bounded JSON
readiness summary and disposes its temporary inventory. It does not install the
inventory into a running Core or refresh its configured source. See the
[preflight guide](GUESS_CATALOG_SOURCES.md#check-the-configuration-before-startup).

In the game lobby, the host can choose **Load quiz songs** to retry an unavailable
or expired source directly from the website. The action uses fresh room/server
authority and game revision checks, returns promptly and reports preparation
progress through normal polling. Players cannot select provider URLs or change
the configured source. A healthy snapshot is kept unchanged.

For a matching updated installation, `services/core/core-control.sh guess-reload`
sends an explicit `SIGHUP` to reload an unavailable or expired configured quiz
source without restarting Core or ordinary Discord playback. A healthy source is
kept unchanged. This does not reload environment variables or activate a disabled
source. See [source reload](GUESS_CATALOG_SOURCES.md#reload-without-restarting-music).

Compose sets `DATA_DIR=/data` and `CORE_PORT=3990`. Keep these consistent with its volume and port configuration. The Docker image supplies Node, FFmpeg and yt-dlp.

## Website variables

Local file: `.dev.vars` in the repository root. In production, use the hosting platform's environment and secret settings.

| Variable | Required? | Value |
| --- | --- | --- |
| `ADMIN_BRIDGE_KEY` | Yes for Core integration | Exactly the same value as Core's `PUBLIC_SITE_ADMIN_KEY` |
| `GUTTA_CORE_PUBLIC_URL` | Yes for Core integration | Core's HTTPS origin, for example `https://core.example.com` |
| `GUTTA_CORE_SITE_ORIGIN` | Recommended | Your website origin; otherwise derived from the request URL |
| `YOUTUBE_API_KEY` | For website search | YouTube Data API key with access to the required API |
| `COPYRIGHT_CONTACT_EMAIL` | For independently hosted copies | Your operator's public copyright contact address. If absent, the hosted installation's owner-approved address is used. An empty or invalid value disables email drafts and shows the support fallback. See [copyright requests](COPYRIGHT_REQUESTS.md). |

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
