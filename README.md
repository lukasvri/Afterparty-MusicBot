# Gutta Krutt Afterparty

Open kjeldekode for ein Discord-musikkbot og ei nettside med synkroniserte konsertrom. Core 2.0.1 handterer lyd, kø, historikk og sanntidsklokke. Nettsida gir videorom og administrasjon av serverane dine.

## Funksjonar

- Discord-musikk med `/play`, radio, favorittar, lagra køer og eitt fast spelarkort.
- `/konsert` deler konsertvideo og avspelingsstatus med nettsida.
- FFmpeg/Opus, volum, spoling, pause og crossfade.
- Separate køer og databasar for kvar Discord-server.
- Discord OAuth for administrasjon og tilgangskontroll per server.
- SQLite med WAL, transaksjonar og gjenoppretting etter omstart.

## Arkitektur

`services/core/` er den sjølvhosta Node-motoren. `app/`, `components/`, `hooks/` og `lib/` er React/Vinext-nettsida. Nettsida brukar Cloudflare Workers og D1, med Sites-integrasjon i `build/`. Ho er ikkje ein ferdig, plattformuavhengig Node-server. Bindinga heiter `DB`; `.openai/hosting.json` inneheld berre generiske bindingar og ingen eksisterande prosjektidentitet.

Core må vere tilgjengeleg på ei HTTPS-adresse som nettsidetenesta kan nå. Docker eksponerer berre `127.0.0.1:3990`. Konfigurer sjølv ein HTTPS-proxy eller tunnel, og hald bro-nøkkelen hemmeleg. Core har ikkje eit eige adminpanel: administrasjonen ligg på `/admin` på nettsida.

## Start Core

Krav: Docker Engine med Compose v2. Bygginga brukar Node 24, FFmpeg og yt-dlp.

```sh
cd services/core
cp .env.example .env
# Fyll ut eigne verdiar i .env, inkludert botnøkkel og nettsideadresse.
docker compose build
docker compose up -d
./core-control.sh status
```

Opprett ei eiga Discord-applikasjon og bot. Legg boten til på serveren og set `DISCORD_GUILD_ID` til eigarserveren. OAuth krev `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` og ei registrert redirect-adresse på `https://DITT-DOMENE/api/auth/discord/callback`. Boten treng løyve til å sjå og sende meldingar, bruke lenker/embeds og kople til og snakke i talekanalar. Administrator er ikkje nødvendig.

`PUBLIC_SITE_ADMIN_KEY` i Core og `ADMIN_BRIDGE_KEY` på nettsida må vere same tilfeldig genererte hemmelegheit. `PUBLIC_SITE_URL` er nettsideadressa. `GUTTA_CORE_PUBLIC_URL` er HTTPS-adressa til Core. Det følgjer ikkje med nøklar eller ein ferdig produksjonskonto.

## Nettside og lokal utvikling

Krav: Node 24.17 eller nyare og npm. Kopier `.dev.vars.example` til `.dev.vars` og fyll ut eigne verdiar. Bruk `npm ci`, deretter `npm run dev`. Opprett tabellane i di eiga D1-database med SQL-migrasjonen i `drizzle/` før første bruk. Etter `npm run build` kan du bruke kommandoane nedanfor for lokal utvikling. Produksjon krev di eiga Wrangler-konfigurasjon og database. Produksjon krev ei eiga D1-binding og Workers/Sites-konfigurasjon; bruk aldri ein annan installasjon sin prosjektidentitet.

```sh
npm ci
npm run dev
# Kontroll av nettsidetypar, og Core-bygg med testar:
npm run project -- check
npm run test:fullscreen
```

Initialiser ei tom lokal database ved å køyre migrasjonane i rekkjefølgje, berre éin gong:

```sh
npm run build
for migration in drizzle/*.sql; do
  npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$migration"
done
```

For isolerte Core-testar:

```sh
docker build --target validation -t gutta-krutt-core:validation services/core
```

Docker-bygginga typekontrollerer og køyrer 60 testar, inkludert ekte FFmpeg/Opus, serverisolasjon, tilgang, kø, radio, databaseskriving og ytelsesmålingar. Testane brukar eigne data. `scripts/smoke.mjs` er ein integrasjonstest mot ei konfigurert testnettside, krev eigne nøklar og opprettar mellombelse rom.

## Data og drift

Compose lagrar data i det namngjevne volumet `core-data`. Ta sikkerheitskopi av heile volumet, inkludert `guilds/`. Bruk SQLite-backup eller stopp Core kontrollert før filkopiering. Ikkje bruk `docker compose down -v` dersom data skal bevarast. Sjå [driftsnotata](services/core/PUBLIC_RELEASE.md).

## Avgrensingar

YouTube brukar sin offisielle innebygde spelar. Spotify-lenker blir matcha mot tilgjengelege lydkjelder. Kapitteldeling og SponsorBlock er ikkje implementerte. Null forseinking mellom menneskelege klientar er ikkje garantert. Samtidig last frå fleire ekte Discord-serverar er ikkje dokumentert.

## Lisens og bidrag

MIT, sjå [LICENSE](LICENSE). Tredjepartskode har eigne bevarte lisensar, sjå [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Sjå [CONTRIBUTING.md](CONTRIBUTING.md) og [SECURITY.md](SECURITY.md).
