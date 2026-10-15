# Privacy Policy

Effective: 15 October 2026

This policy describes the hosted Gutta Krutt DJ Discord bot and Gutta Krutt Afterparty website. The service is operated by Discord user **lukasvri**, who handles privacy requests through the [contact options on our support page](https://muse-afterhours.lukasvri.chatgpt.site/support). Independently hosted copies are operated separately.


## Information processed and why


- **Discord operation:** server, channel, role, message and user identifiers, server names, command inputs and voice connection state are processed to route commands, check permissions, maintain the player message and play requested audio. Requester IDs can be saved with queued tracks, recovery state, favorites and saved queues.
- **Music and rooms:** searches, media links, track metadata, playback history, queues, settings, room codes, host credentials stored as hashes, chosen display names, requests, votes and moderation state support playback and shared rooms.
- **Optional admin login:** Discord sign-in requests the `identify` and `guilds` scopes. We process your Discord ID, display name, server list and permissions to check which servers you may manage. The Discord access token and identity are stored in an encrypted grant for the session. The application does not request your Discord password or email through these scopes.
- **Website security and preferences:** session cookies, random visitor identifiers, hashes derived from IP addresses, request counters and operational errors support authentication, viewer counts, rate limits and troubleshooting. Hosting providers process connection information such as IP addresses and request metadata.
- **Device storage:** your browser can retain language, volume, display name, visitor ID, room host credentials and saved evening settings in local storage. These remain until you clear the site’s browser data or remove them through the interface.

The bot uses server and voice-state events. It does not request Discord’s Message Content, Server Members or Presence privileged intents. Its audio engine sends music to voice channels; it does not record participants’ conversations.


## Visibility and service providers

Queues, current tracks and player messages are visible to people with access to the relevant Discord channel or shared room. Room display names, requests and votes may be visible to other participants. Rooms are private by default; choosing public visibility lists the room. Shared concert playback and concert history can appear on the public website. Ordinary Discord music and private member details are filtered from the public concert feed.

Discord processes bot interactions and optional sign-in. OpenAI Sites and Cloudflare provide website delivery and database infrastructure; the bot’s operator runs the audio engine and its local databases. Searches, requested links and playback requests are sent to the media or metadata providers needed for that feature, including YouTube/Google, Spotify and SoundCloud. Embedded YouTube players, thumbnails and Google Fonts make requests from your browser and may process connection data under their own policies.

We do not sell personal data or use Discord API data for advertising or training AI models. Data is used to provide the requested functions, maintain security and handle support. Providers may process information in other countries under their own terms and privacy arrangements. See [Discord](https://discord.com/privacy), [OpenAI](https://openai.com/policies/privacy-policy/), [Cloudflare](https://www.cloudflare.com/privacypolicy/), [Google](https://policies.google.com/privacy), [Spotify](https://www.spotify.com/legal/privacy-policy/) and [SoundCloud](https://soundcloud.com/pages/privacy).


## Storage and retention

Server settings, favorites, saved queues and bot playback history persist in per-server bot databases until removed or deleted by the operator. Removing the bot from a server does not currently delete those databases automatically. Temporary website rooms expire after 48 hours. Admin sessions expire within eight hours, and login state challenges within ten minutes. Expired website records are cleaned during subsequent relevant requests, so expiry does not mean immediate physical deletion.

The website bridge removes concert history older than 90 days and command records older than one day during bridge updates. The bot’s local history and job records do not currently have a fixed automatic deletion period. Operational logs and recovery backups can retain copies after live records change; there is no single guaranteed retention period across these stores. Ask the maintainer about a specific record or deletion from recoverable copies.


## Your choices and rights

You can remove your favorites and room content using the available controls, sign out of admin, clear site data in your browser, and revoke Discord authorization in Discord’s Authorized Apps settings. Server administrators can uninstall the bot. These steps do not by themselves erase every stored record.

To request access, correction, export or deletion of information associated with you or your server, contact **lukasvri** through [Support](https://muse-afterhours.lukasvri.chatgpt.site/support). Specify the affected feature and provide identifiers privately only when needed to locate the records. We may ask you to demonstrate control of the relevant account or server before disclosing or deleting data. Do not send passwords, bot tokens or identity documents. We will respond as required by applicable data protection law. Depending on your location, you may also have rights to object, restrict processing and complain to a data protection authority.

We process information needed to provide features you request and use operational information to protect and maintain the service. Where applicable, these purposes rely on performance of the service agreement and legitimate interests in security and reliability. Where a third-party feature requires consent, its provider handles that choice. You can contact us with questions or objections.


## Policy changes

Updates appear here with a revised effective date. Material changes will also be announced through the website’s patch notes.
