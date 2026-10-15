import { radioArtist, radioGenre, radioTitle, songIdentity, radioQuery, rankRadio } from './radio.ts';
import type { RoomVideo } from './protocol.ts';

export type RoomRadioState = { current: RoomVideo | null; queue: RoomVideo[]; radio?: boolean; radioHistory?: RoomVideo[]; history?: RoomVideo[]; radioExcluded?: string[] };
export async function roomRecommendation(state: RoomRadioState, search: (query: string) => Promise<RoomVideo[]>): Promise<RoomVideo | null> {
  let seed = state.current ?? state.history?.at(-1) ?? state.radioHistory?.at(-1);
  if (state.radio === false || !seed || seed.live || state.queue.length) return null;
  const artist = radioArtist(seed);
  let genre = radioGenre(seed);
  // An untagged original may have a genre-tagged upload of the same recording.
  // Only use that label after matching both artist and song, never search rank alone.
  if (!genre && artist) {
    try {
      const metadata = await search(`${artist} "${radioTitle(seed).replace(/"/g, '')}"`);
      const tagged = metadata.find(candidate => radioGenre(candidate) &&
        radioArtist(candidate).toLocaleLowerCase() === artist.toLocaleLowerCase() &&
        songIdentity(candidate) === songIdentity(seed!));
      if (tagged) { genre = radioGenre(tagged); seed = { ...seed, title: tagged.title }; }
    } catch { /* retain conservative matching when metadata lookup is unavailable */ }
  }
  if (!artist && !genre) return null;
  const track = (video: RoomVideo) => ({ ...video, entryId: video.id, source: 'youtube' as const });
  // Search the explicit genre across artists. Keep the same relevance constraint
  // on the retry; never accept an unrelated result just to keep playing.
  const queries = [radioQuery(seed), `${genre ?? artist} music audio`];
  let failure: unknown;
  let succeeded = false;
  for (const query of queries) {
    try {
      const candidates = await search(query);
      succeeded = true;
      const next = rankRadio(track(seed), candidates.filter(video => video.embeddable).map(track), [...(state.radioHistory ?? []), ...(state.history ?? [])], state.radioExcluded ?? [])[0];
      if (next) return { id: next.id, title: next.title, artist: next.artist, image: next.image, duration: next.duration, live: next.live, embeddable: next.embeddable };
    } catch (error) { failure = error; }
  }
  if (!succeeded && failure) throw failure;
  return null;
}
export function roomRadioHistory(state: RoomRadioState) {
  return [...(state.radioHistory ?? []), ...(state.current ? [state.current] : [])].slice(-20);
}
