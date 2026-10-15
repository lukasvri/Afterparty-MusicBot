# Concert queue and audio stability review

Source version: 2.1.0. This review does not establish deployment or production sound quality.

## Concert queue permissions

Discord concerts and browser rooms share the queue presentation and settings components.
Discord queue state comes from Core, including pending website requests, votes and approval
settings. Moderation, reorder, removal, clear and undo require a validated Discord grant
for the selected guild. The existing owner session is restricted to the configured default
guild. A client-supplied host flag never grants access. Core authenticates the website bridge
and rechecks the selected guild's grant for privileged operations.

Concert edits address entry IDs, carry a queue revision and preserve private Discord tracks.
Undo preserves private track ordering and expires when playback changes. Queue edits during
an active crossfade are rejected until the transition ends. Votes do not invalidate prepared
audio. Approval applies to public website additions; existing Discord command permissions
continue to govern music added from Discord. Guests see voting and pending requests, while
management controls require the server's administration permission.

The website and Core must be updated together through the documented local rollout. An older
Core has no concert-queue endpoint. If the endpoint is unavailable, the website reports that
condition instead of pretending that local settings control Discord.

## Audio boundaries

- Crossfade PCM is prepared separately, with a maximum of 600 stereo frames, about 2.3 MiB
  per mixer. The fade starts only after its buffer is ready. A slow or failed next source
  cannot block available main-track frames. If it is not ready, playback continues without
  the scheduled fade. At the real end of the main source, the normal next-track path applies.
- The decoder's six-second data deadline precedes the sink's seven-second missed-frame limit.
  An unfinished sink source is an interruption, not a natural end. Recovery retries the same
  entry at the consumed position at most twice, then advances. Explicit stop and pause remain
  separate. Live-source recovery starts at the live edge.
- Buffering freezes the reported authoritative audio position without reporting an explicit
  pause. The browser retains its player during the stall, then uses normal sustained-drift
  correction after recovery. Explicit pause remains immediate.

Admin diagnostics expose missing frames, longest interruption, maximum event-loop delay and
up to 50 recent fixed-code audio events. FFmpeg stderr is reduced to fixed categories, never
stored or displayed verbatim. Voice reconnects include elapsed time. Diagnostics are in memory
and reset on restart. `/health` includes aggregate audio buffering/interruption information.
Browser-local `window.afterpartyPlaybackDiagnostics()` returns bounded anonymous buffer and
correction events; it does not upload them.

## Evidence and limits

Automated tests cover queue moderation, stale revisions, private music preservation, cross-guild
authorization denial, false host claims, and both administrator and guest browser controls.
Synthetic audio cases cover a stalled/ended/failing next decoder, unfinished sink idle, bounded
same-track recovery and buffering versus explicit pause. Real FFmpeg fixtures check stereo Opus
encoding and a prepared crossfade at 96 and 192 kbit/s.

The quality regression simulates a 1440p to 720p event with brief buffering. It asserts the same
player instance, unchanged video-load count, no seek correction, and no shared transport command.
This is not proof of actual YouTube adaptive-quality behavior. Access to YouTube's iframe API
from this cloud environment returned HTTP 403, so the reported return to 1440p remains
unreproduced. No obsolete quality-setting API or artificial quality lock is used.

The historical production observations supplied on 15 October are context, not fresh measurements.
No production bot, live Discord account, private production data or active concert was used for
this review. There has been no production restart, deployment, multi-guild load test or end-to-end
listening test. Follow the local backup and active-playback safeguards in the operations guide.
