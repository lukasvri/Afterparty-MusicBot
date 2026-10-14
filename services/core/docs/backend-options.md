# Backendvurdering, 14. oktober 2026

Oppdatert: versjon 1.6 har no Spotify-matching med ISRC, SoundCloud-sett og søk, Last.fm-radio og justerbar lydkvalitet. Sjå [musikkjelder og lyd](music-sources.md). Teksten under dokumenterer vurderinga som førte til oppgraderinga.

Versjon 1.5 flyttar radio-utvalet til `src/radio.ts`. Motoren planlegg eitt forslag når den siste manuelt valde songen startar. FFmpeg førebur framleis neste lydstraum nær slutten. Kø og avspelingsklokke held fram med å ha éin eigar.

Radioen søkjer i YouTube sin musikkategori, prioriterer artisttreff og offisielle lydutgåver, filtrerer korte klipp, lange sett og vanlege uønskte titlar, og samanliknar songtitlar mot dei siste 50 avspelingane. Dette er ein konservativ artist-radio, ikkje ein modell som forstår sjanger eller musikalsk likskap. Tittelfilter kan både avvise gode treff og sleppe gjennom feilmerkte videoar. Utrygge treff blir ikkje brukte som reserve.

Søk blir mellomlagra i ein time. Eitt mislukka radiosøk blir ikkje repetert på kvar klokketikk. Søkeresultat frå før stopp eller deaktivering blir forkasta. Manuelle val erstattar radioforslaget, slik at radioen seinare tek utgangspunkt i den nye songen.

## Vidare alternativ

- **Betre musikkatalog og tilbakemeldingar:** Artist- og innspelings-ID-ar, eksplisitt «ikkje spel denne igjen» og preferansar per rom kan gi betre variasjon og meir påliteleg duplikatkontroll. Dette er det mest relevante neste steget for radiokvalitet. Det krev metadata og tydelege lagringsreglar; dagens tittelheuristikk gir ikkje same presisjon.
- **Lavalink:** Eiga lydteneste med REST, avspelingshendingar, søking i avspelinga og driftsmålingar. Aktuelt ved fleire Discord-serverar eller behov for å isolere lydarbeidet. Ein overgang krev ei eiga verifisering av delt avspelingsklokke, gjenoppretting og noverande kryssfade. Dokumentasjonen gir ikkje grunnlag for å love betre radioval berre ved motorbyte.
- **LavaSrc:** Fleire kjelder via Lavalink kan utvide katalogen. Tilgang, spegling til ei spelbar kjelde og metadata-match må kontrollerast separat. Ikkje installert i denne endringa.
- **Driftsmålingar:** Søkefeil, tid til neste forslag og lydavbrot bør målast før ei større utskifting, så forbetringa kan dokumenterast. Eksisterande `radioError` held siste søkefeil lokalt; det er ikkje eit fullstendig målesystem.

Kjelder kontrollerte 14. oktober 2026:
- https://developers.google.com/youtube/v3/docs/search/list
- https://lavalink.dev/
- https://github.com/topi314/LavaSrc
