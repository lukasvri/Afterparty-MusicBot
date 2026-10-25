# Afterparty interface review

## Playback review corrections, 2026-10-25

Authenticated room access failures (401/403/404) remain latched through later
network and server errors. Fresh public frames cannot restore playback; a valid
authenticated snapshot must restore access first.

A concert seek preserves shared playing/paused intent. If that intent changes
while the seek receipt is pending, the player retires older queued transport
gestures, including a resume that would undo a newer pause. Concert buffering,
voice readiness and connection availability gate local playback separately from
shared intent, holding the local clock while unavailable.

Concert theater removes its sticky parent stacking context, so the fixed video
actually covers the sibling workspace. Browser checks probe hit-testing across
the video at 4K, QHD, 1080p and mobile, rather than relying on dimensions alone.
Each of these three review findings reproduced a test failure before correction.
The concert fixture holds the final seek read, delivers a newer shared pause,
and checks both retired queued gestures and subsequent explicit user controls.

## Advancing-clock stress follow-up, 2026-10-25

A three-browser loopback test now models actual elapsed playback in each synthetic
player, rather than a fixed current-time value. It checks host/guest clocks at
4K, QHD and mobile, settled synchronization without repeated corrections, three
rapid scrubs with a 1200ms held receipt, and a guest-local pause surviving a later
host seek. The server fixture preserves elapsed position when pausing/resuming.

This test reproduced one additional programmatic seek after a native scrub
acknowledgement. An effect could already settle the intent before the completion
callback called `sync(true)` again, defeating its recovery interval. Successful
native seek completion now reconciles without that second forced correction.
Queued scrubs also refresh their target from bounded, observed player progress
when dispatched. Stale/backward, unrelated, invalid and ended-source readings
retain the original target; paused/buffering playback never invents progress.
The existing source identity, revision, receipt and permission guards still apply.

The 750ms phase bound is an isolated test tolerance, not a real-provider latency
claim. Real YouTube buffering, host networking and audible Discord output remain
separate acceptance checks. No additional runtime or duplicate playback service
was introduced.

## Continuous native playback and full-tab theater, 2026-10-25

This follow-up supersedes the earlier page-width theater layout and fixed-height
empty-room stage below. The existing iframe now fills the browser tab in theater
mode, with a fixed Exit theater mode button, Escape outside native fullscreen,
background focus exclusion and restored document scrolling on exit. One shared
style owner and `TheaterToggle.svelte` implement this for rooms and concerts;
layout changes do not construct a second player or send transport commands.

The DJ scene fills the available player width at the priority desktop sizes,
with viewport-bounded height and its complete original aspect ratio. Mobile fits
the complete scene directly. The song action stays on the booth. The separate
record/headline/action panel remains removed.

Room playback corrections address three independently reproducible failures:

- Playing seeks previously scheduled another 1500ms future start in the shared
  Core/Worker state reducer. They now re-anchor immediately. Starts/resumes retain
  their barrier; paused seeks remain inaudible.
- Native scrub callbacks can include PAUSED/BUFFERING/PLAYING. Position changes
  take precedence over these temporary states. Native receipt handling keeps the
  existing video running, retains the newest scrub and transport intent behind
  the in-flight write, and avoids forcing another correction on acknowledgement.
- An authenticated poll failure previously stopped playback even with a healthy
  public SSE lease. Transient read failures now disable commands while the fresh,
  calibrated stream continues; access failures, expired leases and real stream
  loss still stop playback. Successful authenticated reads restore controls.
  Fresh SSE frames renew their lease and apply newer pauses while a command is
  pending. The exact acknowledged revision is retained separately from newer
  stream state, so a delayed receipt cannot replay queued gestures over a newer
  pause.

An explicit 409 rejection may refresh/retry play, pause or seek once, only when
identity, epoch, permission and the advancing playback timeline remain unchanged.
Next, queue edits and uncertain/network receipts are not automatically replayed.
A concurrent song, pause, seek, room switch or revoked access prevents retry.

Regression coverage includes synthetic native callbacks, delayed receipts, real
loopback EventSource failure/recovery, authorization/lease failures and matching
Core/D1 clocks. Regression checks failed before the fixes for rapid scrubs,
queue-only conflicts and fresh stream pauses during pending commands. The
built browser walkthrough checks tab coverage, stable iframe construction and
retained search drafts at 4K, QHD, 1080p and mobile. These checks do not establish
real YouTube buffering/latency, production network health or audible Discord output.

[Larger desktop stage](assets/v3-continuous-stage-desktop-20261025.png),
[mobile stage](assets/v3-continuous-stage-mobile-20261025.png) and
[full-tab theater](assets/v3-tab-theater-desktop-20261025.png) are synthetic
local captures. An authorized host acceptance pass should repeat real native
play/pause/scrubs, several rapid scrubs, a temporary status-read outage and
reconnection with host and guest browsers. Confirm the deployed source identities
of both website and Core before drawing conclusions about these source fixes.

## Unified section frame and compact empty room, 2026-10-25

Music, Open rooms, Concerts, DJ tools and Games now compose the same
`AppHeader.svelte`, `PageToolbar.svelte` and `AppFooter.svelte`. Header branding,
navigation, content gutters, H1 sizing and the top action row have one owner.
Shared theme tokens cover control height, radius, typography and panel spacing.
Feature-specific workflows retain their own components, authorization and
clients. Public legal/help pages retain their existing information-page frame.

Page actions stay with the heading: directory refresh/create, room and game
invitations, concert layout/invitation, and administration access/settings save.
The settings save button is associated with the existing form, preserving native
validation and submission. Concert invitations remain scoped to the selected
server and expand from the toolbar; TV keeps its visible invitation. The common
footer owns the motion preference on all five sections.

The empty listening room has a bounded stage rather than a second large
headline/record/action panel below it. Choose a song sits on the DJ booth front
as a normal keyboard-accessible HTML button outside the decorative SVG. The
route retains search/focus authority and renders the same action while the
optional illustration loads or fails. The complete scene keeps its aspect ratio;
lighting, CDJ geometry, reduced-motion and visibility pausing are preserved.

[Desktop empty room](assets/v3-unified-empty-desktop-20261025.png) and
[mobile empty room](assets/v3-unified-empty-mobile-20261025.png) use synthetic
local fixtures and reduced motion, with external requests blocked. Browser
regressions compare exact brand, navigation and heading geometry across all five
sections at 3840, 2560, 1920, 1440 and 390px. Stage checks cover compact sizing,
44px action targets, clipping, search focus and failed optional artwork alongside
the existing lighting/equipment/motion assertions. These are local interface
checks, not live media or Discord listening acceptance.

## Navigation and theater follow-up, 2026-10-25

The interactive Music, Open rooms, Concerts, DJ tools and Games links share one
`AppNavigation.svelte` owner. Labels, active state, spacing and 44px touch targets
stay consistent across rooms, concerts, administration and games. Existing room
and selected-server context remain in their links. Public information pages keep
their clear back link and legal/help footer. Generic form fields now have a
readable baseline while feature-specific controls keep their own styles.

The music workspace's column owns its scrolling. Search, queue and library lists
no longer create nested scrolling areas inside it. Collection/import/festival
sections share a flatter frame, smaller headings and consistent section spacing.
The workspace tabs restore their own scroll position. On mobile the document
scrolls naturally; the existing music shortcuts remain.
Administration separates site navigation from its compact local Playback,
Settings and Tools bar; Concerts in the site navigation replaces the duplicate
Watch concert link. The game entry screen uses a wide-screen two-column
composition with fluid type and vertically stacked room choices; narrow screens
retain the existing stacked flow.

Rooms and concerts offer a device-local theater mode. The video surface takes
the page width and moves the music workspace below, with bounded height on wide
screens and preserved video proportions inside the official player. Activating
it brings the view control and player into view. The saved layout preference
survives reload and does not enable audio, remount the player or send room/Discord
commands. TV and native YouTube fullscreen retain their existing layouts.

Synthetic Chromium checks cover navigation/active states, guild links, touch
geometry, keyboard use, theater sizing at 4K/QHD/1080p/mobile, persistent preference,
retained search draft and a single iframe across layout changes. Library jobs,
selection and authorization remain covered by their existing journeys. Screenshots
are isolated fixtures, not live music or server accounts.
[Theater capture](assets/v3-ui-theater-desktop-20261025.png) and
[mobile administration](assets/v3-ui-admin-mobile-20261025.png) and
[game entry](assets/v3-ui-games-desktop-20261025.png) show this pass.


## Animated stage and welcome layout, 2026-10-25

The welcome layout gives the stage its own fluid column beside the introduction
and create/join forms, with a 3200px readable maximum instead of the former 1280px
welcome cap. On mobile the complete stage appears above the forms. The scene
restores sweeping spots, two seven-ray laser fans, counter-rotating LED rings,
a slow halo, screen levels and the stage ribbon. Both CDJ control surfaces and
the mixer face the performer in the projected table plane. Jog wheels, displays,
buttons and pitch controls have been redrawn; the hand layer remains in front.

The animation button sits beside the stage and explains when system reduced
motion is active. CSS transform/opacity animations pause when the scene leaves
the viewport or the tab is hidden. System and saved reduced-motion preferences
still suppress animation. No strobe, media request, audio analyser or frame loop
is added. Active rooms retain the lazy scene boundary.

Search results in browser rooms and public concerts share `TrackThumbnail.svelte`:
16:9 lazy images, no referrer, stable dimensions and a music-icon fallback for
missing or failed images. The metadata already supplied by search is reused.
The native player settings have an explicit grid body and separate Video & sound,
Device synchronization and room settings groups. The existing YouTube player
manages adaptive quality; 4K depends on the source, device and connection. No
unsupported quality-forcing API or duplicate playback controls are introduced.

Synthetic Chromium journeys check actual changes to spot/laser/ring transforms,
CDJ orientation, equipment bounds, reduced motion, saved toggle behavior and
4K/QHD/1080p/mobile layout. Search checks cover loaded, broken and missing images
while retaining keyboard queue actions. Settings checks preserve device-local
preferences and the existing shared-command boundary. Captures:
[desktop](assets/v3-stage-desktop-20261025.png),
[mobile](assets/v3-stage-mobile-20261025.png).


## Native v3 familiar layout, 2026-10-25

The unpublished `3.0.0-alpha.2` candidate follows the older visual composition in
the sole Svelte website. Horizontal navigation replaces the sidebar. One player
surface contains track information, room/device settings and optional extras.
Queue, Search and Library share a persistent tabbed panel beside the player on
wide screens and below it on narrow screens. A mobile dock returns directly to
these music surfaces. The official YouTube player owns playback, seek, volume and
fullscreen controls; app duplicates are removed even before audio activation.
When public-concert browser playback is unavailable or fails, a collapsed recovery
panel exposes authorized Discord pause/resume and a manager link to the DJ desk.

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
