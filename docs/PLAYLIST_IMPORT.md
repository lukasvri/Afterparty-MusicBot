# Import YouTube and Spotify playlists

Open **Evenings** and use **Import a playlist**, or paste a playlist link into
the ordinary music search and submit it. Search opens the import form with that
link filled in. **YouTube / Spotify Playlist** beside search opens the same form.
Choose **Load playlist** to start the metadata import. Loading alone never adds
tracks, starts a player, changes the queue or replaces saved evenings.

Supported references are public YouTube playlist links, YouTube watch links with
a `list` parameter, Spotify playlist/album links and supported `spotify.link`
shares. A YouTube watch link with both `v` and `list` imports the playlist rather
than only the currently selected video. Provider links are normalized to fixed
HTTPS hosts; arbitrary URLs, credentials and explicit ports are rejected.

The preview keeps up to 500 available entries with 20 per page, recording titles
and artists, a link back to the source and explicit selection. A 134-entry list
therefore remains available across seven pages. Unavailable, duplicate or
unmatched entries are reported. If an import reaches a limit or Spotify exposes
only partial embed metadata, the preview is marked partial. The application does
not claim it has imported the full source when that cannot be established.

The existing queue capacity remains 50, including pending browser-room requests.
Choose the tracks to add, or use **Select first …**, then **Add … selected to
queue**. The current room's remaining capacity is displayed and enforced by the
selection. Remaining source entries stay in the preview for later selection.
Server authorization, revision checks and queue limits remain authoritative if
another listener changes the queue. Queue additions are sequential; an unavailable
track can leave a reported partial addition. Leaving or switching the room stops
further additions. Existing music and saved evenings are preserved.

## Source and resource behavior

The connected Core handles metadata preparation through `/v1/playlists`, behind
the existing authenticated website bridge. YouTube uses paginated playlist
metadata or a bounded yt-dlp metadata fallback. Spotify uses its existing catalog
reader and recording matching; no Spotify audio is streamed or added to the quiz.
The ordinary bot's configured playlist limit is unchanged.

Imports return a job immediately so long Spotify matching is not held inside a
single website request. At most two jobs prepare simultaneously, with a
three-minute deadline, 500-entry limit and at most 32 retained jobs. Jobs expire
after ten minutes. Cancelling or shutting down aborts work and prevents late
results from being published. Work that ignores cancellation retains its running
slot until it settles. Finished jobs contain sanitized public recording metadata,
without provider credentials, private matching proof or arbitrary upstream URLs.

Read/cancel requests require a random job ID and capability, sent only in JSON
bodies. Capabilities stay in component memory and are not written into URLs or
browser storage. The website rate-limits imports separately from search and room
playback. Opening or filtering the built-in festival catalog does not start an
import. Imported playlists are previews, not automatic additions to that curated
official-source catalog or the private quiz pack.

Tests use controlled 134-entry YouTube pagination, Spotify metadata and isolated
local queues. They do not establish that a particular live provider playlist is
currently public, complete, available in a territory or browser-playable. Provider
errors are displayed without silently substituting one search result.
