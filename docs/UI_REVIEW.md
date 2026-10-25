# Afterparty interface review

## Native v3 familiar layout, 2026-10-25

The unpublished `3.0.0-alpha.2` candidate follows the older visual composition in
the sole Svelte website. Horizontal navigation replaces the sidebar. One player
surface contains track information, room/device settings and optional extras.
Queue, Search and Library share a persistent tabbed panel beside the player on
wide screens and below it on narrow screens. A mobile dock returns directly to
these music surfaces. The official YouTube player owns playback, seek, volume and
fullscreen controls; app duplicates are removed even before audio activation.

Tab changes retain search results, unfinished library fields, playlist jobs and
preview selections. Inactive panels are hidden and inert; the library remains
lazy until first opened. Native track disclosures support Escape and focus after
reorder/removal. Completed commands preserve focus when the user moves to search.
Invitation copying and QR share one panel, with selection after clipboard failure.
Open rooms supports name/code filtering, counts and last-good-list recovery.

Synthetic browser fixtures check 3840×2160, 2560×1440, 1920×1080 and 390px mobile,
including overflow, horizontal navigation, player/workspace geometry and mobile
quick access. TV fixtures also check 1280×720, QR scaling and fullscreen. Local
YouTube fixtures verify authorized native transport and guest-local pause without
requesting live media. An additional held-acknowledgement fixture withholds all
250 ms sampling ticks and checks native pause/seek dispatch plus queue-next source
replacement without reconstructing the player. Its timing diagnostics measure
local application dispatch only, excluding network, YouTube buffering and audible
Discord output. Shared seek confirmation still precedes synchronized playback.
These checks do not establish real-device audio or rollout.

[Desktop fixture](assets/v3-familiar-desktop-20261025.png) ·
[Mobile viewport](assets/v3-familiar-mobile-20261025.png)

## Historical review: 2.4.0-alpha.14

Reviewed for `2.4.0-alpha.14`, based on merged main `f604b966bd22ed2243348e38bb851a4b07afa04a`.
The scope is the existing website, with its current routes, permissions and music behavior.

| Surface | Observed problem | Implemented change |
| --- | --- | --- |
| Shared navigation and controls | Mixed pink/red control surfaces, inconsistent sizes and small mobile targets | Neutral shared tokens, consistent controls, visible keyboard focus and 44-pixel main targets |
| Welcome and room entry | Competing accent colors and inconsistent heading/control proportions | Calmer typography, neutral secondary actions and consistent dialog fields |
| Player and room settings | Large title overlays, tinted everyday fields and nested extras cards | Smaller title overlays, neutral settings, flat extras disclosure and retained player controls |
| Search and history | Long stacked suggestions, detached playlist action, disconnected sorting/count and red add buttons | Grouped search/import tools, focus-triggered suggestion rows, one results header and neutral add controls |
| Queue and saved evenings | Mixed text glyph controls and dense local tools | Consistent icons with existing accessible labels, clearer rows, bounded festival scrolling and on-demand local backup tools |
| Games | Oversized headings, decorative category boxes and joined heading words in compact mode | Smaller headings, simpler categories, neutral status surfaces and corrected word spacing |
| Administration | Legacy red surfaces, tiny supporting text and an obsolete idle mark | Neutral operational controls, bounded fields, clearer groups and the canonical monogram |
| Information and copyright pages | Separate typography and accent treatments | Shared type, spacing, neutral links/fields and visible form focus |
| TV and fullscreen | The invitation exceeded a short landscape viewport | Compact invitation layout while retaining the video slot, source player and exit controls |

Search matching, suggested query values, AI exclusions, pagination and queue
commands are preserved. Server authorization, queue revisions, playback clocks,
audio source selection and the alpha quiz configuration remain unchanged.
Suggestions open while the search input is active, remain keyboard-reachable,
and close on Escape, search submission, selection or leaving the search tools.
Returning to the Search tab does not reopen them automatically. Red accents
remain on active controls and primary actions; fields and secondary surfaces
stay neutral.

The reproducible local audit is `npm run test:ui-review`, with `PREVIEW_URL`
pointing to a loopback preview and `CHROMIUM_PATH` set when needed. It covers
desktop English and mobile Bokmål across all routes, additional narrow/tablet
primary surfaces, keyboard navigation, selected touch targets, dialogs, loading
and unavailable states, controlled mutations, and a short landscape
fullscreen/TV view. It uses synthetic API data and a local iframe fixture.

Relevant existing search, queue, playlist, concert, admin, social, copyright and
game browser suites remain separate from `npm run check:all`. The shared full
check includes lint, both typechecks, website/Core/recovery tests and the
production build. Review screenshots represent controlled fixtures, not a
production deployment or real-device listening test.

The broad production Worker review passed the complete 81-capture audit with zero
findings. The shared full check passed 737 Core tests, 158 website tests and 93
recovery tests, both typechecks, zero-warning lint and production build. The TV
height regression found during the first audit was repaired and rechecked.
The focused-search follow-up passed five search browser cases, 20 narrow/tablet
and 32 desktop audit captures, the room-setup workflow including first-search
focus, and responsive canonical notes checks. Active tabs retain red indicators;
the screenshot below shows results with the suggestions closed.

[Search panel](assets/ui-search-alpha14.png) ·
[Short landscape TV layout](assets/ui-tv-short-alpha14.png)
