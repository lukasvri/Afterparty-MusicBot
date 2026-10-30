# yt-dlp metadata-only extraction

Source review: yt-dlp **2026.10.26**, inspected 2026-10-30. The source review
itself used official code/documentation; subsequent bounded runtime spot checks
are distinguished below. No production update was performed.

## Decision

`player_skip=js` supports detailed per-video metadata without solving player
JavaScript challenges. Keep no-format errors enabled. Public videos may then be
falsely rejected when no usable format survives, so this needs representative
runtime testing. Adding `--ignore-no-formats-error` fails the rejection requirement.

The implemented candidate uses `player_skip=js;skip=hls,dash` only for video
metadata and retains the original full extraction as one compatibility fallback
when the **final** extractor error reports no usable format. Private/source,
network and deadline errors do not select that fallback. The shared extractor
pool gives this JS-free path a lighter admission weight; full extraction keeps
its original weight and playback priority. This does not change the result
limit, trust flat-playlist metadata, or extend request deadlines.

## Supported experimental command

```sh
yt-dlp --no-playlist --dump-single-json --skip-download --js-runtimes node \
  --extractor-args "youtube:player_skip=js" \
  --no-ignore-no-formats-error \
  "https://www.youtube.com/watch?v=VIDEO_ID"
```

The [release README](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/README.md#extractor-arguments)
documents `player_skip=js`, manifest skips, and warns that skipping requests can
lose metadata or formats. The optional argument
`"youtube:player_skip=js;skip=hls,dash"` also avoids manifest extraction but
removes potential JS-independent fallback formats. Keep webpage, configs and
initial data enabled. `--flat-playlist` leaves entry metadata incomplete and
does not replace video hydration.

The [simulation options](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/README.md#verbosity-and-simulation-options)
describe no-format tolerance as experimental, including for unavailable videos.
`--skip-download` alone does not bypass extraction. JSON dumping simulates by
default.

## Metadata and stream boundary

In [`YoutubeIE`](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/extractor/youtube/_video.py),
`_extract_player_responses` clears the player URL for `player_skip=js`.
`_extract_formats_and_subtitles` skips signature/n-challenged HTTPS formats and
manifests with unsolved n challenges. Remaining formats still undergo processing.
Keep `--js-runtimes node` for unchanged runtime-dependent default client selection.

`_real_extract` still derives title/duration from video details and microformats,
categories from microformats, tags from keywords, uploader from channel data,
and artists from description/initial data. `_list_formats` derives live status
from response fields. `playable_in_embed` comes from
`playabilityStatus.playableInEmbed`, not format availability. These fields remain
optional; unknown embedding permission must not become `true`. This flag is
YouTube's declaration, not an actual browser playback test.

[`YoutubeDL._fill_common_fields`](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/YoutubeDL.py)
derives `is_live` from `live_status` and joins multivalue artist fields into the
legacy singular field.

**Use these options only for metadata.** Applying them to stream extraction can
remove usable formats.

## Rejection semantics

`YoutubeIE._real_extract` passes a playability failure reason to
`raise_no_formats(..., expected=True)` when formats are absent. The shared
[`InfoExtractor.raise_no_formats`](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/extractor/common.py)
normally throws these errors. It turns them into warnings when
`ignore_no_formats_error` is enabled.
Its metadata-available login/geo error paths can also become warnings.
Consequently, exit code zero and JSON are insufficient evidence to reject all
private, deleted or age-restricted candidates correctly. Some failures can still
raise earlier; the flag does not promise consistent failure preservation.

Without the ignore flag, usable JS-independent formats permit normal metadata
processing while playability failures retain their exception path. Validate
public, inaccessible, age-restricted, embedding-disabled and missing-field cases
before adoption. Do not infer completeness from one successful public video.
The source review establishes no 30-result cold-search timing guarantee on a
1 GiB host.

## Bounded runtime spot checks

The candidate's no-login metadata path returned `playable_in_embed:false` for
the official `MeJVWBSsPAY` embedding-disabled fixture and rejected the official
`Tq92D6wQ1mg` age-restricted fixture with a non-format authentication failure.
These are current provider observations, not evidence that every restricted
video or real browser playback has been qualified.

On one isolated 1 GiB staging host, 30-candidate cold search took 56.69 seconds
before the change. The final path returned 30 results in 19.82 seconds during
one Discord stream, within the unchanged 25-second Core request deadline.
An idle run returned 29 results in 21.67 seconds; source failures remain
tolerated by the existing search contract. Comparing 28 shared video IDs against
the original full extraction found identical title, artist, duration, live,
embedding, genres, music, synthetic-content and catalog fields. These bounded
measurements do not guarantee all-query latency or multi-server capacity.
