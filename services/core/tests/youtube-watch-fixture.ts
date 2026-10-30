// Reduced public structures observed on 30 October 2026. No tracking,
// playback URLs, account identifiers or free-form description are retained.
export function watchData(id: string, ai = false) {
  return {
    currentVideoEndpoint: { watchEndpoint: { videoId: id } },
    contents: { twoColumnWatchNextResults: { results: { results: { contents: [{
      videoPrimaryInfoRenderer: { title: { runs: [{ text: 'Fixture recording' }] },
        badges: ai ? [{ metadataBadgeRenderer: { icon: { iconType: 'INFO' },
          style: 'BADGE_STYLE_TYPE_SIMPLE', label: 'AI',
          accessibilityData: { label: 'AI: Content was made with AI' } } }] : [] },
    }] } } } },
  };
}
export function watchPage(id: string, ai = false) {
  return `<html lang="en"><script>var ytInitialData = ${JSON.stringify(watchData(id, ai))};</script></html>`;
}
