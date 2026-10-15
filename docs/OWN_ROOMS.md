# Own video rooms

Own rooms use their own video queue and host token. They do not require a Discord
connection and do not read a Discord server's playback history or favorites.

Radio is enabled by default, including for existing rooms. The host can switch
it off with **Radio on** beside the room controls. When the host's player reaches
the end, or the host presses Next, manually queued videos take priority. If the
queue is empty, radio searches for another embeddable song by the current artist.
Live streams do not seed radio. The previous 20 videos are retained privately in
the room state to avoid recent repeats. The same selection rules apply with Core
and with the standalone website database.

A result is committed only if the room version still matches. A concurrent queue
edit, pause or radio toggle invalidates a pending result. A failed lookup leaves
the current state intact and the host can retry Next. A successful search without
a suitable candidate ends playback. Selection happens at the transition and may
introduce a gap. Automatic transitions still require the host's player to be open.

**Start video** opens the local YouTube player and resumes a paused room when the
viewer has transport permission. Pressing play before opening a video already
playing in the room starts the local player. Guests cannot resume a paused room.
If the browser blocks audible autoplay, the player tries muted playback once and
offers **Enable sound**. This temporary fallback does not overwrite saved volume
or mute preferences. Browser policy and video availability can still prevent
playback.

No database migration is required. The optional radio flag and bounded history
are stored in the existing room JSON. Update both the website and Core when Core
provides room state, so the controls and engine support the same actions.

## Synthetic regression checks

`npm run check:all` includes Core room and HTTP bridge tests and standalone
website handler tests using an in-memory SQLite adapter for D1. The tests cover
manual queue priority, persistence, permissions, stale asynchronous results and
the playback clock after a delayed lookup. Provider tests cover one unavailable
search candidate and recovery from an empty cached search.

For the browser flow, start `npm run dev -- --host 127.0.0.1` and, with Playwright
and Chromium installed, run:

```bash
node --test --test-concurrency=1 scripts/video-start.browser.mjs
```

`PREVIEW_URL` can select a different localhost preview. `PLAYWRIGHT_MODULE` can
point to an external Playwright module and `CHROMIUM_PATH` to a browser binary.
All API and YouTube responses are synthetic; external browser requests are
blocked. These checks prove the control flow, not actual YouTube availability,
browser autoplay permissions or audible playback in Discord. Real own-room host
and guest playback still needs a local manual check after review.
