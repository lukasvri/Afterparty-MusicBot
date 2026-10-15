# Changelog

Generated from `lib/releases.json` and `lib/legacy-updates.ts`. Do not edit by hand.
Release entries describe source versions, not production deployment status.
See [release policy](docs/RELEASING.md).

## v2.0.3: Visible room controls and radio retry cooldown

2026-10-15

- When an early skip shares an empty radio search with automatic prefetch, the current song keeps playing and a persisted 15 second cooldown prevents repeated provider searches on every room tick.
- Radio on/off is visible beside the room controls. The queue restores the current song card, artwork and artist information.

## v2.0.2: Native YouTube seeking and reliable early skips

2026-10-15

- YouTube is the only seek bar in video rooms. Confirmed native seeks update the shared room, while buffering and delayed automatic corrections are not published as user seeks.
- Early skips share an in-flight radio lookup with prefetch. A failed lookup keeps the current song playing; a safe single retry handles queue revisions arriving during a skip.
- Radio begins preparing the next song as playback starts. Genre matching now also uses explicit tags and genre labels in provider metadata, not just the video title.
- Queue controls are located under room settings. The welcome page expands across large displays, including 2560 by 1440.

## v2.0.1: Stable live playback and a quieter room

2026-10-15

- Video buffering and iframe time updates no longer publish accidental host seek commands. Explicit shared seeking is available in video settings.
- Tight sync remains the default. Small reporting jitter is ignored, sustained drift is corrected, and intentional room seeks are applied promptly. Older snapshots cannot rewind the same room revision.
- Live playback events preserve the website participant count instead of replacing it with the Core placeholder.
- Room and queue options are collapsed by default. Duplicate track cards, extra toolbars and promotional copy have been removed.
- Radio uses explicit genre labels to find similar tracks across artists and favours artist variety. Empty or failed searches get a second attempt, and radio can restart from listening history. Without genre metadata it falls back to artist matching, never an arbitrary result from the same upload channel.
- Radio prepares a visible next track during the final 30 seconds, rejects live remakes and covers, and gives manually queued songs priority. Turning radio off removes its prepared suggestion.

## v2.0.0: Your people, your music: Afterparty v2

2026-10-15

- A new welcome page puts the animated stage, private room creation, invitations and patch notes up front. The DJ and lighting rig stay fully visible on mobile and desktop.
- Core now advances room playback even when the host disconnects. Shared queue rules protect concurrent requests and preserve newer songs when undoing changes.
- Guests can request songs, vote and vote to skip. Hosts can moderate requests, reorder the queue and undo queue changes.
- Invite cohosts with single-use links, revoke access or transfer room ownership. Share rooms by link or QR code and open a focused TV view.
- Keep device-local favorites, editable saved evenings and listening history, with validated import and export.
- Mobile navigation, first-song search, English copy and admin volume and seek controls have been improved. Browser transport, player setup and room logic are separated into reusable modules.

## v1.0.0: Shared semantic versioning for Afterparty

2026-10-15

- Website and Core share version 1.0.0. New releases use vMAJOR.MINOR.PATCH instead of integer version labels.
- Bug fixes increment PATCH; larger updates increment MINOR and reset PATCH; massive updates increment MAJOR and reset MINOR and PATCH.
- Website release notes, CHANGELOG.md and GitHub release notes are generated from the same release data. Historical V05 to V36 entries remain available with their original numbering and wording.
- Afterparty owns its player navigation and Discord command definitions. Unused Muse reference code is removed while required license notices, saved browser preferences, existing player buttons and offline data imports are preserved.

## Historical integer versions

Original dates, numbering and Norwegian wording are preserved.

### V36: Sentrert kø og en ny DJ-figur

14. oktober 2026

- Tom kø har et sentrert lydikon, overskrift, forklaring og musikknapp.
- DJ-en har fått caps, tydeligere hodetelefoner, en hånd ved øret og en hånd på mikseren. Nye detaljer på konsollen og roligere hodebevegelse.

### V35: Ryddigere spiller og et mer detaljert DJ-sett

14. oktober 2026

- Køfanen har tydeligere tekst, sentrerte ikoner og jevne proporsjoner. Den klare rødfargen er tilbake.
- Musikksøket strekker ikke lenger videopanelet. Merket i videohjørnet er fjernet.
- Fullskjerm har én samlet kontrollrad og et eget innstillingspanel, med plass til YouTubes kontroller.
- Scenen har detaljerte DJ-spillere, miksebord, høyttalerstakker og animerte LED-ringer.

### V34: Åpne rom og mer liv på scenen

14. oktober 2026

- Åpne rom erstatter den doble Discord-lenken. Finn et offentlig rom og bli med uten konto. Verten velger om rommet skal vises.
- Velg bokmål eller engelsk. Språket huskes på enheten.
- Ny DJ, bevegelige lasere og scenelys med lyskilder og stråler som henger sammen. Mobilvisningen er tilpasset den nye scenen.

### V33: Ei scene for Afterparty

14. oktober 2026

- Ny illustrert konsertscene med lysrigg, scenelys, djupn og publikumssilhuettar når ingen video er vald.
- Samla fargar, typografi, knappar og avstandar, med tydelegare kø og musikksøk på mobil og stor skjerm.
- Rørsle i scenelys og mjukare overgangar i kontrollane. Animasjonar kan slåast av og følgjer innstillinga for redusert rørsle.

### V31: Utlogging av alle adminøkter

14. oktober 2026

- Logg ut avslutter Discord- og passordøkten, og logger også ut nettsidens eierkonto når den er aktiv.
- Rettet at kontrollrommet åpnet seg igjen umiddelbart etter utlogging.

### V30: Flere Discord-servere, ett kontrollrom

14. oktober 2026

- Boten har egen kø, innstillinger, favoritter og videorom for hver Discord-server.
- Discord-innlogging gir administrasjon av serverne du har rettigheter til. Legg til boten direkte fra nettsiden.
- Spiller, kø, radio, lydkvalitet, kanaler, lagrede køer og stopptimer er samlet under Admin. Det separate adminpanelet er stengt.
- Neste video er tilgjengelig også i fullskjerm. /play er fortsatt Discord-musikk, mens /konsert vises på nettsiden.
- Medieoppslag er mellomlagret og begrenset, med prioritert lydstart og reserve ved brukt YouTube-kvote.

### V19: Romvideo og én felles motor

14. oktober 2026

- Nettsiden, boten og rommotoren er samlet i ett prosjekt med en felles klokke og protokoll.
- Vanlige videorom får løpende status uten å vente på rompolling. Start og spoling avtales på et felles tidspunkt.
- Videospilleren starter med riktig video og viser innlasting eller retry ved feil. Spill for alle er synlig under videoen.
- Fullskjerm har ingen vignett eller skygge over bildet. Små kontroller ligger i hjørnene.
- Tett synk korrigerer mindre avvik. Nettverk, YouTube og autoplay kan fortsatt gi lokale avvik.

### V11: Egen motor og direkte synk

14. oktober 2026

- Gutta Krutt har fått egen avspillingsmotor for Discord, med kø, favoritter, crossfade og faktisk lydklokke.
- Discord-rommet får løpende status via WebSocket eller en kontinuerlig HTTP-strøm. Kontaktens rundtur vises nederst på siden.
- Pause, fortsett og neste sang sendes direkte til den nye motoren. Kortlevde, signerte kommandoer brukes som reserve. Felles avspilling gjelder alle.
- Når kontakten brytes, prøves tilkoblingen på nytt og broen brukes som reserve. Videoen stopper hvis statusen blir for gammel.
- Videospilleren beholder én tidslinje, én volumkontroll og kvalitet og teksting fra YouTube.

### V10: Tett synk som standard

14. oktober 2026

- Tett synk er standard når du ikke har valgt en annen synkmodus på enheten.
- Romstatus hentes hvert sekund mens siden er synlig, tidligere hvert andre sekund. Skjulte faner henter hvert fjerde sekund.
- Tett synk venter 1,5 sekunder etter bufring før nye korrigeringer tillates, tidligere fire sekunder. Det gjøres fortsatt ingen synkhopp mens videoen bufrer.
- Svar på botkommandoer sjekkes hvert halve sekund, tidligere hvert 1,5 sekund. Dette reduserer ventingen etter at boten har svart.

### V09: Enklere videokontroller og roligere synk

14. oktober 2026

- Én tidslinje og én volumkontroll i videoen, og én utgang fra fullskjerm. Øvrige valg er samlet under Videoinnstillinger.
- Velg kvalitet med tannhjulet og slå teksting av eller på med CC når videoen har teksting. Velg 1440p eller lavere manuelt; YouTube Auto kan ikke begrenses av nettsiden.
- Stabil avspilling er standard: færre automatiske tidshopp og en hvileperiode etter bufring. Tettere synk kan velges og lagres lokalt.
- Ny bufremelding og lokal omlasting av videoen, uten å bytte sang i rommet eller Discord.
- Pause, fortsett og neste sang i Discord gjelder både musikken og videoene for alle. Vertens play/pause i egne rom styrer felles avspilling. Volum og mute fra videoen lagres på enheten.
- Snarveier: F for fullskjerm og M for mute.

### V08: Bunnlinje i sideinnholdet

14. oktober 2026

- Bunnlinjen ligger nederst i sideinnholdet og følger siden når du scroller.
- Patch notes og Admin er fortsatt tilgjengelige der.

### V07: Fast bunnlinje og patch notes

14. oktober 2026

- Botstatus, romkode og Admin ligger fast nederst på skjermen.
- Ny knapp til denne endringsloggen.
- Bunnlinjen tilpasser seg mobil og gir innholdet plass over seg.

### V06: Synk, felles kø og nytt grensesnitt

14. oktober 2026

- Botens tidsmåling følger avspilte lydpakker, også ved pause og bufring.
- Videoavvik korrigeres automatisk. Finjustering lagres på enheten din.
- Legg til sanger og hopp over nåværende sang i Discord fra nettsiden.
- Kø og musikksøk er samlet ved siden av videoen i et nytt svart og rødt grensesnitt.
- Rettet oppstart fra tom Discord-kø, dobbeltklikk, rombytte og søkestatus.
- Adminsøket fungerer uten å blokkere avspillingskontrollene.

### V05: Nettsiden og boten samlet

13. oktober 2026

- Gutta Krutt Afterparty fikk bokmål, svart og rød profil og et samlet adminpanel.
- Forslagene hentes fra faktiske avspillinger, med nylig og mest spilt.
- Discord-video, kø og posisjon speiles på nettsiden.
- Fullskjerm skjuler kontrollene når de ikke er i bruk. Volum og mute lagres separat.
- Passordbeskyttet admin styrer boten og videorommene.
