# Changelog

Generated from `lib/releases.json` and `lib/legacy-updates.ts`. Do not edit by hand.
Release entries describe source versions, not production deployment status.
See [release policy](docs/RELEASING.md).

## v3.0.0-alpha.2: A clearer music workspace, native controls and DJ tools

2026-10-25

- Listening rooms, library, games, server administration and public pages share a refreshed dark interface with clearer grouping, larger controls and fluid layouts for mobile, 1080p, QHD and 4K.
- The familiar horizontal navigation and single player surface return in Svelte. Queue, search and library share one tabbed panel beside the player on wide screens. Switching tabs keeps searches, playlist previews and unfinished library fields; room and device settings stay together below the player. Mobile shortcuts return directly to player, search, queue and library, and one invitation panel groups QR and link copying.
- Open rooms can be filtered by name or code, show matching counts and retain their last good list through a refresh error. Queue track options support keyboard reorder, removal and Escape without interrupting a new search.
- Use the official YouTube controls for playback, volume, quality, captions and fullscreen after enabling audio. The app no longer adds its own play/pause buttons, volume slider or seek bar around the video, including before audio activation. Authorized native playback follows the shared clock; guest pause and device volume remain local. The app retains one action for the shared queue’s next track. Native seeks can use player state events immediately instead of waiting for the periodic position check.
- The DJ character and concert scene return as scalable native artwork, with a detailed stage, decks and restrained animation that respects saved and system motion preferences.
- The server player includes a DJ desk for crossfade and radio, explicit repeat controls, previous song, fractional cue points, 15-second jumps and a recording-scoped marked cue. Transition changes require Apply and preserve other server settings.
- Playback recovery keeps a requested seek position while its source loads, preserves pause choices across radio discovery and source failures, and checkpoints the recording actually consumed during a crossfade. Browser rooms and their website fallback use the same agreed start clock.
- Music searches use title, artist and recording-format relevance to order the existing results. Exact songs take priority over incidental matches, while explicit remix, cover and live-set searches remain available.
- Radio gives less recently exposed artists a turn among equally suitable candidates, reducing repeated loops through the first artists returned by a source. The original station anchor, style checks and independent room histories remain in place.
- Automatic radio catches more declared AI production and song-recreation labels, including Norwegian KI and vlogg wording. Matching music videos remain preferred without replacing the chosen song with another recording.
- Festival browsing expands from 49 to 290 source-backed sets, including every linked recording in the checked EDC 2023, 2025 and 2026 indexes and all matching-year links in the checked Creamfields 2024 index. Artist and stage search, pages of 20 and explicit capacity-sized batches keep larger years usable.
- Each existing Tomorrowland year can open its source playlist in the metadata preview before you choose tracks. Other festival archives remain partial where their complete source inventory could not be verified.
- Join or host Guess the Song without entering a nickname. A default player name is supplied, while incorrect guesses remain selected for quick correction.
- Unsaved game settings survive guests arriving and song preparation updates. Changes made by another host still require you to review the latest settings before saving.
- Playlist previews retry temporary connection failures with a bounded delay. Starting an import and adding music are never automatically repeated.
- Library and festival tools show remaining queue capacity and account for tracks already queued or awaiting approval. Explicitly retrying a partial addition skips tracks already present and retains the original room or concert.
- Concert controls check their own command confirmation and report failed commands without claiming success. Temporary concert disconnections clear after a successful read without replaying music commands.
- A newly created room keeps its address after a temporary connection failure, so reloading can return to it with saved host access.
- This alpha source candidate still requires live provider, real-device audio and Discord listening acceptance before a stable release.

## v3.0.0-alpha.1: Afterparty 3 website preview

2026-10-24

- The expanded v3 interface brings open and private listening rooms, host and co-host invitations, shared queue editing, voting, guest request approval and radio into one responsive music workspace.
- Use your existing saved evenings and favorites, back up or import your library, preview YouTube and Spotify playlists before adding songs, and browse official festival sets by event and year.
- Server administration, public concerts with opt-in synchronized browser audio, Guess the Song, installation, support and policy pages now have native v3 views. Server selection and permissions continue to scope controls to the intended Discord server.
- Guess the Song has a dedicated game-night lobby with private hosting and invite links, recording-aware pace presets, one-step start, clearer live points and hints, focused reveals and final standings that recognize ties. Game audio can follow new rounds after explicit activation, with separate local volume and safe stop/cancel controls.
- Room playback adds local volume, mute and fullscreen controls, and follows the shared timeline with stream leases and read-only reconnection. This is an alpha review build; live provider playback, Discord listening and production login still require acceptance testing.
- The listening room loads library, playlist and festival tools when you open them, reducing the initial JavaScript payload while keeping those tools available. Game hosting code also loads on demand.
- The native v3 source now provides the sole interface at the home address, with public concerts at /discord. Existing v3 bookmarks keep working; the Classic interface and its fallback have been retired while APIs and saved data retain their existing contracts.
- TV mode scales video, QR invitations and controls dynamically from 1080p through QHD and 4K. Local QR invitations and keyboard fullscreen/mute controls now use the native player. Switching views retains the active player; public invitation links exclude private host credentials.
- Reconnect game can rejoin after Core loses its in-memory game membership. Existing games retain their scores; lost games return to a lobby without replaying guesses or starting a round automatically.
- Core saves pause and resume choices immediately for restart recovery, closing the gap before the next playback clock tick.
- Optional Core-authoritative concert rooms show a saved checkpoint as offline when Core cannot be reached, keeping stale playback paused until fresh state is available.

## v2.4.0-alpha.15: Prepare an opt-in Cloudflare website build

2026-10-21

- Operators can explicitly build the website for native Cloudflare Workers with a DB binding and host-local deployment identity. The existing Sites build remains the default and is preserved for rollback; generated Cloudflare settings and deployment IDs stay out of source control.
- Cloudflare builds validate their target and output before a separate explicit deployment command. Builds do not apply remote database migrations, change Core, switch DNS or configure automatic deployment. The migration guide describes isolated staging, database migration-history reconciliation and an owner-approved cutover.
- This alpha is source preparation only. No Cloudflare account, live website, database, production bridge, Discord login or production deployment has been changed or verified.

## v2.4.0-alpha.14: A calmer, consistent interface across Afterparty

2026-10-21

- Music, rooms, player settings, games, administration and information pages share neutral dark surfaces, clearer typography, consistent spacing and visible keyboard focus. The red accent remains on active controls, primary actions and meaningful status instead of tinting everyday fields and secondary surfaces.
- Search groups its input and playlist action, and only opens suggestions when the input is activated. Suggestions remain reachable with the keyboard and close on Escape, submission, selection or leaving the search tools. Returning to the Search tab keeps them closed until the input is activated again. Up to four suggestions retain their full accessible labels and exact queries. History sorting aligns with the result count, and track rows use readable metadata and neutral 44-pixel add controls. Result pagination, AI exclusions and queue commands keep their existing behavior.
- Queue and saved-library actions use consistent icons with their existing accessible names. Festival sets have a bounded list, local library backup tools open on request, and playlist imports remain directly accessible. Shared controls and dialogs retain usable touch targets on narrow screens.
- TV invitations fit short landscape displays without pushing the page beyond the viewport. The video retains its 16:9 slot, fullscreen controls remain reachable and switching views keeps the active player.
- Games, server administration, support, installation, patch notes and copyright forms use the same visual hierarchy. Server permissions, queue revisions, playback synchronization, source selection and audio behavior are unchanged. This is an alpha interface update; local visual and browser checks do not establish production deployment or live listening quality.

## v2.4.0-alpha.13: Alpha-ready quiz, playlist imports and 2026 festival concerts

2026-10-21

- Paste a YouTube or Spotify playlist link into search or the evening library to load a preview of up to 500 entries. Long imports run as cancellable metadata jobs, show available/skipped entries and partial-source limits, and keep the full preview with page navigation. Queue additions are explicit selections within the existing 50-track queue limit; loading a playlist never changes playback. Spotify metadata is matched through existing playback sources, without streaming Spotify audio.
- The evening library adds 49 curated official festival sets, including 25 from 2026 and 21 Tomorrowland Belgium 2026 performances. Event and performance-year filters, uploader attribution and direct video links cover Ultra Miami, Tomorrowland Belgium, EDC Las Vegas, Creamfields and Amsterdam RAI. Selected sets append without replacing saved evenings or interrupting current playback.
- Alpha builds prepare the eight-song EDM festival hits quiz pack automatically without environment setup or a hand-built song file. Explicit source overrides and GUESS_YOUTUBE_CLIPS=0 are respected; stable, beta and rc builds remain default-off. Answers stay on Core until reveal, and each participant receives the selected audio through the private game transport. Custom approval-aware inventories remain supported separately; modes and pack/path selectors are mutually exclusive.
- Quiz button presses take priority over background status reads. Starting a game or sending an answer while a poll is pending no longer silently drops the action. Cancelled or late reads cannot overwrite the newer game response.
- Quiz navigation and categories remain visible during alpha testing. Loading, ready, disabled and unavailable audio states replace development-only catalog placeholders. The host can prepare songs in the lobby; Start is enabled only when the actual source has enough recordings. Existing Core versions retain their compatibility behavior without claiming unavailable audio is playable.
- The game lobby host can load or retry quiz songs directly from the website, with visible preparation progress, fresh authority and game-revision checks. A local SIGHUP through core-control.sh guess-reload remains an operator alternative. A healthy snapshot remains unchanged; overlapping reloads share one bounded preparation, and shutdown rejects late publication. Guests cannot trigger preparation, disabled sources remain disabled, and the action cannot accept provider URLs or change source configuration. No automatic timed refresh is added.
- Playlist additions keep their original room or Discord server while metadata is resolved. Leaving or switching rooms stops the remaining additions, late replies cannot restore a previous room, and each Discord append reads a fresh queue revision. Videos are added sequentially, so an unavailable item can leave a reported partial addition.
- YouTube quiz snapshots last up to 30 minutes from preparation start, allowing eight rounds plus lobby and reveal pauses to finish. Earlier custom recording expiry, cancellation and disposal still revoke access. Generic and Deezer inventories retain their five-minute default. The private guess:pack export still creates an exclusive 0600 inactive template unless existing approvals are supplied.
- Festival links and quiz recording identities were checked against primary publication metadata. This does not establish current regional access, sustained provider availability, licensing or audible device quality. No live source activation, deployment or production configuration is included.

## v2.4.0-alpha.12: Themed radio, richer search and quiz audio

2026-10-21

- Radio uses named melodic NCS and Lost Sky station recordings to discover relevant songs across artists when upload genre labels are missing. The original manual song stays the station anchor; exact recording matches, style checks and history exclusions still apply. Known themed candidates outrank related recordings with unknown style.
- Automatic radio rejects explicit AI music and cover declarations in titles, uploaders, descriptions, tags and provider synthetic-media flags. These are metadata filters, not a guarantee that an unlabelled upload is human-made. Manual requests retain their existing playback behavior.
- Music search returns up to 30 results with ten-at-a-time display and contextual artist or song suggestions from existing listening history. More results and neutral suggestion controls require no background provider searches. Cold searches have a bounded 35-second deadline; editing a query cancels stale searches so old results cannot replace a newer choice.
- Browser-room radio gets its own visitor allowance and a bounded 20-result music search instead of the eight-result user fallback. Empty searches retry after one minute; source caches refresh for the new metadata and isolate user/radio modes. Core rejects excess concurrent searches before contacting a provider.
- An optional YouTube quiz source uses yt-dlp and FFmpeg to prepare up to eight privately curated audio-only clips, with selectable offsets and 15–30-second durations. Each participant receives canonical answer-safe WAV audio through the existing private game transport, without a YouTube iframe or changes to ordinary music queues.
- GUESS_YOUTUBE_CLIPS=1 selects the source with an absolute private GUESS_YOUTUBE_INVENTORY_PATH. Quiz source modes are mutually exclusive. Video identity, audio format, CDN destination, bytes, time and process concurrency are bounded; the existing inventory permissions and five-minute lifetime remain in place. guess:check reports the new source's capacity without revealing answers or addresses.
- The shared FFmpeg decoder supports bounded WebM and MP4 clips while retaining pipe-only input and metadata-free output. Sample-based timestamps preserve exact clip lengths on FFmpeg 5 and 7 without padding short recordings. A valid longer MP3 can now finish its 30-second preview when FFmpeg closes the unused input tail; other input/process failures still reject the preview.
- This is a default-off source pilot tested with generated audio and controlled extractor/CDN responses. Actual YouTube availability, recording/provider permissions, sustained operation and real-device listening are not established by these tests. No provider credentials, automatic catalog refresh or production activation is included.

## v2.4.0-alpha.11: Deezer sharing links and isolated quiz source checks

2026-10-21

- Optional Deezer metadata matching accepts supported sharing links and canonical track, album and playlist links with bounded standard tracking fields. Tracking is discarded, redirect requests stay within approved Deezer share paths with deadlines and concurrency limits, and metadata from a different requested track is rejected. Matching remains default-off and uses the existing recording matcher.
- Core adds guess:check to validate the configured quiz source before startup without connecting to Discord, opening servers or changing playback. Its JSON summary reports bounded readiness and category capacities without song answers, media addresses, private inventory paths or permission references, and releases the temporary source after checking.
- The Deezer quiz pilot remains a separate default-off, explicitly configured inventory with the existing five-minute expiry. The check does not refresh a running Core, establish a playable commercial hit catalog or enable Deezer full-audio streaming. Live provider access and real-device listening remain unverified.

## v2.4.0-alpha.10: Patched website and Core dependencies

2026-10-21

- Website dependency resolution pins esbuild 0.28.2, undici 7.30.1 and ws 8.22.0, replacing vulnerable transitive versions held by the existing Cloudflare and Drizzle tools. Core separately pins undici 6.29.1 for its Discord REST dependency tree.
- React, React DOM and the React Server Components package advance together to 19.2.8. Targeted overrides also patch image-size, fast-uri and fflate without replacing the framework or Cloudflare toolchain.
- The existing framework and Cloudflare tool versions remain pinned, and the Miniflare sharp override is preserved. These overrides replace installed modules; they do not replace library code embedded in Wrangler's prebuilt CLI bundle, which remains an upstream security limitation.
- The dependency audit can still report the upstream braces stack-exhaustion advisory through build and lint tools: no patched braces release is available. These notes do not claim that all upstream tool vulnerabilities have been resolved.
- This source preparation does not update the installed bot, deploy the website, enable automatic production updates or establish v3 acceptance. Production changes remain a separate owner-approved operation.

## v2.4.0-alpha.9: Dependency review and repository security scanning

2026-10-21

- YouTube metadata decoding no longer double-unescapes HTML entities, and administrator bot-install links reject unsafe URL schemes before reaching the browser.
- Pull requests targeting main receive a read-only dependency review using the official, commit-pinned Node 24 action. Newly introduced or changed vulnerable dependencies with high or critical advisories block the check across runtime, development and unknown scopes.
- Dependency review reads the pull-request dependency diff without checking out or executing proposed code, writing pull-request comments or introducing a new license policy. Existing source validation and the separate signed-release verification remain required.
- Repository CodeQL default setup adds GitHub-hosted analysis of Actions, JavaScript/TypeScript and Python with default query precision for main pushes, pull requests and scheduled weekly scans. This administrative configuration is separate from the versioned workflow source.
- This preparation alpha records repository security controls, not a change to the installed production version or an accepted v3 release. It does not deploy, restart the bot, merge dependency proposals or enable automatic bot updates.

## v2.4.0-alpha.8: Bounded, cached and reviewable GitHub workflows

2026-10-21

- CI uses immutable commit pins for official Node 24 Actions and an explicit Ubuntu 24.04 runner. Core builds reuse GitHub Actions Buildx layers, then probe and package the same loaded final image without a second build; commit and signed-release verification remain required.
- Superseded pull-request checks are canceled while each main push retains its own release run. Jobs have bounded timeouts, intermediate artifacts expire after three days, and already compressed archives are uploaded without another compression pass.
- Validation jobs retain read-only repository access and do not persist checkout credentials. Only the canonical main release job receives the write and OIDC permissions needed to attest and publish the verified artifacts; pull requests do not publish releases or deploy production.
- Dependabot proposes one grouped Actions update each week and groups npm security updates while routine npm version proposals are disabled. Changes remain review proposals with no automatic merge; the pull-request template requests validation, canonical release notes and explicit operational scope.
- This preparation alpha describes workflow source readiness, not a production deployment or accepted v3 release. Existing server resource limits and manual production approval remain in place; this change does not restart the bot or enable automatic updates.

## v2.4.0-alpha.7: Docker image identity compatibility for verified updates

2026-10-21

- Deployment checks recognize Docker 29 containerd image stores that expose an OCI manifest digest instead of the signed image configuration digest. The updater proves their relationship from the verified archive and local image metadata; unknown or mismatched identities remain rejected.
- The signed release image identity remains separate from the actual local runtime image identity. Exact source commit, artifact signatures and workflow provenance are still required before the isolated runtime probe or any later production switch.
- Operators can install the corrected pinned host helper and run --check against an existing signed 2.4.0-alpha.6 build without rebuilding the bot, restarting it or deploying. This source preview does not claim that a production update occurred or enable automatic updates.

## v2.4.0-alpha.6: Verified GitHub builds for bounded server updates

2026-10-21

- Core and website updates reuse the exact build outputs produced after the canonical main workflow passes. The deployment host no longer installs dependencies, reruns the full test suites or rebuilds those outputs; missing or invalid release artifacts stop the update.
- Every release asset requires cryptographically verified GitHub build provenance tied to the expected workflow, refs/heads/main, exact source commit and workflow run attempt. Matching release checksums and the shared GitHub Actions bot identity alone are not sufficient to authorize an image.
- Operators must install the updated pinned deployment consumer and a GitHub CLI version supporting the required attestation verification flags. Merge this change and wait for its first successful signed main build before using the new update path. Existing unsigned builds are rejected without a local rebuild fallback.
- The isolated local runtime probe respects the configured Docker context and retains its 256 MiB memory limit, no swap and half-CPU quota. Existing health, backup, playback and rollback safeguards still apply before an explicitly authorized production update.
- This preparation alpha describes the source candidate, not an accepted v3 release or a production deployment. Automatic updates are not enabled by this change.

## v2.4.0-alpha.5: Visible queues and neutral control surfaces

2026-10-21

- Upcoming songs and pending requests use an Afterparty-specific row class, avoiding the generic social-track cosmetic filter used by content blockers such as uBlock Origin. Room and Discord queue counts, ordering, permissions and concert privacy are unchanged; no blocker setting needs to be disabled.
- Shared secondary surfaces, borders, text and subtle buttons use neutral dark grays instead of the late stylesheet's red-brown palette. This updates nickname fields, TV-mode controls and other panels and inputs using the shared tokens; selected controls and playback accents retain red.

## v2.4.0-alpha.4: More reliable playback, queue controls and radio suggestions

2026-10-21

- Established Discord voice reconnections now share a 20-second deadline to reach Ready, including reconnects that skip the Disconnected state. Successful recovery preserves pause and playback; a failed recovery disconnects cleanly with an actionable error instead of remaining in buffering indefinitely. Old connections cannot tear down replacements or another server.
- An unexpectedly destroyed Discord voice adapter now clears the disconnected server's playback state and offers a fresh /play join instead of leaving the bot falsely connected. Intentional connection replacement remains silent and cannot tear down its successor.
- Browser clock calibration restarts immediately when Core changes epoch, cancels the old sample and prevents late old replies from releasing or replacing a newer clock sample. Existing playback leases, stale-state protection and buffering guards remain in place.
- A shared pause now immediately pauses a buffering video as well as one already playing, preventing buffered playback from resuming before the next synchronization check. Resume still follows the existing browser playback permissions.
- Mobile patch-note stamps wrap version, date and build badge onto separate lines when needed, keeping long prerelease versions readable in both interface languages.
- Queue and transport actions carrying a stale queue revision now reject consistently, including clear, shuffle, replay, relative seek and saved-queue restore. Invalid removal ranges are rejected before changing the queue. Legacy commands without a revision remain compatible.
- Concert queues cancel old requests when switching servers and reject delayed reads or errors after newer mutations. Fresh polling clears polling errors while preserving action failures. Hosts can move songs in either direction, with named moderation controls and 44-pixel touch targets; initial queue loading is distinct from an empty queue.
- Music discovery reports result counts and queue updates, explains unavailable additions, exposes the selected history sort to assistive technology, and provides larger add controls on touch screens.
- Radio now spreads its existing metadata-matching budget across artists, reduces immediate artist repetition and uses stored recording identities for comparable favorites. Genre and recording quality, exclusions and recent-history gates remain authoritative. Discovery metadata is bounded and copied; no new music service or cross-server listening profile is added.

## v2.4.0-alpha.3: More quiz modes, source matching and copyright requests

2026-10-21

- Guess the Song hosts can choose song-title or artist answers. Artist mode matches the full normalized artist, uses artist-specific prompts and late hints, and keeps title aliases separate. Existing clients that omit the mode retain title guessing; settings stay frozen during play.
- Joined players can vote once per active round to skip. A strict majority of the current joined roster reveals the answer without changing scores or advancing the game. Counts and the requesting player’s vote status synchronize between clients; disconnected tabs remain in the roster and the host can still reveal.
- Quick 15-second and classic 30-second presets fit the selected category’s distinct recording capacity and require saving before Start. Catalogs advertise bounded duration summaries without answers or media keys, invalid combinations cannot start, and expired inventories clear their capacity. Older catalogs remain compatible.
- Optional DEEZER_METADATA=1 on Core adds canonical Deezer track, album and playlist metadata lookup for ordinary playback, followed by the existing recording matcher. Default is off. Matching preserves explicit recording versions and distinguishes repeated version words from title or artist words, preventing studio/live mixups. Requests, pages, bytes and time are bounded. This does not stream Deezer audio or populate the quiz catalog.
- A separate default-off Deezer quiz pilot prepares up to eight explicitly approved track previews from a private local inventory file. Bounded metadata/CDN requests and MP3 decoding produce canonical WAV without answer tags for the existing private round transport. The snapshot expires within five minutes or earlier approval expiry, without automatic refresh. Real FFmpeg and two-player HTTP checks use generated audio only; live availability and permissions remain unverified. DEEZER_METADATA does not enable quiz audio.
- A copyright/removal page prepares an editable private notice and email draft for the operator’s public contact address, with copying and clearing controls. Reporters send the notice themselves. The form does not submit or store notices or remove material automatically; support, terms and privacy pages explain the flow.
- The remote quiz still needs a playable recognizable-hit inventory. The source investigation separates Jockie’s documented features from unknown backend details and examines a separately documented metadata/playback architecture. No real recordings, provider credentials, paid accounts or production changes are included.

## v2.4.0-alpha.2: Fair concurrent answers and authorized game inventory

2026-10-21

- Simultaneous Guess the Song answers may use the same valid round snapshot without losing a later answer because another participant answered or joined. Session and round identity, deadlines, duplicate and rate limits remain authoritative; host controls retain strict revision checks and scores use server receipt time.
- A provider-neutral operator inventory factory accepts at most eight explicitly approved canonical 15-30-second WAV samples through the existing private game transport. Input and returned audio are copied, metadata and permission references stay private, and the entire snapshot becomes unavailable after the earliest permission expiry or five minutes. Cancellation and disposal cannot return stale audio.
- The default music catalog remains unavailable. No Spotify, YouTube or Deezer provider, startup option, real recording or production configuration is enabled. Permission references are syntactically checked operator attestations, not verified music rights. The source comparison documents provider restrictions and the remaining rights and live-client acceptance gates.

## v2.4.0-alpha.1: Concert extras alongside the multiplayer game

2026-10-21

- Concert extras and Guess the Song share a reviewed source candidate while retaining independent audio, playback clocks, queues, permissions and event limits. Optional reactions, host-called bingo and timestamp bookmarks remain outside fullscreen and TV views. Matching website and Core builds are required.
- The existing private Guess the Song game, Worker-compatible audio previews and synthetic test catalog remain available alongside extras. Room and Discord authorization, OAuth cancellation and expiry checks, playback isolation and ordinary queues are preserved. No real music provider is enabled.
- This combined preparation alpha preserves recorded 2.3.0 notes and uses a distinct version from the separate unmerged v3 rc proposals and experimental Activity beta. It does not claim v3 acceptance. A new higher-version alpha may supersede an unfinished lower-version preview without promoting it to stable.

## v2.3.0-alpha.2: Fix game preview audio on Workers

2026-10-20

- Guess the Song previews use a redirect mode supported by the website Worker runtime, fixing a reproducible HTTP 500 before the audio request reached Core. Upstream redirects are rejected with a generic 502 response without following them or exposing their destination; existing room and Discord authorization, cancellation and bounded WAV validation remain in place.
- An isolated Workerd integration test now exercises the real game routes, D1 room authority and a temporary Core with generated tones. This synthetic-only prerelease is review material and does not enable real music or establish successful production playback.

## v2.3.0-alpha.1: Synthetic multiplayer game test

2026-10-20

- Games adds a separate Guess the Song lobby for existing private rooms and authorized Discord servers. Hosts choose rounds, time, scoring and hints; players submit titles and see shared results. Game state and audio never write music queues or control ordinary playback. This focused preview excludes concert reactions, highlights, bingo and Discord Activities.
- Core operators can explicitly enable GUESS_SYNTHETIC_TEST=1 to test multiplayer rounds with five locally generated tones and fictional Test Tone One through Test Tone Five answers. The website labels this synthetic test catalog, limits it to five rounds of at most 30 seconds, and starts preview audio only after a local click. No real songs, external provider transport or music rights are included; the default catalog remains unavailable.
- Game requests reuse room or fresh Discord membership authorization, bind answers and media to the current session and round, and reject stale or repeated actions. Local audio stops on cancellation, hidden tabs, disconnection, changed access and round changes. Sessions are ephemeral and disappear on Core restart. Automated synthetic checks do not establish real music availability or audible Discord playback.

## v2.2.14: Keep specific player failures visible

2026-10-20

- YouTube player and API-loader failures remain visible after the startup deadline instead of being replaced by a generic timeout. Failed startup stops the loading indicator, stale callbacks from an unmounted player cannot change its replacement, and unanswered startup still reports the existing timeout. Browser-local diagnostics retain only the numeric provider error code, without media URLs or user data.
- Stable bot and web patches are reviewed separately from the experimental beta and Discord Activity line. This patch ports only shared player error handling and documents that boundary; it does not add Activity routes, SDK/session changes or media proxy mappings, and does not establish working Discord embedded video or audio.

## v2.2.13: Append ordinary queue additions

2026-10-20

- Ordinary additions and approved room requests append after the existing queue, including eligible queued radio suggestions. Adding a song no longer silently removes those suggestions and makes the new request appear first. Discord voice and browser-room playback keep their current track and server/session boundaries.
- Explicit play-next still inserts at the front; play-now remains an explicit track change. Full queues reject additions without removing existing entries, and duplicate/current-track guards remain in place. Queue rendering follows the authoritative order. This stable fix contains no Discord Activity routes or experimental playback changes.

## v2.2.12: Prefer matching music videos in radio

2026-10-19

- Automatic radio prefers an eligible official-music-video-labelled upload of the selected song and artist, including after catalog audio matching. Song relevance, recording identity, genre, history and exclusions remain authoritative; title wording alone cannot authorize a match.
- When no suitable video is found or the bounded video lookup fails, radio retains its playable audio match. Manual queue priority and separate server and room state are preserved. Provider metadata does not verify upload authenticity, and videos with incompatible versions or long introductions remain excluded.

## v2.2.11: Balanced DJ backdrop logo

2026-10-19

- The AP emblem sits lower behind the DJ in welcome and empty-room scenes, sized to fit fully inside the rear LED screen with comfortable margins. The character, console and playback controls are unchanged.

## v2.2.10: Retire the optional legacy Core dashboard

2026-10-19

- Removed the obsolete optional Core dashboard assets and its separate local HTTP listener, including dashboard-only session, health, state, player, settings and public-room routes. Custom createServers integrations must remove adminPort, passwordHash, hosts, privateState and siteFetch options and stop using the returned adminServer. Use the supported website /admin for administration.
- The regular Afterparty website, its APIs, Core /v1 bridge, live WebSocket and playback clock remain supported. Discord server isolation, private rooms, recovery tools and historical screenshots are preserved. Normal Core startup already disabled the old listener, and production images already excluded its assets.

## v2.2.9: TypeScript tooling and current setup guidance

2026-10-19

- ESLint and PostCSS configuration now lives in typechecked TypeScript, with small conventional loader adapters preserved. The maintained shell installer calls the TypeScript implementation directly; older installer entry points remain compatible.
- The README clarifies setup and validation commands, implemented versus deployed status, and the paused Rust evaluation. Existing Rust research and legacy dashboard assets are preserved.

## v2.2.8: Safer connections and server channel lists

2026-10-19

- Core rejects malformed WebSocket upgrade URLs without terminating the process. Valid live connections and existing origin and server permission checks are preserved.
- The control room discards delayed channel lists after the selected server changes, so a refreshed server selection cannot display channels from the previous server.

## v2.2.7: Private owner update shortcut

2026-10-18

- Owner-password sessions can open a configured private updater from a discreet icon beside Sign out in the control room. The icon has a localized tooltip and accessible name, with no separate panel or explanation text. It stays hidden from anonymous visitors, Discord-only administrators and bridge-key callers; the updater keeps its own authorization.
- Operators can configure the optional HTTPS address through the OWNER_UPDATE_URL runtime secret without publishing private hostnames in source. Existing deployments are unchanged when it is unset.
- The owner shortcut remains available when Core is unreachable or unconfigured, without granting access to any additional Discord server. The control room revalidates the local password session independently of Core and removes the shortcut and owner access after session expiry or password rotation. Separate Discord server permissions remain independent.

## v2.2.6: Consistent playback layouts and simpler server controls

2026-10-18

- TV, fullscreen and room settings use more consistent spacing, readable controls and bounded form fields. The embedded video fills its available player area without an unused side strip, while the source player stays mounted across layout changes.
- The concert illustration has evenly spaced PA modules, cleaner rigging and a calmer LED backdrop with clear separation between the logo, ring and performer. Empty-room headings remain readable in full; on mobile, explanatory text sits above the stage instead of over the performer.
- Configure the bot on the administration page using grouped playback, queue and voice settings. The registered slash menu is reduced from 33 to 17 commands; advanced playback options are grouped under /play, and old configuration commands privately link to administration instead of changing settings. Group labels, help and save confirmations follow the selected website language without changing stored values.

## v2.2.5: Faster radio discovery and a more consistent interface

2026-10-18

- Radio fetches its two bounded discovery pools concurrently while preserving selection order and music safeguards. Overlapping cold video lookups share metadata work, retain independent playback entries and can recover after failures.
- Core cleans up listeners, timers and any already opened server when startup fails to bind a port. Closing the service remains safe to repeat.
- The stage has matching DJ decks and a centered four-channel mixer, flown concert PA arrays with subwoofers, and improved red and white stage lighting. Opaque speaker cabinets block rear beams, and the animated backdrop ring stays inside its LED screen.
- Shared dark surfaces, red accents, navigation proportions and keyboard focus make music, rooms, administration, support and patch notes more consistent on desktop and mobile. The welcome page's top patch-notes banner is removed; the current version remains linked in the footer.
- Adding music in a Discord concert refreshes the authoritative queue as soon as the command is confirmed. Queue-read failures remain separate from successful additions, and delayed replies cannot replace another server's queue or a newer error.
- New website sessions default to English while retaining saved language choices. Discord help, player controls, command descriptions and standard errors use English. Use /help, /concert url and /history count; existing Norwegian command aliases still work. Unsupported split and inactive announcement settings are no longer offered as working slash options.
- TV mode gives video and track information their own layout with a QR panel and a visible exit control, while retaining the mounted player when entering or leaving. Nickname settings explain that the name labels track requests and does not grant access.

## v2.2.4: Radio venue and artist-alias safeguards

2026-10-18

- Automatic Radio excludes bare live-recording suffixes naming Wembley, Glastonbury or BBC Radio 1, including trailing video-format labels. Ordinary studio titles such as Live Forever remain eligible.
- Radio repeat detection treats Beatles and The Beatles as the same artist spelling for the same song, including catalog suggestions and playback history. Other artist names and catalog relationship checks retain their existing rules.

## v2.2.3: Radio fixes from real catalog testing

2026-10-18

- Radio recognizes artist prefixes with colons and preserves names with commas. Structured collaborator credits no longer block valid Oasis songs. Studio titles such as Live Forever and Cover Me remain eligible, while explicit live, cover, demo and instructional upload labels are excluded, including live or cover labels followed by Official Video or HD.
- Featured credits and demo or promo annotations no longer let another version of the starting song reappear as a new recommendation. Different known artists can share a title, while same-artist alternate uploads and remasters stay excluded as repeats. Existing playback history still blocks repeats after artist credits are refined, including when cached metadata refreshes for the same verified recording.
- Radio recognizes explicit R&B and DnB genre aliases and compound tags such as Hip-Hop/Rap and Drum & Bass/Jungle without treating free-form artist tags such as Daft Punk as genre evidence. Broad genres still require stronger relationship evidence. Core and website metadata caches refresh under the corrected interpretation.

## v2.2.2: Manual requests replace radio at queue capacity

2026-10-18

- Manual songs and approved concert requests can replace automatic radio suggestions when the resulting queue fits the configured limit. Duplicate filtering and play-next ordering are preserved.
- Requests that would exceed the retained queue limit still fail without changing the queue or removing pending approvals. Request-only moderation limits and private server boundaries remain unchanged.

## v2.2.1: Fresh saved browser state across tabs

2026-10-18

- Saved room ownership and device preferences read the latest stored value after another tab changes them, including when a settings view is reopened. Successful saves no longer leave a stale in-memory copy.
- Browsers that block saving still retain changes for the current page. Observed settings continue to share cached reads and receive same-page and cross-tab updates.

## v2.2.0: Radio 2.0: shared discovery and safer recovery

2026-10-17

- Radio uses one shared selection pipeline for Discord, browser rooms and the website fallback. It compares bounded recommendation and search pools before selecting, preserving the original song, matching style, manual queue priority and private server boundaries.
- Known played or rejected recordings are filtered before catalog matching, so duplicate results no longer consume the limited playback lookups. Sparse results can fall back to the original artist, and empty recommendation caches expire sooner so a later retry can recover.
- Automatic choices still reject unsafe content, conflicting styles and repeated recordings. Structured diagnostics distinguish empty providers, rejected candidates and lookup failures without recording song titles, room identifiers or credentials. Existing playback clocks, revision checks and cooldowns remain in effect.

## v2.1.6: Less repeated work in settings, queues and radio

2026-10-17

- Saved device settings reuse an observed value until a local change or another tab invalidates it. Changing a nickname or motion preference writes once, and evening libraries keep the same first recording and order with a single deduplication pass.
- Queue requests and Discord administration with an explicitly selected server avoid an extra Core metadata request. Discord permissions and session expiry are still checked on each operation, and owner access remains limited to the configured default server.
- Core radio queue validation prepares recording history once per selection pass and reuses title parsing. Manual choices, exclusion rules, suggestion order and the shared playback clock are preserved.

## v2.1.5: Accessible settings tabs and consistent radio backoff

2026-10-17

- Room, Queue and Video settings now have separate localized tabs in browser rooms and Discord concerts, including empty rooms and fullscreen. Arrow keys, Home and End move between tabs; only the selected panel is shown. Permissions, saved device preferences and the active player are preserved.
- An unsuccessful early radio skip in a browser room now saves the same 15 second automatic-search cooldown as Core before reporting the empty result. Playback and its clock continue, and a newer room command cannot be overwritten by the delayed response.

## v2.1.4: Preserve radio exclusions when undoing queue edits

2026-10-17

- Undoing a room queue edit clears radio exclusions only for automatic suggestions actually restored by that undo. Previously rejected songs and alternate uploads stay excluded from radio when they are also present as explicit manual queue choices. Manual playback, queue order and the shared playback clock are preserved.
- When a removed radio suggestion is manually added again before undo, its current manual request and requester are retained at the restored queue position, including after radio is disabled. Undo no longer silently drops that manual choice, and its radio exclusions remain in place.

## v2.1.3: Unified settings and radio recovery

2026-10-17

- Room, Queue and Video controls share one settings panel in browser rooms and Discord concerts, including fullscreen. Mobile name and TV controls fit within the viewport.
- Radio can refine broad House metadata from a validated upload of the same recording and use a bounded original-artist fallback when a genre search is sparse. Unrelated videos, conflicting styles, non-music results and repeated recordings remain excluded.
- Hosts can retry radio while the current track keeps playing. Empty retries report that no suitable track was found, preserve the shared playback clock and apply the same 15 second automatic-search cooldown in Core and the website fallback.

## v2.1.2: Discord video seeking and release readiness

2026-10-16

- Native YouTube seeking in a Discord concert now sends an authenticated seek to Core for the selected server. Video waits for command confirmation and then follows the fresh shared position. Guests cannot change the shared position, and buffering does not publish seek commands.
- Radio recommendations retain the original seed and exclude instructional videos. Discord voice connection errors are handled without losing other servers or startup recovery.
- Browser audio preferences, room callbacks and administration drafts remain consistent across updates. Internal page links retain working native navigation.
- The release lint backlog is resolved, and validation now requires zero lint warnings. This entry also records the previously missing release notes for those maintenance changes.

## v2.1.1: Private queue isolation and accurate crossfade recovery

2026-10-15

- Public concert requests, direct additions and approvals no longer reject songs solely because they are playing or queued privately in Discord. Duplicate protection remains within each visibility scope and pending concert requests.
- Audio recovery selects the track and position from the same consumed segment, removes that entry from the queue, and preserves later tracks. Exhausting the two retries advances past the recovered track instead of replaying it.

## v2.1.0: Shared concert queue controls and resilient audio

2026-10-15

- Discord concerts use the shared queue layout with artwork, waiting times, votes, moderation, removal, reordering, clear and undo. Management requires verified access to the selected Discord server. Ordinary private Discord tracks remain private and are preserved by concert queue edits.
- Concert approval settings and pending website requests are stored by Core. Queue revisions reject stale edits, and undo expires after a track change.
- Crossfades use a bounded decoded buffer. Slow or failed next sources cannot block a healthy current track. Unfinished audio streams trigger at most two retries of the same track from its consumed position instead of being treated as a normal song ending.
- Audio buffering is separate from an explicit pause. Admin diagnostics include bounded, sanitized audio events, missing frame counts, longest interruptions and maximum event-loop delay. Browser video diagnostics remain local.
- Regression coverage checks that YouTube quality changes retain the player and do not publish transport commands or reload the song. The reported real-player return to 1440p remains unverified; no quality lock is imposed.

## v2.0.4: Queue consistency and faster queued skips

2026-10-15

- Playing a queued song directly consumes its queue entry, removes radio suggestions prepared for the previous song, and resets obsolete undo and radio retry state. Other manually queued tracks remain in order.
- Undo cannot restore radio suggestions after radio has been switched off. The fallback room service now persists deleted state fields correctly while retaining room permissions.
- Skipping to an already queued song, or skipping with radio disabled, bypasses unnecessary radio lookup coordination.

## v2.0.3: Queue artwork and radio retry cooldown

2026-10-15

- When an early skip shares an empty radio search with automatic prefetch, the current song keeps playing and a persisted 15 second cooldown prevents repeated provider searches on every room tick.
- The queue restores the current song card, artwork and artist information.

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
