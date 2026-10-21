import {partyMessages} from "./party-messages";
export type Language = "nb" | "en";
export const messages: Record<string, readonly [string, string]> = {
 "Approve {title}":["Godkjenn {title}","Approve {title}"],
 "Reject {title}":["Avvis {title}","Reject {title}"],
 "Move down {title}":["Flytt ned {title}","Move down {title}"],
 "Radio finds related songs and avoids recent repeats.":["Radio finner lignende sanger og unngår nylige gjentakelser.","Radio finds related songs and avoids recent repeats."],
 "Frå":["Fra","From"],
 "Updating queue…":["Oppdaterer køen…","Updating queue…"],
 "1 track":["1 sang","1 track"],
 "Loading queue …":["Laster køen …","Loading queue …"],
 "{count} tracks":["{count} sanger","{count} tracks"],
 "Connect the bot to a Discord voice channel before adding music.":["Koble boten til en talekanal i Discord før du legger til musikk.","Connect the bot to a Discord voice channel before adding music."],
 "This video cannot be played in a browser room.":["Denne videoen kan ikke spilles i et nettleserrom.","This video cannot be played in a browser room."],
 "Artist test answer: Synthetic Test Generator.":["Testsvar for artist: Synthetic Test Generator.","Artist test answer: Synthetic Test Generator."],
 "Listen, then answer with the song title or artist.":["Lytt, og svar med sangtittelen eller artisten.","Listen, then answer with the song title or artist."],
 "Use a short answer without control characters.":["Skriv et kort svar uten kontrolltegn.","Use a short answer without control characters."],
 "This round is not accepting another skip vote from you.":["Du kan ikke avgi en ny stemme for å hoppe over denne runden.","This round is not accepting another skip vote from you."],
 "Answer mode":["Svartype","Answer mode"],
 "Artist name":["Artistnavn","Artist name"],
 "Artist mode needs an updated Core.":["Artistmodus krever en oppdatert Core.","Artist mode needs an updated Core."],
 "Who’s the artist?":["Hvem er artisten?","Who’s the artist?"],
 "Not quite. Try another artist.":["Ikke helt. Prøv en annen artist.","Not quite. Try another artist."],
 "The artist was":["Artisten var","The artist was"],
 "{count} words in the artist name":["{count} ord i artistnavnet","{count} words in the artist name"],
 "Game presets":["Spilloppsett","Game presets"],
 "Quick (15 seconds)":["Raskt (15 sekunder)","Quick (15 seconds)"],
 "Classic (30 seconds)":["Klassisk (30 sekunder)","Classic (30 seconds)"],
 "Presets use up to five eligible recordings. Save settings before starting.":["Oppsettene bruker opptil fem kvalifiserte opptak. Lagre innstillingene før du starter.","Presets use up to five eligible recordings. Save settings before starting."],
 "Skip this round":["Hopp over denne runden","Skip this round"],
 "Vote to skip":["Stem for å hoppe over","Vote to skip"],
 "Skip vote recorded":["Stemmen din er registrert","Skip vote recorded"],
 "{votes} of {required} votes to reveal this round":["{votes} av {required} stemmer for å vise svaret","{votes} of {required} votes to reveal this round"],
 "Skip voting needs an updated Core.":["Avstemning krever en oppdatert Core.","Skip voting needs an updated Core."],
 "A majority of everyone who joined this game is required, including disconnected players. The host can reveal the answer if voting stalls.":["Det kreves flertall blant alle som har blitt med i spillet, også frakoblede spillere. Verten kan vise svaret hvis avstemningen stopper opp.","A majority of everyone who joined this game is required, including disconnected players. The host can reveal the answer if voting stalls."],
 "Game catalog connected":["Spillkatalog tilkoblet","Game catalog connected"],
 "Choose a category and settings that fit its available recordings.":["Velg en kategori og innstillinger som passer til de tilgjengelige opptakene.","Choose a category and settings that fit its available recordings."],
 "Available recordings are supplied by the connected Core. No music is bundled with this website.":["Tilgjengelige opptak leveres av tilkoblet Core. Ingen musikk følger med dette nettstedet.","Available recordings are supplied by the connected Core. No music is bundled with this website."],
 "No eligible recordings are available for this category.":["Ingen kvalifiserte opptak er tilgjengelige i denne kategorien.","No eligible recordings are available for this category."],
 "Choose rounds of {seconds} seconds or less for this category.":["Velg runder på maksimalt {seconds} sekunder i denne kategorien.","Choose rounds of {seconds} seconds or less for this category."],
 "Only {count} distinct recordings fit {seconds}-second rounds. Reduce the rounds or duration.":["Bare {count} ulike opptak passer til runder på {seconds} sekunder. Velg færre eller kortere runder.","Only {count} distinct recordings fit {seconds}-second rounds. Reduce the rounds or duration."],
 "Up to {count} rounds are available at {seconds} seconds.":["Opptil {count} runder er tilgjengelige ved {seconds} sekunder.","Up to {count} rounds are available at {seconds} seconds."],
 "Synthetic audio test":["Syntetisk lydtest","Synthetic audio test"],
 "Synthetic test only: generated tones and fictional titles. No real songs or provider music.":["Kun syntetisk test: genererte toner og oppdiktede titler. Ingen ekte sanger eller leverandørmusikk.","Synthetic test only: generated tones and fictional titles. No real songs or provider music."],
 "Test answers: Test Tone One, Test Tone Two, Test Tone Three, Test Tone Four, Test Tone Five.":["Testsvar: Test Tone One, Test Tone Two, Test Tone Three, Test Tone Four, Test Tone Five.","Test answers: Test Tone One, Test Tone Two, Test Tone Three, Test Tone Four, Test Tone Five."],
 "Choose up to five generated test tones and rounds of up to 30 seconds.":["Velg opptil fem genererte testtoner og runder på opptil 30 sekunder.","Choose up to five generated test tones and rounds of up to 30 seconds."],
 "This tests the shared game flow, not a song catalog or music rights.":["Dette tester den delte spillflyten, ikke en sangkatalog eller musikkrettigheter.","This tests the shared game flow, not a song catalog or music rights."],
 "Cancel preview":["Avbryt lydklipp","Cancel preview"],
 "Preview audio is private to this game round.":["Lydklippet er knyttet til denne spillrunden.","Preview audio is private to this game round."],
 "The lobby changed while you edited. Review the latest settings.":["Lobbyen ble endret mens du redigerte. Se gjennom de nyeste innstillingene.","The lobby changed while you edited. Review the latest settings."],
 "Use latest settings":["Bruk nyeste innstillinger","Use latest settings"],
 "Games":["Spill","Games"],
 "Back to music":["Til musikken","Back to music"],
 "MUSIC QUIZ":["MUSIKKQUIZ","MUSIC QUIZ"],
 "Quick ears. Late hints. Every second counts.":["Raske ører. Sene hint. Hvert sekund teller.","Quick ears. Late hints. Every second counts."],
 "Catalog in development":["Musikkatalog under utvikling","Catalog in development"],
 "Find your next music challenge":["Finn din neste musikkutfordring","Find your next music challenge"],
 "Built-in categories will pick the songs. A rights-cleared music catalog is still required before real rounds are available.":["Innebygde kategorier skal velge sangene. En rettighetsavklart musikkatalog må på plass før ekte runder blir tilgjengelige.","Built-in categories will pick the songs. A rights-cleared music catalog is still required before real rounds are available."],
 "Available":["Tilgjengelig","Available"],
 "Catalog not connected":["Musikkatalog mangler","Catalog not connected"],
 "Join your room’s game lobby":["Bli med i rommets spillobby","Join your room’s game lobby"],
 "Games use your existing room or Discord server access. Music queues and playback stay separate.":["Spill bruker tilgangen til rommet eller Discord-serveren din. Musikkøer og avspilling holdes adskilt.","Games use your existing room or Discord server access. Music queues and playback stay separate."],
 "Discord server":["Discord-server","Discord server"],
 "Room code":["Romkode","Room code"],
 "Nickname":["Kallenavn","Nickname"],
 "Choose a game nickname":["Velg et kallenavn","Choose a game nickname"],
 "Join lobby":["Bli med","Join lobby"],
 "Find or create a private room":["Finn eller lag et privat rom","Find or create a private room"],
 "Play for the top spot":["Spill om førsteplassen","Play for the top spot"],
 "Choose a built-in category.":["Velg en innebygd kategori.","Choose a built-in category."],
 "Listen, then type the song title.":["Lytt, og skriv sangtittelen.","Listen, then type the song title."],
 "Answer early for more points. Late hints help you catch up.":["Svar tidlig for flere poeng. Sene hint hjelper deg videre.","Answer early for more points. Late hints help you catch up."],
 "The host can change rounds, time, points and hints in the lobby.":["Verten kan endre runder, tid, poeng og hint i lobbyen.","The host can change rounds, time, points and hints in the lobby."],
 "No songs or music rights are bundled with this source candidate. Real catalog discovery and audio remain unavailable.":["Ingen sanger eller musikkrettigheter følger med denne kildekandidaten. Ekte musikkatalog og lyd er ennå ikke tilgjengelige.","No songs or music rights are bundled with this source candidate. Real catalog discovery and audio remain unavailable."],
 "Game lobby":["Spillobby","Game lobby"],
 "Leave game":["Forlat spillet","Leave game"],
 "Reconnect game":["Koble til spillet igjen","Reconnect game"],
 "Joining the game…":["Kobler til spillet…","Joining the game…"],
 "Guess the song round":["Gjett sangen-runde","Guess the song round"],
 "LOBBY":["LOBBY","LOBBY"],
 "LISTEN & GUESS":["LYTT OG GJETT","LISTEN & GUESS"],
 "THE REVEAL":["SVARET","THE REVEAL"],
 "RESULTS":["RESULTATER","RESULTS"],
 "Round":["Runde","Round"],
 "The room is ready. Are you?":["Rommet er klart. Er ørene klare?","The room is ready. Are you?"],
 "Start game":["Start spillet","Start game"],
 "Time remaining":["Tid igjen","Time remaining"],
 "points available":["mulige poeng","points available"],
 "Round progress":["Rundefremdrift","Round progress"],
 "What’s the song?":["Hva heter sangen?","What’s the song?"],
 "If music is playing in Discord or another tab, mute it locally before listening. Game audio never controls that playback.":["Spilles musikk i Discord eller en annen fane, demp den lokalt før du lytter. Spillyden styrer aldri den avspillingen.","If music is playing in Discord or another tab, mute it locally before listening. Game audio never controls that playback."],
 "Song title":["Sangtittel","Song title"],
 "Send guess":["Send svar","Send guess"],
 "Correct! Points saved for this round.":["Riktig! Poengene er lagret for denne runden.","Correct! Points saved for this round."],
 "Not quite. Try another title.":["Ikke helt. Prøv en annen tittel.","Not quite. Try another title."],
 "Artist starts with {letter}":["Artisten begynner med {letter}","Artist starts with {letter}"],
 "{count} words in the title":["{count} ord i tittelen","{count} words in the title"],
 "Round ended. Waiting for the server reveal…":["Runden er ferdig. Venter på svaret fra serveren…","Round ended. Waiting for the server reveal…"],
 "The song was":["Sangen var","The song was"],
 "Waiting for the reveal…":["Venter på svaret…","Waiting for the reveal…"],
 "players found it":["spillere fant svaret","players found it"],
 "That’s a wrap. Play another?":["Ferdigspilt. En gang til?","That’s a wrap. Play another?"],
 "Reveal answer":["Vis svaret","Reveal answer"],
 "Next round":["Neste runde","Next round"],
 "End game":["Avslutt spillet","End game"],
 "New game":["Nytt spill","New game"],
 "Scoreboard":["Poengtavle","Scoreboard"],
 "Fast answers win more points.":["Raske svar gir flere poeng.","Fast answers win more points."],
 "you":["deg","you"],
 "Nicknames belong to this game. They are not Discord identities.":["Kallenavn gjelder dette spillet. De er ikke Discord-identiteter.","Nicknames belong to this game. They are not Discord identities."],
 "Game settings":["Spillinnstillinger","Game settings"],
 "Category":["Kategori","Category"],
 "Round seconds":["Sekunder per runde","Round seconds"],
 "Rounds":["Runder","Rounds"],
 "Starting points":["Startpoeng","Starting points"],
 "Minimum points":["Minstepoeng","Minimum points"],
 "Late hints":["Sene hint","Late hints"],
 "Save game settings":["Lagre spillinnstillinger","Save game settings"],
 "Settings lock when the game starts. Earlier scores never change.":["Innstillingene låses når spillet starter. Tidligere poeng endres aldri.","Settings lock when the game starts. Earlier scores never change."],
 "Listen to preview":["Lytt til forhåndsvisning","Listen to preview"],
 "Stop preview":["Stopp forhåndsvisning","Stop preview"],
 "Synthetic test audio. Not a playable music catalog.":["Syntetisk testlyd. Ingen spillbar musikkatalog.","Synthetic test audio. Not a playable music catalog."],
 "Music preview awaits a reviewed catalog adapter.":["Musikklyd venter på en gjennomgått katalogadapter.","Music preview awaits a reviewed catalog adapter."],
 "Games need a connected, updated Core.":["Spill trenger en tilkoblet og oppdatert Core.","Games need a connected, updated Core."],
 "Games pause while this tab is hidden.":["Spill settes på pause mens fanen er skjult.","Games pause while this tab is hidden."],
 "You are offline. Reconnect to play.":["Du er frakoblet. Koble til igjen for å spille.","You are offline. Reconnect to play."],
 "Reconnecting the game…":["Kobler til spillet igjen…","Reconnecting the game…"],
 "Games & extras":["Spill og tillegg", "Games & extras"],
 "Choose an optional concert extra":["Velg et valgfritt konserttillegg", "Choose an optional concert extra"],
 "Choose an extra":["Velg et tillegg", "Choose an extra"],
 "Live reactions":["Direktereaksjoner", "Live reactions"],
 "All extras":["Alle tillegg", "All extras"],
 "Close extras":["Lukk tillegg", "Close extras"],

 "Your access changed. Reconnect to check your concert permissions.":["Tilgangen din er endret. Koble til igjen for å kontrollere konserttillatelsene.","Your access changed. Reconnect to check your concert permissions."],
 "Concert together":["Konsert sammen", "Concert together"],
 "Preview":["Forhåndsvisning", "Preview"],
 "Reactions, concert bingo & shared moments":["Reaksjoner, konsertbingo og felles øyeblikk", "Reactions, concert bingo & shared moments"],
 "Shared with this concert":["Delt med denne konserten", "Shared with this concert"],
 "Shared with this room":["Delt med dette rommet", "Shared with this room"],
 "Disable extras":["Slå av konserttillegg", "Disable extras"],
 "Enable extras":["Slå på konserttillegg", "Enable extras"],
 "Reconnect extras":["Koble til konserttillegg igjen", "Reconnect extras"],
 "Sign in with Discord":["Logg inn med Discord", "Sign in with Discord"],
 "Waiting for a shared playback session.":["Venter på en felles avspillingsøkt.", "Waiting for a shared playback session."],
 "Joining the concert…":["Kobler til konserten…", "Joining the concert…"],
 "The host has turned concert extras off.":["Verten har slått av konserttilleggene.", "The host has turned concert extras off."],
 "Send a live reaction":["Send en reaksjon", "Send a live reaction"],
 "Fire":["Flammer", "Fire"],
 "Love":["Kjærlighet", "Love"],
 "Applause":["Applaus", "Applause"],
 "Rock on":["Rock videre", "Rock on"],
 "Sparkle":["Glitter", "Sparkle"],
 "Celebrate":["Feiring", "Celebrate"],
 "React":["Reager", "React"],
 "Reaction sent":["Reaksjon sendt", "Reaction sent"],
 "Concert bingo":["Konsertbingo", "Concert bingo"],
 "Watch together. The host marks each moment as it happens.":["Se sammen. Verten markerer hvert øyeblikk når det skjer.", "Watch together. The host marks each moment as it happens."],
 "Shared bingo card":["Felles bingobrett", "Shared bingo card"],
 "This card has ended.":["Dette brettet er avsluttet.", "This card has ended."],
 "Bingo! A shared line to remember.":["Bingo! En felles rekke å huske.", "Bingo! A shared line to remember."],
 "Tap a square when you spot it.":["Trykk på en rute når du ser øyeblikket.", "Tap a square when you spot it."],
 "Your host is calling the moments.":["Verten markerer øyeblikkene.", "Your host is calling the moments."],
 "A little more to look out for":["Litt mer å se etter", "A little more to look out for"],
 "Pick nine concert moments and start a shared card.":["Velg ni konsertøyeblikk og start et felles brett.", "Pick nine concert moments and start a shared card."],
 "Your host can start a shared concert card.":["Verten kan starte et felles konsertbrett.", "Your host can start a shared concert card."],
 "Moment {number}":["Øyeblikk {number}", "Moment {number}"],
 "Enter nine different, non-empty moments without control characters.":["Skriv ni ulike øyeblikk. Ingen felt kan være tomme eller inneholde kontrolltegn.", "Enter nine different, non-empty moments without control characters."],
 "Start card":["Start brett", "Start card"],
 "Cancel":["Avbryt", "Cancel"],
 "New card":["Nytt brett", "New card"],
 "Create card":["Lag brett", "Create card"],
 "End card":["Avslutt brett", "End card"],
 "Shared moments":["Felles øyeblikk", "Shared moments"],
 "Save the current shared timestamp with a short note. Links only, no recordings.":["Lagre gjeldende felles tidspunkt med en kort merknad. Bare lenker, ingen opptak.", "Save the current shared timestamp with a short note. Links only, no recordings."],
 "What made this moment?":["Hva gjorde dette øyeblikket spesielt?", "What made this moment?"],
 "That solo. That crowd. That feeling.":["Den soloen. Det publikummet. Den følelsen.", "That solo. That crowd. That feeling."],
 "Save this moment":["Lagre øyeblikket", "Save this moment"],
 "Moment saved":["Øyeblikket er lagret", "Moment saved"],
 "Opens in a new tab":["Åpnes i en ny fane", "Opens in a new tab"],
 "Remove moment: {text}":["Fjern øyeblikk: {text}", "Remove moment: {text}"],
 "The best moments deserve a bookmark.":["De beste øyeblikkene fortjener et bokmerke.", "The best moments deserve a bookmark."],
 "Optional extras. Your music keeps playing.":["Valgfrie konserttillegg. Musikken fortsetter å spille.", "Optional extras. Your music keeps playing."],
 "Opening song":["Åpningslåt", "Opening song"],
 "Crowd sings along":["Publikum synger med", "Crowd sings along"],
 "Guitar solo":["Gitarsolo", "Guitar solo"],
 "A favourite returns":["En favoritt vender tilbake", "A favourite returns"],
 "Hands in the air":["Hendene i været", "Hands in the air"],
 "Acoustic moment":["Akustisk øyeblikk", "Acoustic moment"],
 "Band introduction":["Bandpresentasjon", "Band introduction"],
 "Encore":["Ekstranummer", "Encore"],
 "Final bow":["Siste bukk", "Final bow"],
 "Waiting for this concert’s latest state.":["Venter på konsertens nyeste status.", "Waiting for this concert’s latest state."],
 "Sign in with Discord to join this concert.":["Logg inn med Discord for å bli med på konserten.", "Sign in with Discord to join this concert."],
 "Your social session expired. Reconnecting…":["Konserttilleggsøkten er utløpt. Kobler til igjen…", "Your social session expired. Reconnecting…"],
 "The room is busy. Try again in a moment.":["Rommet er opptatt. Prøv igjen om litt.", "The room is busy. Try again in a moment."],
 "The concert changed. Refreshing the shared panel…":["Konserten er endret. Oppdaterer det felles panelet…", "The concert changed. Refreshing the shared panel…"],
 "Concert extras need a connected, updated Core.":["Konserttillegg krever en tilkoblet og oppdatert Core.", "Concert extras need a connected, updated Core."],
 "Concert extras are unavailable. Please try again shortly.":["Konserttilleggene er utilgjengelige. Prøv igjen om litt.", "Concert extras are unavailable. Please try again shortly."],
 "Connection interrupted. Reconnecting…":["Tilkoblingen ble avbrutt. Kobler til igjen…", "Connection interrupted. Reconnecting…"],
 "You are offline. Concert extras will reconnect when you return.":["Du er frakoblet. Konserttilleggene kobles til igjen når du er tilbake.", "You are offline. Concert extras will reconnect when you return."],
 "Concert extras are paused while this tab is hidden.":["Konserttilleggene er satt på pause mens fanen er skjult.", "Concert extras are paused while this tab is hidden."],
 "Reconnecting concert extras…":["Kobler til konserttillegg igjen…", "Reconnecting concert extras…"],


 "Update bot and website":["Oppdater bot og nettside","Update bot and website"],
 "Audio playback":["Lydavspilling","Audio playback"],
 "Playback defaults for this Discord server.":["Standardvalg for avspilling på denne Discord-serveren.","Playback defaults for this Discord server."],
 "Default volume":["Standardvolum","Default volume"],
 "0–100%. Current playback volume has its own control.":["0–100 %. Volumet for gjeldende avspilling har en egen kontroll.","0–100%. Current playback volume has its own control."],
 "Audio bitrate":["Lydbithastighet","Audio bitrate"],
 "64–384 kbit/s. Applies at the next playback start, capped by the voice channel.":["64–384 kbit/s. Gjelder fra neste avspillingsstart, begrenset av talekanalen.","64–384 kbit/s. Applies at the next playback start, capped by the voice channel."],
 "Crossfade":["Kryssfade","Crossfade"],
 "0–12 seconds between tracks. Set 0 to turn crossfade off.":["0–12 sekunder mellom sanger. Sett 0 for å slå av kryssfade.","0–12 seconds between tracks. Set 0 to turn crossfade off."],
 "Radio when the queue is empty":["Radio når køen er tom","Radio when the queue is empty"],
 "Prepare related music when the manual queue runs out.":["Klargjør lignende musikk når den manuelle køen er tom.","Prepare related music when the manual queue runs out."],
 "Voice and listeners":["Talekanal og lyttere","Voice and listeners"],
 "Connection behavior and volume while people speak.":["Tilkobling og volum mens noen snakker.","Connection behavior and volume while people speak."],
 "Wait after the queue empties":["Vent etter at køen er tom","Wait after the queue empties"],
 "0–86400 seconds. Set 0 to stay connected indefinitely after the queue ends.":["0–86400 sekunder. Sett 0 for å forbli tilkoblet uten tidsgrense etter at køen er tom.","0–86400 seconds. Set 0 to stay connected indefinitely after the queue ends."],
 "Leave when no listeners remain":["Forlat når ingen lyttere er igjen","Leave when no listeners remain"],
 "Disconnect when everyone else leaves the voice channel.":["Koble fra når alle andre forlater talekanalen.","Disconnect when everyone else leaves the voice channel."],
 "Lower volume while people speak":["Demp volumet mens noen snakker","Lower volume while people speak"],
 "Voice detection is enabled when joining. Reconnect after changing this option.":["Stemmeregistrering aktiveres ved tilkobling. Koble til på nytt etter at du endrer dette valget.","Voice detection is enabled when joining. Reconnect after changing this option."],
 "Volume while people speak":["Volum mens noen snakker","Volume while people speak"],
 "0–100%. Used while voice volume reduction is enabled.":["0–100 %. Brukes når demping under tale er aktivert.","0–100%. Used while voice volume reduction is enabled."],
 "Queue and playlists":["Kø og spillelister","Queue and playlists"],
 "Import limits and the Discord queue display.":["Importgrenser og køvisningen i Discord.","Import limits and the Discord queue display."],
 "Playlist limit":["Spillelistegrense","Playlist limit"],
 "1–1000 tracks imported from a playlist.":["1–1000 sanger importert fra en spilleliste.","1–1000 tracks imported from a playlist."],
 "Tracks per queue page":["Sanger per køside","Tracks per queue page"],
 "1–30 tracks shown by the Discord queue command.":["1–30 sanger vist av køkommandoen i Discord.","1–30 tracks shown by the Discord queue command."],
 "Changes apply only to {server}. Settings are managed here instead of Discord slash commands.":["Endringene gjelder bare {server}. Innstillingene administreres her i stedet for med Discord-skråstrekkommandoer.","Changes apply only to {server}. Settings are managed here instead of Discord slash commands."],
 "Settings saved for {server}.":["Innstillingene er lagret for {server}.","Settings saved for {server}."],
 "this server":["denne serveren","this server"],
 "The server did not confirm these settings. Reload and check before trying again.":["Serveren bekreftet ikke disse innstillingene. Last inn på nytt og kontroller før du prøver igjen.","The server did not confirm these settings. Reload and check before trying again."],
 "Rom":["Rom","Room"],
 "Video":["Video","Video"],
 "Logg inn med Discord for å administrere denne serveren.":["Logg inn med Discord for å administrere denne serveren.","Sign in with Discord to manage this server."],
 "Konsertkøen er ikkje tilgjengeleg.":["Konsertkøen er ikke tilgjengelig.","The concert queue is unavailable."],
 "Lydstatus":["Lydstatus","Audio status"],
 "Avbrot":["Avbrudd","Interruptions"],
 "Lengste avbrot":["Lengste avbrudd","Longest interruption"],
 "Siste lydhendingar":["Siste lydhendelser","Recent audio events"],
 "Manglande lydrammer":["Manglende lydrammer","Missing audio frames"],
 "Stem for neste låt":["Stem for neste låt","Vote to skip"],

 "Slå på lyd":["Slå på lyd","Enable sound"],
 "Radio på":["Radio på","Radio on"],
 "Radio av":["Radio av","Radio off"],
 "Velg radio på eller av.":["Velg radio på eller av.","Choose radio on or off."],
 "Radioen fant ingen nye sanger. Prøv en annen låt.":["Radioen fant ingen nye sanger. Prøv en annen låt.","Radio found no new songs. Try a different track."],
 "Radioen fant ikke neste sang. Prøv /play.":["Radioen fant ikke neste sang. Prøv /play.","Radio could not find the next song. Try /play."],
 "Avspillingskontroller":["Avspillingskontroller","Playback controls"],
 "Lukk fullskjerm":["Lukk fullskjerm","Exit fullscreen"],
 "Bare verten kan endre synligheten.":["Bare verten kan endre synligheten.","Only the host can change room visibility."],
 "Velg offentlig eller privat rom.":["Velg offentlig eller privat rom.","Choose a public or private room."],
  "Afterparty forsiden": [
    "Afterparty forsiden",
    "Afterparty home"
  ],
  "Hovedmeny": [
    "Hovedmeny",
    "Main navigation"
  ],
  "Musikk": [
    "Musikk",
    "Music"
  ],
  "LEGG TIL BOT ↗": [
    "LEGG TIL BOT ↗",
    "ADD BOT ↗"
  ],
  "Ventar på video": [
    "Venter på video",
    "Waiting for video"
  ],
  "Ventar på boten": [
    "Venter på boten",
    "Waiting for the bot"
  ],
  "Venter på neste video": [
    "Venter på neste video",
    "Waiting for the next video"
  ],
  "Venter på rommet": [
    "Venter på rommet",
    "Waiting for the room"
  ],
  "Slå av animasjonar": [
    "Slå av animasjoner",
    "Turn off animations"
  ],
  "Slå på animasjonar": [
    "Slå på animasjoner",
    "Turn on animations"
  ],
  "Bli med": [
    "Bli med",
    "Join"
  ],
  "Eige rom": [
    "Eget rom",
    "Create room"
  ],
  "Musikken i Discord. Videoen her. Same augeblikk.": [
    "Musikken i Discord. Videoen her. Samme øyeblikk.",
    "Music in Discord. Video here. One shared moment."
  ],
  "Eitt rom. Ei kø. Musikk de deler.": [
    "Ett rom. Én kø. Musikk dere deler.",
    "One room. One queue. Your music, together."
  ],
  "Ditt rom": [
    "Ditt rom",
    "Your room"
  ],
  "Felles rom": [
    "Felles rom",
    "Shared room"
  ],
  "Kopier romlenken": [
    "Kopier romlenken",
    "Copy room link"
  ],
  "Del rommet": [
    "Del rommet",
    "Share room"
  ],
  "Lukk melding": [
    "Lukk melding",
    "Dismiss message"
  ],
  "Ventar på Discord-boten. Videoen tek pause dersom kontakten blir borte.": [
    "Venter på Discord-boten. Videoen pauses hvis kontakten blir borte.",
    "Waiting for the Discord bot. Video pauses if the connection drops."
  ],
  "Kontakten med rommet er broten. Vi prøver igjen.": [
    "Kontakten med rommet er brutt. Vi prøver igjen.",
    "Connection to the room was lost. Reconnecting."
  ],
  "Videospiller": [
    "Videospiller",
    "Video player"
  ],
  "Konsertrommet": [
    "Konsertrommet",
    "Concert room"
  ],
  "Videorommet": [
    "Videorommet",
    "Video room"
  ],
  "Koplar til": [
    "Kobler til",
    "Connecting"
  ],
  "På scena no": [
    "På scenen nå",
    "On stage now"
  ],
  "Klar for musikk": [
    "Klar for musikk",
    "Ready for music"
  ],
  "På pause": [
    "På pause",
    "Paused"
  ],
  "Pause for alle": [
    "Pause for alle",
    "Pause for everyone"
  ],
  "Spill for alle": [
    "Spill for alle",
    "Play for everyone"
  ],
  "Gå ut av fullskjerm": [
    "Gå ut av fullskjerm",
    "Exit fullscreen"
  ],
  "Neste video for alle": [
    "Neste video for alle",
    "Next video for everyone"
  ],
  "Neste video": [
    "Neste video",
    "Next video"
  ],
  "Videoen kan ikke vises": [
    "Videoen kan ikke vises",
    "Video unavailable"
  ],
  "Denne sangen spiller som lyd i Discord.": [
    "Denne sangen spiller som lyd i Discord.",
    "This track is playing as audio in Discord."
  ],
  "Laster videospilleren …": [
    "Laster videospilleren …",
    "Loading video player …"
  ],
  "Last videoen fra YouTube.": [
    "Last videoen fra YouTube.",
    "Load the video from YouTube."
  ],
  "Åpne på SoundCloud": [
    "Åpne på SoundCloud",
    "Open on SoundCloud"
  ],
  "Prøv videoen igjen": [
    "Prøv videoen igjen",
    "Retry video"
  ],
  "Åpne på YouTube": [
    "Åpne på YouTube",
    "Open on YouTube"
  ],
  "Vis video": [
    "Vis video",
    "Show video"
  ],
  "SCENA": [
    "SCENEN",
    "THE STAGE"
  ],
  "ER DI.": [
    "ER DIN.",
    "IS YOURS."
  ],
  "SET TONEN.": [
    "SETT TONEN.",
    "SET THE TONE."
  ],
  "DEL KVELDEN.": [
    "DEL KVELDEN.",
    "SHARE THE NIGHT."
  ],
  "Start med /konsert i ein talekanal. Vi tek oss av videoen.": [
    "Start med /konsert i en talekanal. Vi tar oss av videoen.",
    "Start with /concert in a voice channel. We'll take care of the video."
  ],
  "Vel neste låt. Lyden går i Discord, videoen kjem her.": [
    "Velg neste låt. Lyden går i Discord, videoen kommer her.",
    "Pick the next track. Audio in Discord, video right here."
  ],
  "Finn ei låt i musikksøket og legg henne i køen.": [
    "Finn en låt i musikksøket og legg den i køen.",
    "Find a track in music search and add it to the queue."
  ],
  "Finn musikk": [
    "Finn musikk",
    "Find music"
  ],
  "Start videoen": [
    "Start videoen",
    "Start video"
  ],
  "Bufrer video ·": [
    "Bufrer video ·",
    "Buffering video ·"
  ],
  "Prøv lavere kvalitet i tannhjulet.": [
    "Prøv lavere kvalitet i tannhjulet.",
    "Try a lower quality in the video settings."
  ],
  "Prøv igjen": [
    "Prøv igjen",
    "Try again"
  ],
  "Direkte": [
    "Direkte",
    "Live"
  ],
  "Ingen video vald": [
    "Ingen video valgt",
    "No video selected"
  ],
  "Søk etter ei låt eller lim inn ei YouTube-lenkje.": [
    "Søk etter en låt eller lim inn en YouTube-lenke.",
    "Search for a track or paste a YouTube link."
  ],
  "Neste låt i Discord": [
    "Neste låt i Discord",
    "Next track in Discord"
  ],
  "Fullskjerm": [
    "Fullskjerm",
    "Fullscreen"
  ],
  "Finjuster video": [
    "Finjuster video",
    "Adjust video timing"
  ],
  "Nullstill finjustering": [
    "Nullstill finjustering",
    "Reset timing adjustment"
  ],
  "Videoavvik:": [
    "Videoavvik:",
    "Video drift:"
  ],
  "Video foran lyden? Flytt til venstre.": [
    "Video foran lyden? Flytt til venstre.",
    "Video ahead of audio? Move to the left."
  ],
  "Verten styrer avspillingen. Du kan legge til sanger.": [
    "Verten styrer avspillingen. Du kan legge til sanger.",
    "The host controls playback. You can add tracks."
  ],
  "Kø og musikksøk": [
    "Kø og musikksøk",
    "Queue and music search"
  ],
  "Kø": [
    "Kø",
    "Queue"
  ],
  "Neste på scena": [
    "Neste på scenen",
    "Up next on stage"
  ],
  "Neste i rommet": [
    "Neste i rommet",
    "Up next in this room"
  ],
  "Spelar no": [
    "Spiller nå",
    "Playing now"
  ],
  "Klar": [
    "Klar",
    "Ready"
  ],
  "Kva skal spele etterpå?": [
    "Hva skal spille etterpå?",
    "What should play next?"
  ],
  "Bygg kveldens sett": [
    "Bygg kveldens sett",
    "Build tonight's set"
  ],
  "Finn ei låt. Legg henne i køen. Gjer kvelden til dykkar.": [
    "Finn en låt. Legg den i køen. Gjør kvelden til deres.",
    "Find a track. Add it to the queue. Make the night your own."
  ],
  "Konsertar frå Discord": [
    "Konserter fra Discord",
    "Concerts from Discord"
  ],
  "Vel eit rom": [
    "Velg et rom",
    "Choose a room"
  ],
  "Venter": [
    "Venter",
    "Waiting"
  ],
  "Neste låt": [
    "Neste låt",
    "Next track"
  ],
  "Søk etter låt, artist eller YouTube-lenkje": [
    "Søk etter låt, artist eller YouTube-lenke",
    "Search for a track, artist or YouTube link"
  ],
  "Låt, artist eller YouTube-lenkje": [
    "Låt, artist eller YouTube-lenke",
    "Track, artist or YouTube link"
  ],
  "Søk etter musikk": [
    "Søk etter musikk",
    "Search music"
  ],
  "Suggested searches": ["Søkeforslag", "Suggested searches"],
  "Search for {query}": ["Søk etter {query}", "Search for {query}"],
  "Results for {query}": ["Resultater for {query}", "Results for {query}"],
  "Showing {shown} of {total}": ["Viser {shown} av {total}", "Showing {shown} of {total}"],
  "Show {count} more": ["Vis {count} flere", "Show {count} more"],
  "All results shown": ["Alle resultater vises", "All results shown"],
  "Festival concerts": ["Festivalkonserter", "Festival concerts"],
  "Explore official festival uploads by event and year. Add a set or the selected year to your queue.": ["Finn offisielle festivalopptak etter arrangement og år. Legg ett sett eller valgt år i køen.", "Explore official festival uploads by event and year. Add a set or the selected year to your queue."],
  "Festival": ["Festival", "Festival"],
  "Year": ["År", "Year"],
  "{count} festival sets from {year}": ["{count} festivalsett fra {year}", "{count} festival sets from {year}"],
  "Add selected year to queue": ["Legg valgt år i køen", "Add selected year to queue"],
  "Official upload by {uploader}": ["Offisielt lastet opp av {uploader}", "Official upload by {uploader}"],
  "Add festival set: {title}": ["Legg festivalsett i køen: {title}", "Add festival set: {title}"],
  "Add set to queue": ["Legg sett i køen", "Add set to queue"],
  "Official video": ["Offisiell video", "Official video"],
  "No festival sets are listed yet.": ["Ingen festivalsett er lagt til ennå.", "No festival sets are listed yet."],
  "Discord queue is unavailable. Refresh and try again.": ["Discord-køen er utilgjengelig. Oppdater og prøv igjen.", "Discord queue is unavailable. Refresh and try again."],
  "Video availability and browser playback depend on the uploader. Adding sets keeps your current playback and saved evenings.": ["Tilgjengelighet og avspilling i nettleseren avhenger av opplasteren. Tillegg beholder pågående avspilling og lagrede kvelder.", "Video availability and browser playback depend on the uploader. Adding sets keeps your current playback and saved evenings."],
  "Nyleg spelt": [
    "Nylig spilt",
    "Recently played"
  ],
  "Mest spelt": [
    "Mest spilt",
    "Most played"
  ],
  "Historikk": [
    "Historikk",
    "History"
  ],
  "Søker …": [
    "Søker …",
    "Searching …"
  ],
  "avspillinger": [
    "avspillinger",
    "plays"
  ],
  "Legg i Discord-kø": [
    "Legg i Discord-kø",
    "Add to Discord queue"
  ],
  "Legg i rommet": [
    "Legg i rommet",
    "Add to room"
  ],
  "Ingen treff. Prøv eit anna søk.": [
    "Ingen treff. Prøv et annet søk.",
    "No results. Try another search."
  ],
  "Ingen låtar i historikken enno.": [
    "Ingen låter i historikken ennå.",
    "No tracks in your history yet."
  ],
  "Start /konsert i ein talekanal i Discord.": [
    "Start /konsert i en talekanal i Discord.",
    "Start /concert in a Discord voice channel."
  ],
  "Konsertar spelar i Discord og blir viste her.": [
    "Konserter spiller i Discord og vises her.",
    "Concert audio plays in Discord. Video plays here."
  ],
  "Låtar blir lagde i dette rommet.": [
    "Låter legges i dette rommet.",
    "Tracks are added to this room."
  ],
  "Direkte synk": [
    "Direkte synk",
    "Live sync"
  ],
  "DISCORD TILKOPLA": [
    "Discord tilkoblet",
    "Discord connected"
  ],
  "DISCORD FRÅKOPLA": [
    "Discord frakoblet",
    "Discord disconnected"
  ],
  "Direkte romsynk": [
    "Direkte romsynk",
    "Live room sync"
  ],
  "Du styrer rommet": [
    "Du styrer rommet",
    "You control this room"
  ],
  "Felles videorom": [
    "Felles videorom",
    "Shared video room"
  ],
  " · 48 timer": [
    " · 48 timer",
    " · 48 hours"
  ],
  "Snarveier": [
    "Snarveier",
    "Quick links"
  ],
  "Patch notes": [
    "Endringslogg",
    "Release notes"
  ],
  "Lukk": [
    "Lukk",
    "Close"
  ],
  "Opprett rom": [
    "Opprett rom",
    "Create room"
  ],
  "Bli med i rom": [
    "Bli med i rom",
    "Join a room"
  ],
  "Du styrer avspelinga. Andre kan leggje videoar i køen.": [
    "Du styrer avspillingen. Andre kan legge videoer i køen.",
    "You control playback. Others can add videos to the queue."
  ],
  "Lim inn romkoden eller lenkja du har fått.": [
    "Lim inn romkoden eller lenken du har fått.",
    "Paste the room code or link you've received."
  ],
  "Namn på rommet": [
    "Navn på rommet",
    "Room name"
  ],
  "Romkode eller romlenkje": [
    "Romkode eller romlenke",
    "Room code or link"
  ],
  "Bli med i rommet": [
    "Bli med i rommet",
    "Join room"
  ],
  "Ingen konto nødvendig. Rommet varer i 48 timar.": [
    "Ingen konto nødvendig. Rommet varer i 48 timer.",
    "No account needed. The room lasts for 48 hours."
  ],
  "Berre verten kan starte, pause og byte video.": [
    "Bare verten kan starte, pause og bytte video.",
    "Only the host can start, pause and change videos."
  ],
  "YouTube svarer ikke. Last videoen på nytt.": [
    "YouTube svarer ikke. Last videoen på nytt.",
    "YouTube isn't responding. Reload the video."
  ],
  "Videospilleren kunne ikke lastes.": [
    "Videospilleren kunne ikke lastes.",
    "The video player could not load."
  ],
  "Tjenesten svarer ikke. Prøv igjen.": [
    "Tjenesten svarer ikke. Prøv igjen.",
    "The service isn't responding. Try again."
  ],
  "Fullskjerm kunne ikke avsluttes. Prøv Escape.": [
    "Fullskjerm kunne ikke avsluttes. Prøv Escape.",
    "Could not exit fullscreen. Try Escape."
  ],
  "Romkoden har åtte bokstaver eller tall.": [
    "Romkoden har åtte bokstaver eller tall.",
    "Room codes have eight letters or numbers."
  ],
  "Rommet er opprettet.": [
    "Rommet er opprettet.",
    "Room created."
  ],
  "Namn på rommet. Videoen blir lagt til automatisk.": [
    "Gi rommet et navn. Videoen blir lagt til automatisk.",
    "Name your room. The video will be added automatically."
  ],
  "Romlenken er kopiert.": [
    "Romlenken er kopiert.",
    "Room link copied."
  ],
  "Kopier lenken fra feltet.": [
    "Kopier lenken fra feltet.",
    "Copy the link from the field."
  ],
  "Handlingen mislyktes.": [
    "Handlingen mislyktes.",
    "The action failed."
  ],
  "Musikk og video er satt på pause for alle.": [
    "Musikk og video er satt på pause for alle.",
    "Music and video paused for everyone."
  ],
  "Musikk og video fortsetter for alle.": [
    "Musikk og video fortsetter for alle.",
    "Music and video resumed for everyone."
  ],
  "Neste låt spiller.": [
    "Neste låt spiller.",
    "The next track is playing."
  ],
  "Sangen er lagt i køen.": [
    "Sangen er lagt i køen.",
    "Track added to the queue."
  ],
  "Sangen er hoppet over i Discord.": [
    "Sangen er hoppet over i Discord.",
    "Track skipped in Discord."
  ],
  "Sangen er lagt i Discord-køen.": [
    "Sangen er lagt i Discord-køen.",
    "Track added to the Discord queue."
  ],
  "Boten bekreftet ikke kommandoen.": [
    "Boten bekreftet ikke kommandoen.",
    "The bot did not confirm the command."
  ],
  "Boten har ikke bekreftet kommandoen. Sjekk køen før du prøver igjen.": [
    "Boten har ikke bekreftet kommandoen. Sjekk køen før du prøver igjen.",
    "The bot has not confirmed the command. Check the queue before retrying."
  ],
  "YouTube-spilleren svarer ikke. Prøv videoen igjen.": [
    "YouTube-spilleren svarer ikke. Prøv videoen igjen.",
    "The YouTube player isn't responding. Retry the video."
  ],
  "Høy oppløsning": [
    "Høy oppløsning",
    "High resolution"
  ],
  "Video utilgjengelig": [
    "Video utilgjengelig",
    "Video unavailable"
  ],
  "Eieren har blokkert denne videoen på andre nettsider.": [
    "Eieren har blokkert denne videoen på andre nettsider.",
    "The owner has blocked this video on other websites."
  ],
  "YouTube kunne ikke bekrefte videospilleren. Prøv å laste siden på nytt.": [
    "YouTube kunne ikke bekrefte videospilleren. Prøv å laste siden på nytt.",
    "YouTube could not verify the player. Reload the page."
  ],
  "Videoen er ikke tilgjengelig her. Velg en annen video.": [
    "Videoen er ikke tilgjengelig her. Velg en annen video.",
    "This video isn't available here. Choose another video."
  ],
  "Bufrer video": [
    "Bufrer video",
    "Buffering video"
  ],
  "Lyd i Discord": [
    "Lyd i Discord",
    "Audio in Discord"
  ],
  "Ingen video": [
    "Ingen video",
    "No video"
  ],
  "Laster video": [
    "Laster video",
    "Loading video"
  ],
  "Justerer synk": [
    "Justerer synk",
    "Adjusting sync"
  ],
  "Starter sammen": [
    "Starter sammen",
    "Starting together"
  ],
  "Trykk start": [
    "Trykk start",
    "Press start"
  ],
  "Video på pause": [
    "Video på pause",
    "Video paused"
  ],
  "Synk aktiv": [
    "Synk aktiv",
    "Sync active"
  ],
  "Videoinnstillinger": [
    "Videoinnstillinger",
    "Video settings"
  ],
  "Kvalitet:": [
    "Kvalitet:",
    "Quality:"
  ],
  "Tannhjulet i videoen. Velg 1440p eller lavere, gjerne 720p ved bufring.": [
    "Tannhjulet i videoen. Velg 1440p eller lavere, gjerne 720p ved bufring.",
    "Use the video's settings. Choose 1440p or lower, or 720p if buffering."
  ],
  "Teksting:": [
    "Teksting:",
    "Captions:"
  ],
  "CC-knappen når videoen har teksting.": [
    "CC-knappen når videoen har teksting.",
    "Use the CC button when captions are available."
  ],
  "Synkronisering": [
    "Synkronisering",
    "Synchronization"
  ],
  "Tett synk (standard)": [
    "Tett synk (standard)",
    "Tight sync (default)"
  ],
  "Stabil avspilling": [
    "Stabil avspilling",
    "Stable playback"
  ],
  "Færre automatiske hopp. Små tidsavvik tolereres for å gi videoen tid til å bufre.": [
    "Færre automatiske hopp. Små tidsavvik tolereres for å gi videoen tid til å bufre.",
    "Fewer automatic jumps. Small timing differences allow the video to buffer."
  ],
  "Korrigerer mindre tidsavvik oftere. Kan gi flere hopp på tregt nett.": [
    "Korrigerer mindre tidsavvik oftere. Kan gi flere hopp på tregt nett.",
    "Corrects small timing differences more often. May jump more on slow connections."
  ],
  "Valget lagres på denne enheten.": [
    "Valget lagres på denne enheten.",
    "Your choice is saved on this device."
  ],
  "Synk nå": [
    "Synk nå",
    "Sync now"
  ],
  "Last videoen på nytt": [
    "Last videoen på nytt",
    "Reload video"
  ],
  "YouTube Auto kan ikke begrenses til 1440p av siden. Bruk «Pause for alle» for å styre konserten i Discord og på nettsiden. I egne rom styrer verten avspillingen. Volum og kvalitet gjelder bare deg. F: fullskjerm. M: mute.": [
    "YouTube Auto kan ikke begrenses til 1440p av siden. Bruk «Pause for alle» for å styre konserten i Discord og på nettsiden. I egne rom styrer verten avspillingen. Volum og kvalitet gjelder bare deg. F: fullskjerm. M: mute.",
    "This site cannot cap YouTube Auto at 1440p. Use ‘Pause for everyone’ to control the concert in Discord and on the site. In other rooms, the host controls playback. Volume and quality affect only you. F: fullscreen. M: mute."
  ],
  "Åpne rom": [
    "Åpne rom",
    "Open rooms"
  ],
  "Vis i Åpne rom": [
    "Vis i Åpne rom",
    "List in Open rooms"
  ],
  "Alle kan finne og bli med i rommet. Slå av for å dele bare med lenke.": [
    "Alle kan finne og bli med i rommet. Slå av for å dele bare med lenke.",
    "Anyone can find and join this room. Turn off to share only by link."
  ],
  "Finn et rom. Bli med på kvelden.": [
    "Finn et rom. Bli med på kvelden.",
    "Find a room. Join the night."
  ],
  "Rom som vertene har åpnet for alle. Ingen konto nødvendig.": [
    "Rom som vertene har åpnet for alle. Ingen konto nødvendig.",
    "Rooms their hosts have opened to everyone. No account needed."
  ],
  "Ingen åpne rom akkurat nå.": [
    "Ingen åpne rom akkurat nå.",
    "No open rooms right now."
  ],
  "Start et rom og la andre bli med.": [
    "Start et rom og la andre bli med.",
    "Start a room and let others join."
  ],
  "Oppdater": [
    "Oppdater",
    "Refresh"
  ],
  "Henter rom …": [
    "Henter rom …",
    "Loading rooms …"
  ],
  "Tilbake til musikken": [
    "Tilbake til musikken",
    "Back to the music"
  ],
  "Romlisten kunne ikke lastes. Prøv igjen.": [
    "Romlisten kunne ikke lastes. Prøv igjen.",
    "Could not load rooms. Try again."
  ],
  "personer her": [
    "personer her",
    "people here"
  ],
  "inRoom": [
    "{count} i rommet",
    "{count} in the room"
  ],
  "removeTrack": [
    "Fjern {title}",
    "Remove {title}"
  ],
  "addDiscord": [
    "Legg {title} i Discord-køen",
    "Add {title} to the Discord queue"
  ],
  "addRoom": [
    "Legg {title} i rommet",
    "Add {title} to the room"
  ],
  "connection": [
    "Kontakt {ms} ms",
    "Connection {ms} ms"
  ],
  "roomExpiry": [
    "Åpent i {hours} t til",
    "Open for {hours} more hours"
  ],
  "Tjenesten svarer ikke.": [
    "Tjenesten svarer ikke.",
    "The service isn't responding."
  ],
  "Maks sanger fra spilleliste": [
    "Maks sanger fra spilleliste",
    "Maximum tracks from a playlist"
  ],
  "Sanger per køside": [
    "Sanger per køside",
    "Tracks per queue page"
  ],
  "Standardvolum, prosent": [
    "Standardvolum, prosent",
    "Default volume, percent"
  ],
  "Lydkvalitet, kbit/s": [
    "Lydkvalitet, kbit/s",
    "Audio quality, kbit/s"
  ],
  "Kryssfade, sekunder": [
    "Kryssfade, sekunder",
    "Crossfade, seconds"
  ],
  "Vent etter tom kø, sekunder": [
    "Vent etter tom kø, sekunder",
    "Wait after queue ends, seconds"
  ],
  "Forlat tom talekanal": [
    "Forlat tom talekanal",
    "Leave empty voice channels"
  ],
  "Privat købekreftelse": [
    "Privat købekreftelse",
    "Private queue confirmation"
  ],
  "Meld neste sang": [
    "Meld neste sang",
    "Announce next track"
  ],
  "Demp når noen snakker": [
    "Demp når noen snakker",
    "Lower volume when someone speaks"
  ],
  "Volum under tale, prosent": [
    "Volum under tale, prosent",
    "Volume during speech, percent"
  ],
  "Radio når køen er tom": [
    "Radio når køen er tom",
    "Radio when the queue is empty"
  ],
  "Discord-innloggingen kunne ikke fullføres. Kontroller appoppsettet og prøv igjen.": [
    "Discord-innloggingen kunne ikke fullføres. Kontroller appoppsettet og prøv igjen.",
    "Discord sign-in failed. Check the app configuration and try again."
  ],
  "Boten har ikke bekreftet handlingen. Sjekk køen før du prøver igjen.": [
    "Boten har ikke bekreftet handlingen. Sjekk køen før du prøver igjen.",
    "The bot has not confirmed the action. Check the queue before retrying."
  ],
  "Utført.": [
    "Utført.",
    "Done."
  ],
  "Lagret.": [
    "Lagret.",
    "Saved."
  ],
  "Avslutte dette videorommet for alle?": [
    "Avslutte dette videorommet for alle?",
    "Close this video room for everyone?"
  ],
  "Kontrollrom": [
    "Kontrollrom",
    "Control room"
  ],
  "Logg ut": [
    "Logg ut",
    "Sign out"
  ],
  "Sjekker innlogging …": [
    "Sjekker innlogging …",
    "Checking sign-in …"
  ],
  "Din server. Din musikk.": [
    "Din server. Din musikk.",
    "Your server. Your music."
  ],
  "Logg inn med Discord for å styre serverne du administrerer.": [
    "Logg inn med Discord for å styre serverne du administrerer.",
    "Sign in with Discord to control the servers you manage."
  ],
  "Logg inn med Discord": [
    "Logg inn med Discord",
    "Sign in with Discord"
  ],
  "Legg til boten": [
    "Legg til boten",
    "Add the bot"
  ],
  "Eierinnlogging": [
    "Eierinnlogging",
    "Owner sign-in"
  ],
  "Adminpassord for Afterparty": [
    "Adminpassord for Afterparty",
    "Afterparty admin password"
  ],
  "Logg inn": [
    "Logg inn",
    "Sign in"
  ],
  "Eierkonto": [
    "Eierkonto",
    "Owner account"
  ],
  "Kontrollrom.": [
    "Kontrollrom.",
    "Control room."
  ],
  "Spiller, kø og innstillinger for din server.": [
    "Spiller, kø og innstillinger for din server.",
    "Player, queue and settings for your server."
  ],
  "Oppdater servere": [
    "Oppdater servere",
    "Refresh servers"
  ],
  "Discord-server": [
    "Discord-server",
    "Discord server"
  ],
  " · legg til boten": [
    " · legg til boten",
    " · add the bot"
  ],
  "Du har ingen servere med administrasjonstilgang.": [
    "Du har ingen servere med administrasjonstilgang.",
    "You have no servers with administrative access."
  ],
  "Legg til Afterparty på": [
    "Legg til Afterparty på",
    "Add Afterparty to"
  ],
  "Oppdater serverlisten etter at boten er lagt til.": [
    "Oppdater serverlisten etter at boten er lagt til.",
    "Refresh the server list after adding the bot."
  ],
  "Spiller og kø": [
    "Spiller og kø",
    "Player and queue"
  ],
  "Innstillinger": [
    "Innstillinger",
    "Settings"
  ],
  "Verktøy": [
    "Verktøy",
    "Tools"
  ],
  "Videorom": [
    "Videorom",
    "Video rooms"
  ],
  "Se video": [
    "Se video",
    "Watch video"
  ],
  "Henter serveren …": [
    "Henter serveren …",
    "Loading server …"
  ],
  "I talekanal": [
    "I talekanal",
    "In a voice channel"
  ],
  "Klar i Discord": [
    "Klar i Discord",
    "Ready in Discord"
  ],
  "Discord er frakoblet": [
    "Discord er frakoblet",
    "Discord is disconnected"
  ],
  "kbit/s · radio:": [
    "kbit/s · radio:",
    "kbit/s · radio:"
  ],
  "Artistradio": [
    "Artistradio",
    "Artist radio"
  ],
  "Reserve": [
    "Reserve",
    "Fallback"
  ],
  "SPILLER": [
    "SPILLER",
    "PLAYING"
  ],
  "PÅ PAUSE": [
    "PÅ PAUSE",
    "PAUSED"
  ],
  "KLAR": [
    "KLAR",
    "READY"
  ],
  "Start med /play i Discord, eller velg en talekanal under Verktøy.": [
    "Start med /play i Discord, eller velg en talekanal under Verktøy.",
    "Start with /play in Discord, or choose a voice channel under Tools."
  ],
  "Pause": [
    "Pause",
    "Pause"
  ],
  "Fortsett": [
    "Fortsett",
    "Resume"
  ],
  "Neste": [
    "Neste",
    "Next"
  ],
  "Bland": [
    "Bland",
    "Shuffle"
  ],
  "Stoppe musikken og tømme køen på denne serveren?": [
    "Stoppe musikken og tømme køen på denne serveren?",
    "Stop the music and clear this server's queue?"
  ],
  "Stopp": [
    "Stopp",
    "Stop"
  ],
  "Spoling": [
    "Spoling",
    "Seek"
  ],
  "Spol musikken": [
    "Spol musikken",
    "Seek in track"
  ],
  "Discord-volum": [
    "Discord-volum",
    "Discord volume"
  ],
  "Bruk volum": [
    "Bruk volum",
    "Apply volume"
  ],
  "Sang eller lenke": [
    "Sang eller lenke",
    "Track or link"
  ],
  "Søk, Spotify- eller SoundCloud-lenke. sc: for SoundCloud": [
    "Søk, Spotify- eller SoundCloud-lenke. sc: for SoundCloud",
    "Search, Spotify or SoundCloud link. sc: for SoundCloud"
  ],
  "Legg til": [
    "Legg til",
    "Add"
  ],
  "Flytt ": [
    "Flytt ",
    "Move "
  ],
  " opp": [
    " opp",
    " up"
  ],
  "Spill ": [
    "Spill ",
    "Play "
  ],
  " nå": [
    " nå",
    " now"
  ],
  "Fjern ": [
    "Fjern ",
    "Remove "
  ],
  "🔁 Gjenta sang": [
    "🔁 Gjenta sang",
    "🔁 Repeat track"
  ],
  "på": [
    "på",
    "on"
  ],
  "av": [
    "av",
    "off"
  ],
  "🔁 Gjenta kø": [
    "🔁 Gjenta kø",
    "🔁 Repeat queue"
  ],
  "↩️ Start på nytt": [
    "↩️ Start på nytt",
    "↩️ Restart track"
  ],
  "⏮️ Forrige sang": [
    "⏮️ Forrige sang",
    "⏮️ Previous track"
  ],
  "Tøm kø": [
    "Tøm kø",
    "Clear queue"
  ],
  "Serverinnstillinger": [
    "Serverinnstillinger",
    "Server settings"
  ],
  "Lydkvaliteten begrenses av talekanalen. Endringer gjelder fra neste avspillingsstart.": [
    "Lydkvaliteten begrenses av talekanalen. Endringer gjelder fra neste avspillingsstart.",
    "Audio quality is limited by the voice channel. Changes apply from the next playback start."
  ],
  "Lagre innstillinger": [
    "Lagre innstillinger",
    "Save settings"
  ],
  "Oppdater rom": [
    "Oppdater rom",
    "Refresh rooms"
  ],
  "i rommet": [
    "i rommet",
    "in the room"
  ],
  "Avslutt": [
    "Avslutt",
    "Close"
  ],
  "Talekanal og spillermelding": [
    "Talekanal og spillermelding",
    "Voice channel and player message"
  ],
  "Hent kanaler": [
    "Hent kanaler",
    "Load channels"
  ],
  "Velg kanal": [
    "Velg kanal",
    "Choose channel"
  ],
  "Bruk som musikk-kanal": [
    "Bruk som musikk-kanal",
    "Set as music channel"
  ],
  "Koble fra": [
    "Koble fra",
    "Disconnect"
  ],
  "Stopptimer": [
    "Stopptimer",
    "Sleep timer"
  ],
  "Minutter til stopp": [
    "Minutter til stopp",
    "Minutes until stop"
  ],
  "Start timer": [
    "Start timer",
    "Start timer"
  ],
  "Avbryt timer": [
    "Avbryt timer",
    "Cancel timer"
  ],
  "Stopper": [
    "Stopper",
    "Stops at"
  ],
  "Lagrede køer": [
    "Lagrede køer",
    "Saved queues"
  ],
  "Navn på lagret kø": [
    "Navn på lagret kø",
    "Saved queue name"
  ],
  "Lagre køen": [
    "Lagre køen",
    "Save queue"
  ],
  "sanger": [
    "sanger",
    "tracks"
  ],
  "Erstatte køen?": [
    "Erstatte køen?",
    "Replace the queue?"
  ],
  "Erstatt kø": [
    "Erstatt kø",
    "Replace queue"
  ],
  "Slett ": [
    "Slett ",
    "Delete "
  ],
  "Slette denne lagrede køen?": [
    "Slette denne lagrede køen?",
    "Delete this saved queue?"
  ],
  "Vedlikehold": [
    "Vedlikehold",
    "Maintenance"
  ],
  "Fjern duplikater i køen": [
    "Fjern duplikater i køen",
    "Remove queue duplicates"
  ],
  "Test lydtilkoblingen": [
    "Test lydtilkoblingen",
    "Test audio connection"
  ],
  "Testen krever en tom bot og en tom talekanal.": [
    "Testen krever en tom bot og en tom talekanal.",
    "The test requires an idle bot and an empty voice channel."
  ],
  "Siste handlinger": [
    "Siste handlinger",
    "Recent actions"
  ],
  "Til musikken": [
    "Til musikken",
    "Back to music"
  ],
  "Romtjenesten er ikke klar ennå.": [
    "Romtjenesten er ikke klar ennå.",
    "The room service is not ready yet."
  ],
  "Rommet finnes ikke.": [
    "Rommet finnes ikke.",
    "Room not found."
  ],
  "Rommet er avsluttet eller har gått ut. Lag et nytt rom.": [
    "Rommet er avsluttet eller har gått ut. Lag et nytt rom.",
    "This room has closed or expired. Create a new room."
  ],
  "Noe gikk galt. Prøv igjen.": [
    "Noe gikk galt. Prøv igjen.",
    "Something went wrong. Try again."
  ],
  "Gi rommet et navn med 1 til 48 tegn.": [
    "Gi rommet et navn med 1 til 48 tegn.",
    "Give the room a name with 1 to 48 characters."
  ],
  "Rommet venter på sanntidstjenesten. Prøv igjen.": [
    "Rommet venter på sanntidstjenesten. Prøv igjen.",
    "The room is waiting for the live service. Try again."
  ],
  "Rommet venter på sanntidstjenesten.": [
    "Rommet venter på sanntidstjenesten.",
    "The room is waiting for the live service."
  ],
  "Velg en YouTube-video.": [
    "Velg en YouTube-video.",
    "Choose a YouTube video."
  ],
  "Videoen er ikke tilgjengelig.": [
    "Videoen er ikke tilgjengelig.",
    "The video is unavailable."
  ],
  "Bare verten kan styre avspillingen. Du kan legge sanger i køen.": [
    "Bare verten kan styre avspillingen. Du kan legge sanger i køen.",
    "Only the host can control playback. You can add tracks to the queue."
  ],
  "Videoen er allerede i rommet.": [
    "Videoen er allerede i rommet.",
    "The video is already in this room."
  ],
  "Køen har plass til 50 videoer.": [
    "Køen har plass til 50 videoer.",
    "The queue holds up to 50 videos."
  ],
  "Legg til en video først.": [
    "Legg til en video først.",
    "Add a video first."
  ],
  "Rommet er endret. Prøv igjen med den nye køen.": [
    "Rommet er endret. Prøv igjen med den nye køen.",
    "The room has changed. Try again with the updated queue."
  ],
  "En annen endring kom først. Prøv igjen.": [
    "En annen endring kom først. Prøv igjen.",
    "Another change arrived first. Try again."
  ],
  "Skriv mellom 2 og 120 tegn.": [
    "Skriv mellom 2 og 120 tegn.",
    "Enter between 2 and 120 characters."
  ],
  "Musikksøket er ikke konfigurert ennå.": [
    "Musikksøket er ikke konfigurert ennå.",
    "Music search is not configured yet."
  ],
  "YouTube-søket er midlertidig utilgjengelig. Prøv igjen senere.": [
    "YouTube-søket er midlertidig utilgjengelig. Prøv igjen senere.",
    "YouTube search is temporarily unavailable. Try again later."
  ],
  "Ta en liten pause og prøv igjen. Grensen beskytter søket og rommene mot misbruk.": [
    "Ta en liten pause og prøv igjen. Grensen beskytter søket og rommene mot misbruk.",
    "Wait a moment and try again. This limit protects search and rooms from abuse."
  ]
};

export function translate(language: Language, text: string, values: Record<string, string | number> = {}): string {
  const translated = messages[text]?.[language === "en" ? 1 : 0] ?? (language === "en" ? partyMessages[text] : undefined) ?? text;
  return translated.replace(/\{(\w+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match);
}
