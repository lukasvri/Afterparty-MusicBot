# Radio selection and the original song

[Documentation](README.md) · [Own rooms](OWN_ROOMS.md) · [Music sources](../services/core/docs/music-sources.md)

Radio follows the most recent explicit song choice that becomes current. An automatically recommended song does not replace that original. This prevents a chain of individually related recommendations from gradually changing the station's direction.

## Seed lifecycle

Discord Core stores the original track in the server's private SQLite state. Browser rooms store it in their private room JSON. Both survive service restart. Queueing a manual song leaves the current original intact until the queued song becomes current; a direct play selection changes it immediately. Pausing, seeking or toggling radio does not change the original. An explicit Core stop clears it.

The current song and recent history are still excluded from selection, even when they differ from the original. Normal Discord music and concerts preserve their visibility boundaries. The original seed is not added to public room snapshots.

Older browser rooms can recover the last explicitly marked manual song from history. When an older installation has no original seed or identifiable manual history, the earlier choice cannot be reconstructed reliably. Choose the intended starting song once after updating; subsequent automatic tracks retain that choice.

## Similarity evidence

- A specific genre such as electro house or progressive house can support recommendations across artists. Conflicting explicit styles are rejected.
- A broad tag such as pop, rock or house does not establish that another artist belongs in the station. Without specific metadata or a vetted recording relationship, selection stays with the original artist.
- Browser rooms can learn a missing genre from another upload of the same recording. Artist, song identity, version labels and duration must agree. A tutorial, cover or alternate instrumental cannot supply that metadata. The accepted recommendation retains private proof tied to the original video ID, so reloading or advancing a prepared queue does not discard the learned relationship. That proof is removed from public snapshots.
- Core can use Last.fm's similarity to the original song. Missing, malformed or weaker-than-0.2 similarity scores are discarded. The score is provider evidence, not a measured audio similarity guarantee. Matched playback videos still pass content, style, history and visibility checks.

An uploader label, including `Official`, `Topic` or `VEVO`, cannot override a different artist in an explicit `Artist - Song` title. A specific Topic or VEVO channel can supply the artist when the title contains only the song or a recognized recording suffix such as `2024 Remaster`. Shared publishers such as NCS and Various Artists are not artist evidence. Unknown upload channels need an explicit artist title, specific genre or validated catalog relationship. Ambiguous title separators remain a metadata limitation. Old unfiltered Last.fm cache entries are not reused by the updated selection policy.

## Music filtering

Automatic candidates must be finite, non-live songs between 90 and 600 seconds. YouTube video metadata and the yt-dlp fallback retain explicit music-category evidence. A known non-music category excludes automatic selection, including on the website fallback; absent category metadata remains unknown and can use the other evidence above. Search and metadata cache versions prevent older results from bypassing this check. Manual playback remains available for non-music videos.

Searches, metadata learning, catalog matches and prepared radio entries reject instructional and non-song titles, including tutorials, procedural how-to phrases, production lessons, DAW projects, step-by-step videos, reactions, interviews, vlogs, gameplay, covers, remakes and long sets. Filtering uses the song portion after a recognized artist prefix, so an artist name such as The Trailer Park Troubadours is not mistaken for a trailer. Real song names such as Music and How To Love remain usable, including Topic uploads.

Older queued automatic entries are checked again before playback or crossfade preparation. Manual selections are preserved. Title and metadata filtering is conservative and can reject a valid upload; incomplete or misleading provider metadata can still affect selection. When no safe candidate is found, existing cooldown, retry and playback-preservation rules apply instead of choosing an unrelated result.

## Repeats, rejection and explicit replay

Radio compares recording names as well as video IDs. Normalization recognizes alternate uploads, remasters, radio edits, instrumentals and remix labels. Named remixes without brackets are compared against known originals; this is a conservative metadata rule, not an audio fingerprint. Candidates are ranked before duplicate uploads are collapsed, allowing the better official upload to win.

Core checks its last 100 public playback records and retains a bounded private history of canonical catalog metadata. Public history continues to omit catalog, requester and recommendation-proof fields. This prevents a matched song from reappearing merely because its YouTube title differs from its catalog title. Browser rooms check current playback, history, removed suggestions and earlier prepared queue entries. A paused song is still current and is excluded even before audible playback is recorded.

Skipping an early automatic song or removing a prepared suggestion records both its ID and song metadata. Core exclusions last seven days and are capped at 200 entries per server; room exclusions are bounded by the room's private state. Clearing or removing a suggestion permits a new lookup instead of retaining the previous successful lookup's infinite retry delay. Undo lifts the restored suggestion's removal exclusion while retaining unrelated exclusions.

These exclusions apply to new automatic choices. Manual requests, explicit unskip and saved-queue replay, and queue looping preserve the user's replay intent. A checkpoint can resume the exact previously active entry despite its presence in history. Numbered skips retain their requested target when an unsafe older suggestion is removed from the queue. Normal Discord queues, public concerts and other servers retain their existing separation.

## Validation

The radio suites cover original-seed drift, broad-pop mismatch, instructional candidates, category loss on provider fallback, alternate recordings, private catalog identity after restart, weak and unsafe Last.fm matches, uploader ambiguity, learned genre persistence, current and historical duplicates, skip/remove/undo, explicit replay and exact checkpoint recovery. The D1 suite exercises the actual website fallback and refresh of older search metadata. Existing stale-revision, late-result, manual-queue, voice isolation and real FFmpeg suites remain part of `npm run check:all`. Check the current PR and CI runs for the result on a specific commit; older test counts are not evidence of current deployment.

Tests use synthetic metadata, providers, databases and audio. They do not certify live provider availability or musical similarity for every recording. Follow [operations](../services/core/PUBLIC_RELEASE.md) to update both Core and the website together, then verify the intended station on the deployment host before release.
