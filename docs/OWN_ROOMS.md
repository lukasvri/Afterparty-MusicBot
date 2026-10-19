# Your own video room

[Documentation](README.md) · [Party experience](AFTERPARTY_EXPERIENCE.md) · [Architecture](ARCHITECTURE.md)

Create a browser room from the welcome screen, search for music and share its link. No account or Discord connection is required. Rooms start with link-only access; the host can choose public listing. Each room has its own queue, permissions and playback state, separate from every Discord server.

## Share and manage

The creator receives a private host credential. Keep it safe: a room code identifies the room, but does not grant host control. Normal shared links and QR codes contain the room code only.

Hosts can control playback, order the queue, moderate requests and choose room settings. Guests can request music and participate in queue votes. Hosts can invite cohosts or transfer ownership using room-specific, single-use invitations. Ownership transfer revokes old cohosts and outstanding invitations. See [authority and privacy](AFTERPARTY_EXPERIENCE.md#authority-and-privacy) for the exact access boundaries.

Host credentials and preferences are saved locally. When browser storage is blocked, the current page keeps them in memory and offers a private recovery-link download. Keep that link to recover control after a reload. Invitation and recovery links contain private credentials; ordinary room links do not.

## Playback and radio

Core owns room progression when connected. It can advance finished videos even if every browser disconnects. Without Core, the website fallback advances expired tracks when a room is read; it does not provide unattended progression without requests. Live streams require an explicit skip.

Manually queued tracks take priority over radio. Radio is enabled by default, can be switched off by a host, and prepares an embeddable recommendation while the current track plays. Explicit genre metadata helps selection; without it, selection falls back to artist matching. Recent room history helps avoid repeats. Provider availability can leave the room without a suitable recommendation.

The original manually selected song remains the radio seed across automatic tracks and service restarts. A newly selected manual song replaces it when it becomes current. Broad genre labels alone cannot justify unrelated artists. Searches and saved automatic suggestions share the instructional-video filter. See [radio selection](RADIO.md) for the exact lifecycle and provider evidence.

Early skips share an in-flight radio lookup instead of starting a duplicate search. Failed or empty lookups use a cooldown before retrying. A failed skip keeps the current track intact; failed automatic radio ends a completed track cleanly. Every asynchronous result checks the room revision, so a newer pause, queue edit or radio toggle wins.

## Start video and sound

The website uses the official YouTube embed. Opening the local player starts a video already playing in the room. Only a viewer with transport permission can resume a paused room for everyone.

If audible autoplay is blocked, the player tries muted playback and offers **Enable sound**. This temporary fallback does not overwrite saved volume or mute preferences. Browser policy, buffering and video availability still affect each viewer independently.

Local volume, synchronization preferences and saved evenings stay on the device. Shared playback commands change the room timeline. Saved evenings can be edited and imported/exported; they are not synchronized to an account. TV mode provides a larger playback layout with guest sharing controls.

## Persistence and updates

The optional **Concert together** preview adds live reactions, host-managed bingo
and shared timestamp notes below the player. The host calls bingo moments manually
and can disable activities or remove notes. Timestamp links open YouTube separately;
activities do not control playback or the queue. This preview requires Core and uses
short-lived room-scoped guest sessions. Notes and cards reset with a new playback
instance and have bounded retention. See the [activity architecture and limits](AFTERPARTY_EXPERIENCE.md#concert-activities-preview-300-beta1).

Room state uses the existing JSON records and backward-compatible defaults for optional fields. Core and the website share queue rules, moderation, voting and undo behavior. Update both services together when changing these commands. Back up production data and follow [operations](../services/core/PUBLIC_RELEASE.md) before an update.

## Verification

`npm run check:all` covers isolated room scheduling, radio races, revisions, permissions, moderation, invitations, ownership transfer and storage behavior. Chromium fixtures cover local player startup, autoplay recovery and queue interaction. Tests use synthetic providers and a simulated video player; they do not guarantee third-party availability or perfect synchronization between real viewers.
