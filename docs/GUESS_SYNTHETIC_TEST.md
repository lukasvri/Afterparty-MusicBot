# Synthetic Guess the Song test

This preview uses a separate game authority and dedicated `/games` page on the
ordinary bot/web source line. Its audio and scores stay independent of concert
reactions, highlights and bingo. It does not run a Discord Activity. Source and
patch notes do not prove deployment.

## Operator boundary

The Core catalog is unavailable by default. `GUESS_SYNTHETIC_TEST=1` explicitly
enables five locally generated 30-second PCM tones under **Synthetic test tones**.
No provider requests, external music or new credentials are used. Existing room
and Discord membership authorization remains required; owner recovery does not
grant access to a Discord server. Other values leave the test catalog disabled.

Preserve production environment files, data, mounts and rollback images. Add the
nonsecret test flag through the host's existing deployment configuration only
after deployment approval. Website and Core must both contain the game update.
An old or unreachable Core shows an unavailable game rather than using local
fictional state. Restarting Core discards game sessions and scores.

## Two-client test after an authorized deployment

1. Create a private browser room and open **Games** from that room. Invite a second
   browser or private window through the same room link and open Games there.
   Keep the host credential in the host browser.
2. Confirm both screens clearly show **Synthetic audio test**. Join with different
   nicknames. The host can configure up to five rounds and 15 to 30 seconds. The
   guest can answer but cannot start, reveal, reset or change settings.
3. Start a round and press **Listen to preview** locally on each client. The five
   fictional answers are **Test Tone One**, **Test Tone Two**, **Test Tone Three**,
   **Test Tone Four** and **Test Tone Five**. Tones have frequencies 220, 330, 440,
   550 and 660 Hz respectively. This tests game flow, not recognizing real music.
4. Submit a matching title, check synchronized scores, reveal and continue.
   Early answers earn more points. Earlier round scores never change.
   In the lobby, also try **Answer mode: Artist** and save before starting.
   The synthetic artist answer is **Synthetic Test Generator**, rather than
   a tone title. Quick/classic presets change the draft settings and still need
   to be saved. Guests can vote to skip after a round starts; more than half of
   the joined roster is required, including disconnected tabs. A successful
   vote reveals without changing scores, and the host advances the game.
5. Stop/cancel preview, hide the tab, disconnect, reconnect and leave the game.
   Audio must stop, returning must not autoplay, and reconnect must not replay
   writes or award points twice. The music queue must remain unchanged.

Existing Discord or other-tab playback is independent. Mute it locally if needed;
the game does not pause or change that playback. Synthetic decoding, timing and
HTTP tests do not prove what a person hears in Discord, real provider playback
or any public music rights.
