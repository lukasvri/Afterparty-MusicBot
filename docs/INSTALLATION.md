# Installation guide

[← Back to README](../README.md) · [Configuration reference](CONFIGURATION.md)

This guide takes you from a fresh clone to your first Discord track and concert room. Use your own Discord application, database and domains. No maintainer accounts or private configuration are required.

## 1. Check your tools and clone the project

Install Git, Docker with Compose v2, and Node.js 24.17 or newer. Verify:

```bash
git --version
docker version
docker compose version
node --version
npm --version
```

Docker must be running, and your user must be able to run Docker commands. The host does not need FFmpeg or Python: the Core Docker image installs them.

```bash
git clone https://github.com/lukasvri/Afterparty-MusicBot.git
cd Afterparty-MusicBot
cp services/core/.env.example services/core/.env
cp .dev.vars.example .dev.vars
```

Commands below run from the repository root unless a step explicitly changes directories. Do not run them in an existing production checkout without reviewing your local changes.

## 2. Create and install your Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Copy its **Application ID** into `DISCORD_CLIENT_ID` in `services/core/.env`.
3. In the bot settings, obtain a bot token and save it as `DISCORD_TOKEN`. Keep it private.
4. Configure a **Guild Install** with the `bot` and `applications.commands` scopes. Grant **View Channels**, **Send Messages**, **Embed Links**, **Read Message History**, **Connect** and **Speak**. Do not grant Administrator just for this bot.
5. Use the application's installation link to add it to a test server you manage. Enable Public Bot if other people should be able to install your bot on their own servers.
6. Enable Developer Mode in your Discord client. Right-click the test server and copy its server ID into `DISCORD_GUILD_ID`.
7. Optionally copy a text channel ID into `MUSIC_TEXT_CHANNEL_ID` to choose where the player appears.

Core uses the Guilds and Guild Voice States gateway intents. It does not require the privileged Message Content intent for slash commands. You do not need to configure an HTTP Interactions Endpoint for Core: it receives interactions through the gateway.

For Discord's current application setup screens, see the [official getting-started guide](https://docs.discord.com/developers/quick-start/getting-started).

## 3. Choose your addresses and create a bridge secret

A complete installation needs two origins:

| Example | Purpose |
| --- | --- |
| `https://afterparty.example.com` | Website, browser login and `/admin` |
| `https://core.example.com` | HTTPS proxy or tunnel to Core's local port 3990 |

These are placeholders. Replace them with domains you control. Core must be able to reach the website, and the website runtime must be able to reach Core. Inside a container, `localhost` refers to that container, not your host machine.

Generate a secret locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy that value to both places:

- `PUBLIC_SITE_ADMIN_KEY` in `services/core/.env`.
- `ADMIN_BRIDGE_KEY` in `.dev.vars` for local preview, and your website host's secret settings for production.

Set `PUBLIC_SITE_URL` in Core to the website origin. Set `GUTTA_CORE_PUBLIC_URL` in the website to Core's HTTPS origin. Set `GUTTA_CORE_SITE_ORIGIN` to the website origin. Use origins without paths, usernames or passwords.

For website search, configure a YouTube Data API key as `YOUTUBE_API_KEY` on the website. Core also accepts this key; its search has a fallback without it. Spotify and Last.fm credentials are optional. See [all settings](CONFIGURATION.md).

## 4. Start Core and check its health

Make sure the bot is already installed on the server from `DISCORD_GUILD_ID`, and all four required Core values are filled in: `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `PUBLIC_SITE_URL`, and `PUBLIC_SITE_ADMIN_KEY`.

```bash
cd services/core
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3990/health
cd ../..
```

The first build downloads dependencies, typechecks Core, and runs the tests. Later builds reuse Docker's cache.

A successful health request returns `ready: true`. If it fails, inspect the logs:

```bash
cd services/core
docker compose logs --tail=100 core
cd ../..
```

Until the website is deployed and configured, bridge warnings are expected. A healthy bot does not by itself mean concert rooms are ready.

## 5. Build and preview the website

From the repository root:

```bash
npm ci
npm run build
```

The build produces a Worker configuration at `dist/server/wrangler.json`. The repository's `.openai/hosting.json` provides a generic `DB` binding, not a production database or hosting account.

Initialize a **new, empty local database** by applying the SQL files in filename order:

```bash
for migration in drizzle/*.sql; do
  npx wrangler d1 execute DB --local \
    --config dist/server/wrangler.json \
    --persist-to .wrangler/state \
    --file "$migration"
done
```

These commands execute the SQL directly. Run them once per empty database; they do not record an applied-migration ledger. Repeating the initial migrations on an existing database causes table or column conflicts. Preserve `.wrangler/state` between runs.

Start the website:

```bash
npm run dev
```

Open the URL printed by the development server, normally `http://localhost:5173`. This is a development preview. Discord OAuth uses secure cookies, so use your configured HTTPS website address for the complete login test. Do not treat a local UI preview as proof that remote clients can reach Core.

## 6. Connect HTTPS and deploy your website

### Core endpoint

Configure an HTTPS reverse proxy or tunnel on your host to forward to `http://127.0.0.1:3990`. Keep the Compose loopback binding. Configure the proxy to support streaming responses without buffering and WebSocket upgrades if you use WebSockets.

Check your own endpoint:

```bash
curl --fail https://core.example.com/health
```

Replace the example hostname first. The expected response is the same as the local health response. Do not publish a raw Docker port to make this test pass.

### Website hosting

For a direct GitHub-to-Cloudflare Workers setup without Sites or Codex, use the
[Cloudflare preparation guide](CLOUDFLARE.md). It provides the explicit build target
and separates local validation from approved account setup, data migration and
live cutover. Existing Sites databases must not receive fresh-database SQL blindly.

The repository includes Sites/Vinext/Workers integration. Deployment still requires a hosting account and a real D1 database. This guide does not claim a tested one-click deploy to every Workers provider setup.

For your chosen Sites or Workers deployment:

1. Create a website project and a D1 database in your own account.
2. Bind that database as **`DB`**. The all-zero database ID used by local tooling is a placeholder, not a production database.
3. Apply every file in `drizzle/` in order to the **empty production database**, using your host's migration tooling. Check that you have selected the intended database before running remote SQL.
4. Configure the website secrets from [Configuration](CONFIGURATION.md#website-variables). `.dev.vars` is a local file and is not a production secret store.
5. Deploy the built website using that platform's supported flow and attach your website hostname.
6. Confirm the website origin matches `PUBLIC_SITE_URL` in Core, then restart Core if you changed its environment.

Do not reuse a maintainer's project ID, database ID or domains. See the official [D1 command reference](https://developers.cloudflare.com/d1/wrangler-commands/) for local and remote database commands. Generic Workers production deployment is an integration step, not a bundled installer in this release.

## 7. Enable Discord admin sign-in

In your Discord application's OAuth2 settings:

1. Copy the client secret into `DISCORD_CLIENT_SECRET` in `services/core/.env`.
2. Add this exact redirect URI, replacing the domain:

   ```text
   https://afterparty.example.com/api/auth/discord/callback
   ```

3. Verify `DISCORD_CLIENT_ID` belongs to the same application as the bot token.
4. Recreate Core to load the changed environment:

   ```bash
   cd services/core
   docker compose up -d --force-recreate
   cd ../..
   ```

5. Open `https://afterparty.example.com/admin` and sign in with Discord.

The login requests `identify` and `guilds`. You must own the selected Discord server or have Administrator or Manage Server permission. The bot must be installed there before you can control playback.

## 8. Play your first track

1. Join a normal voice channel in your Discord test server.
2. Type `/play` and fill in its query field with a song title or supported link.
3. Check that the bot joins, the player message appears, and you can hear audio.
4. Test Pause, Resume and Next from the player controls.
5. Use `/concert url` with an embeddable YouTube video, then open the associated concert room on the website.
6. If the browser asks for a click to start video, click its playback control. Browser autoplay restrictions are separate from the shared playback state.

Useful commands:

| Command | Purpose |
| --- | --- |
| `/play` | Add ordinary Discord music |
| `/concert url` | Add a public concert video |
| `/queue` | View the queue |
| `/now-playing` | Bring up the player |
| `/favorites` | Manage favorites |
| `/help` | Show the bot's help |

Bot descriptions, help, player controls and standard replies use English.
The 17 registered commands are `/play`, `/pause`, `/resume`, `/skip`, `/stop`,
`/disconnect`, `/queue`, `/now-playing`, `/favorites`, `/concert`, `/help`,
`/vote-skip`, `/history`, `/volume`, `/seek`, `/fseek` and `/cleanup`.
Use optional `next`, `now` and `shuffle` fields on `/play` instead of separate
advanced-play commands. Playback controls also remain on the player and in admin.

Open `/admin`, select an authorized Discord server and choose Settings for
persistent defaults. Audio, queue and voice groups cover bitrate, crossfade,
default volume, radio, playlist limits, queue page size, empty-queue delay,
leaving empty voice channels and voice ducking. Helpers show units and limits;
save confirmation requires the Core settings acknowledgment. Manage Server,
Administrator or server ownership is required; owner-password access stays
limited to the configured server.

`/config`, `/crossfade`, duplicate play commands and legacy aliases are omitted
from new registration. Cached `/config` and `/crossfade` calls privately link
to the selected server's admin page without changing settings. Other legacy
handlers remain compatible, including old play options and `antall` on history.
Unsupported chapter splitting remains unavailable. The two inactive announcement
settings are hidden from the form; stored/import fields remain unchanged.
The updated command definitions are registered when an approved Core update
starts normally. Source changes and local synthetic tests do not update Discord
registration on an existing deployment.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Docker permission denied | Confirm Docker is running and your user can run `docker version`. |
| Container exits immediately | Check the required values and bot token in `services/core/.env`; read the recent Core logs. |
| `/health` returns 503 | Discord is not ready yet. Check token validity, connectivity and startup logs. |
| Slash commands do not appear | Install the bot with `applications.commands` on the intended server; check startup logs for registration errors. |
| Bot cannot join or stays silent | Join a voice channel; verify Connect/Speak permissions, channel overrides, media availability and host networking. |
| Website reports missing tables | Apply the D1 migrations to the database actually bound as `DB`. |
| Duplicate table or column error | Initial migrations were rerun. Do not delete a populated database; inspect its schema and apply only missing changes. |
| Website cannot reach Core | Check `GUTTA_CORE_PUBLIC_URL`, HTTPS, proxy streaming and the public health endpoint. |
| Bridge authentication fails | The two bridge secret values must be identical. Recreate Core and update the deployed website secret. |
| Discord login fails or loops | Use HTTPS; verify the exact callback URI, website origin, client secret and application ID. |
| `EADDRINUSE` or container-name conflict | Another Core instance already uses port 3990 or `gutta-krutt-core`. Use a separate host for an independent installation. |
| UI loads but search fails | Configure the website's YouTube API key and check its quota. |

If you need help, open an [issue](https://github.com/lukasvri/Afterparty-MusicBot/issues) with your OS, Docker and Node versions, the failed step and redacted logs. Never post tokens, full environment files or private database contents.

**Next:** [Backups and updates](../services/core/PUBLIC_RELEASE.md) · [Configuration reference](CONFIGURATION.md)

## Existing installations after the repository rename

The canonical repository is `https://github.com/lukasvri/Afterparty-MusicBot`.
From your existing checkout, update its remote without moving the working directory:

```bash
git remote set-url origin https://github.com/lukasvri/Afterparty-MusicBot.git
git remote -v
```

Keep existing deployment configuration paths, data volumes and backups unchanged.
The example `/srv/Afterparty-MusicBot` path is for new installations only.

The owner identifies the hosted Afterparty website as
`https://ap.openworks.no` (22 October 2026). This documentation update does
not verify the live hosting, sign-in configuration or domain transition.
Self-hosted copies should continue using their own origins.

For an **approved** host migration, validate DNS/HTTPS, configure Core's
`PUBLIC_SITE_URL` and the website's `GUTTA_CORE_SITE_ORIGIN` for the actual
website origin, and register
`https://ap.openworks.no/api/auth/discord/callback` in the Discord Developer
Portal. Keep existing redirects and previous configuration until the new login
flow is verified, with rollback prepared. Never automatically change live
environment variables, Discord OAuth redirects or deployments from source
documentation alone.
