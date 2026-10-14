# Offentleg drift, Core 2.0

Administrasjon og botinvitasjon er samla på `/admin` på den konfigurerte nettsideadressa. «Public Bot» må vere slått på i Discord. Innlogging brukar `identify` og `guilds`, og krev servereigar, Administrator eller Manage Server. Botinvitasjonen krev ikkje Administrator.

## Serverar og tilgang

Éin Discord-klient handterer fleire serverar. Kvar server har eigen motor, lydtilkopling, kø, innstillingar, favorittar, lagra køer og kommandologg. Eigaren sin gamle database og romkode `DISCORD1` blir bevarte. Nye serverar får stabile romkodar og databasar under `/data/guilds/<server-id>/core.sqlite`.

Discord-innlogging gir berre administrasjon av serverar brukaren faktisk administrerer. Rettane blir kontrollerte mot Discord ved private førespurnader. Økta varer høgst åtte timar. OAuth-tilstanden kan berre brukast éin gong. Nettlesaren får ei HttpOnly-økt, ikkje botnøkkelen eller Discord-tilgangstokenet.

Det gamle passordet er ein reserve for eigarserveren. Det gir ikkje tilgang til andre serverar. Port 3847 og det separate adminpanelet er stengde. Berre loopback-port 3990 blir publisert frå containeren til den eksisterande Tailscale-transporten.

## Avspeling

`/play` spelar vanleg Discord-musikk med den faste spelarmeldinga. `/konsert` og tillegg frå nettsida blir viste i den aktuelle serveren sitt videorom. Pause, fortsett og neste i konsertrommet styrer same avspeling. Vanlege videorom bevarer vertskontrollen og vernar mot utdaterte og samtidige kommandoar.

Administrasjonen har spelar, køredigering, spoling, volum, gjentaking, radio, lydkvalitet, kanalval, stopptimer og lagra køer. Videoskipping finst òg i fullskjerm, utan ei ekstra rad som reduserer videoflata.

Medieoppslag er mellomlagra og har høgst fire samtidige utpakkingsprosessar og seksten ventande oppslag. Lydstart får prioritet framfor søk. YouTube-søk har reserve ved brukt API-kvote. Maksimalt åtte samtidige taletilkoplingar er standardgrensa på denne maskina; dette er ei ressursgrense, ikkje dokumentasjon av lastkapasitet.

## Drift og gjenoppretting

Bruk `services/core/core-control.sh` som felles kontroll for start, stopp, status, logg og admin. Boten krev at PC-en, Docker, nettverket og Tailscale er tilgjengelege. Nettsida si feilmelding ved tapt sanntidstilkopling skal ikkje tolkast som ei ny avspelingskommando.

Ta sikkerheitskopi av heile datamappa, inkludert `guilds/`. Stopp boten før filkopiering av SQLite-filer, eller bruk SQLite si backup-funksjon for kvar database. Ei kopi av berre eigardatabasen bevarer ikkje nye serverar. Kopien `before-public-2.0.sqlite` er frå før oppgraderinga og gjeld berre eigarserveren.

Gjenoppretting etter at fleire serverar er installerte må bruke ein kompatibel 2.x-motor. Dei eldre motorane er ikkje trygge å starte mot denne fleirserverinstallasjonen. Bevar databasekopiar før vidare migrasjonar.

## Kontroll og avgrensingar

Core har 60 automatiske testar, inkludert isolasjon mellom to simulerte serverar, OAuth-rettar, utløp og manipulering, kø, pause, konsertfiltrering, FFmpeg og lydkvalitet. Nettsidetesten kontrollerer rom, delte tilstandar, faktisk videoskipping, tilgang, versjonskonfliktar og opprydding. Éin ekte Discord-server er brukt under oppgraderinga; to ekte serverar med samtidige lyttarar er enno ikkje lasttesta.

YouTube styrer kvalitet og teksting i sin offisielle spelar. Spotify-lenker blir matcha mot YouTube-lyd. SoundCloud blir spela som lyd. Null forseinking mellom menneskelege klientar kan ikkje garanterast med separate nettverk, Discord-bufferar og YouTube-spelarar. Kapitteldeling og SponsorBlock er framleis kjende funksjonsavgrensingar frå overgangen til Core, sjå README.

## Ytelsesforbetringar i Core 2.0.1

Historikk og kommandologg har indeksar for tidsrekkjefølgje og usende resultat. Kø og gjeldande spor blir lagra atomisk i éin transaksjon; kvitteringar blir òg skrivne samla. SQLite brukar framleis WAL og synchronous=FULL, og gjenopprettingsposisjonen blir framleis lagra kvart sekund under avspeling.

Klokkehendinga er eit signal utan full tilstand. Transporten hentar tilstand når han skal sende henne. Køhashen blir gjenbrukt når innhaldet som definerer køversjonen er uendra.

Svartid og event-loop-p95 gjeld eit rullerande vindauge på om lag 60 sekund, med sekundoppløysing. Event-loop-talet måler no ekstra forseinking utover eit 20 ms timerintervall, og kan ikkje samanliknast direkte med det gamle histogrammet som inkluderte intervallet. requestCount er framleis totalt sidan oppstart; windowRequestCount gjeld målevindauget.

Isolert samanlikning med 50 000 syntetiske historikkrader og 50 000 kommandoar gav median 32,99 til 0,15 ms for historikk og 22,63 til 0,26 ms for kommandologg. Ein tomgangstick med 500 køelement gjekk frå 0,062 til 0,00069 ms. Dette er mikrotestar, ikkje dokumentasjon av kapasitet med fleire aktive Discord-serverar.
