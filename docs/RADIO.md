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
- Browser rooms can learn a missing genre from another upload of the same recording. Artist, song identity, version labels and duration must agree. A tutorial, cover or alternate instrumental cannot supply that metadata.
- Core can use Last.fm's similarity to the original song. Missing, malformed or weaker-than-0.2 similarity scores are discarded. The score is provider evidence, not a measured audio similarity guarantee. Matched playback videos still pass content, style, history and visibility checks.

The uploader's channel name cannot override a different artist named in a video title. A shared publisher such as NCS is not artist evidence. Old unfiltered Last.fm cache entries are not reused by the updated selection policy.

## Music filtering

Automatic candidates must be finite, non-live songs between 90 and 600 seconds. Searches, metadata learning, catalog matches and prepared radio entries reject instructional and non-song titles, including tutorials, common how-to variants, production lessons, DAW projects, step-by-step videos, reactions, interviews, covers, remakes and long sets.

Older queued automatic entries are checked again before playback or crossfade preparation. Manual selections are preserved. Title and metadata filtering is conservative and can reject a valid upload; incomplete or misleading provider metadata can still affect selection. When no safe candidate is found, existing cooldown, retry and playback-preservation rules apply instead of choosing an unrelated result.

## Validation

The new regressions reproduce the original-seed drift, broad-pop mismatch, instructional candidates and unsafe Last.fm matches against the previous source. Tests cover restart, manual replacement, toggles, historical room migration, conflicting genres, weak/cache results, uploader ambiguity, metadata versions, saved suggestions, crossfade preparation and the standalone D1 fallback. Existing stale-revision, late-result, manual-queue, voice isolation and real FFmpeg suites remain part of `npm run check:all`.

This source change passes 56 Python operations/recovery tests, 65 website tests and 165 Core tests, both typechecks and the production build. The added coverage includes 17 Core radio regressions and one D1 fallback regression. Chromium party, concert-queue, all 13 video-start tests and the seven-page service check pass. Both production npm audits report zero findings. Focused radio lint passes; repository lint still has 106 existing errors and 29 warnings, down from 109 errors before the typed Last.fm parser.

Tests use synthetic metadata, providers, databases and audio. They do not certify live provider availability or musical similarity for every recording. Follow [operations](../services/core/PUBLIC_RELEASE.md) to update both Core and the website together, then verify the intended station on the deployment host before release.
