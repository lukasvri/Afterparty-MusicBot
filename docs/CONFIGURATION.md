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
| `OWNER_EMAIL` | Optional | Legacy owner access through the Sites identity integration; leave blank for Discord-only administration |

Discord OAuth credentials belong in **Core's** environment. They are not browser configuration. The website calls Core to perform the token exchange.

The website also requires a **D1 database binding named `DB`**. A binding is not an API key. The generic `.openai/hosting.json` declares the binding name; your hosting platform must supply the actual production database.

`ADMIN_PASSWORD_HASH` is an optional legacy owner-login mechanism, not required for the recommended Discord OAuth setup. Do not put a plaintext password in that setting.

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
