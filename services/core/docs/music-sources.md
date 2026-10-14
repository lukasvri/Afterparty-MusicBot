# Musikkjelder og lyd, versjon 1.6

## Bruk

- `/play query:<søk eller lenke>`: vanleg Discord-musikk. Spotify-spor, album og offentlege spelelister blir matcha til YouTube-lyd. Spotify URI-ar, regionale nettadresser og spotify.link-delingslenker er støtta.
- `/play query:sc: artist sang`: søk på SoundCloud. Vanlege SoundCloud-lenker, delingslenker og spelelister blir lesne gjennom yt-dlp. Køgrensa gjeld også her. Søket vel første tilgjengelege treff.
- `/konsert`: framleis YouTube-konsert med video på Afterparty og lyd i Discord. SoundCloud er ei lydkjelde i Discord, ikkje ein ny videotype på nettsida.
- `/config set-audio-quality kbps:192`: ønskt Opus-bitrate. Talekanalen set øvre grense. Innstillinga gjeld frå neste start av lydstraumen; eksisterande kryssfade endrar ikkje encoder midt i avspelinga. Same innstilling finst i det private adminpanelet.

## Spotify-matching

Spotify-katalogen leverer metadata og ISRC der tilgangen tillèt det. ISRC blir brukt som første søk, men eit søketreff blir ikkje rekna som bevist identisk innspeling. Kandidaten må også bestå kontroll av artist, tittel, lengd og kjende versjonsord. Deretter blir eit strengt tekstsøk brukt som reserve. Usikre treff gir ei forklarande feilmelding, ikkje ein tilfeldig song.

Godkjende treff blir lagra i sju dagar, med ny metadatakontroll før gjenbruk. Opptil tre songar blir matcha samtidig, men rekkjefølgja frå spelelista blir bevart. API-listene blir paginerte opp til den eksisterande køgrensa. Lokale Spotify-filer og podkastar blir ikkje behandla som songar. Den tidlegare offentlege embed-reserven er bevart dersom appen ikkje får lese ei offentleg liste gjennom API-et; denne kan ha færre metadata enn API-et. Private lister krev tilgang som denne boten ikkje har.

Dette strøymer ikkje Spotify sin originale lyd. Metadata og spelbar lydkjelde er separate. Tittelbasert reserve er framleis ei vurdering og kan ikkje garantere at alle innspelingar blir identifiserte rett.

## Radio

`LASTFM_API_KEY` ligg berre i den lokale .env-fila. Last.fm sine relaterte songar blir brukte som førsteval, med lokale favorittar som ekstra prioritet. Resultata blir mellomlagra eitt døgn. Nyleg spelte songar og radioforslag hoppa over før 60 sekund blir filtrerte bort. Slike hopp gir sju dagars cooldown, men hindrar ikkje eit uttrykkeleg manuelt songval.

Utan nøkkel, ved tenestefeil eller utan sikre treff går radioen tilbake til artistbasert utval. SoundCloud har også ein artistbasert reserve. Last.fm kan føre radioen vidare til ei anna spelbar kjelde. Eksisterande tidleg kølegging, eitt forslag om gongen og prioritet for manuelle val er bevarte.

### Website concert radio

With radio enabled, tracks queued from the website's Discord concert room now
continue with embeddable YouTube recommendations. Those recommendations retain
concert status so the video and Discord audio continue together. Ordinary
Discord radio remains private; live streams do not start radio. SoundCloud and
videos that cannot be embedded are excluded from concert recommendations.

A failed or empty lookup can retry after 15 seconds, with at most three attempts
per song. Switching radio off and back on starts a fresh selection and discards
results from the disabled selection. The admin player shows a message when no
recommendation is found. Radio needs a current track to choose related music;
it does not start music in an empty player.

## Lyd og avgrensingar

48 kHz stereo Opus og den eksisterande FFmpeg-kryssfaden er bevarte. Standardmålet er 192 kbit/s, avgrensa av den faktiske Discord-kanalen. SoundCloud vel beste tilgjengelege lydformat. YouTube bevarer den etablerte HLS-prioriteten for stabil avspeling. Høgare utgåande bitrate kan ikkje gjenopprette kvalitet som manglar i kjelda.

SoundCloud-spor må vere tilgjengelege for boten. Kjende førehandsvisingar blir avviste; private, geografisk sperra eller abonnementslåste spor er ikkje lova spelbare. Store spelelister kan ta tid å slå opp. Ei liste med eit utilgjengeleg spor kan feile før kølegging, slik at ein ikkje stille køar ei anna eller ufullstendig liste.

## Kontroll

Regresjonstestar omfattar kø, konsertskilje, synk, pause, tidslinje, oppstart og stopprace, offentleg tilgang, matcher, Spotify-paginering, SoundCloud-sett/søk, radiofallback og høgare Opus-bitrate. Isolerte prøver mot ekte tenester verifiserte Spotify til YouTube med ISRC, SoundCloud-søk, to spor frå NCS si SoundCloud-liste og PCM-dekoding, og Last.fm-anbefalingar med ein spelbar match. Dette er ikkje ei blind lyttesamanlikning eller ein garanti for heile katalogen.
