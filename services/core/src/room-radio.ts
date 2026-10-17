import {
  radioArtist,
  radioStyleCompatible,
  radioTitle,
  radioQuery,
  rankRadio,
  createRadioRanker,
  isRadioMusic,
  specificRadioGenre,
  sameRadioRecording,
  RADIO_HISTORY_LIMIT,
  radioGenre,
} from "./radio.ts";
import type { RoomVideo } from "./protocol.ts";

export type RoomRadioState = {
  current: RoomVideo | null;
  queue: RoomVideo[];
  radio?: boolean;
  radioSeed?: RoomVideo;
  radioHistory?: RoomVideo[];
  history?: RoomVideo[];
  radioExcluded?: string[];
  radioExcludedSongs?: RoomVideo[];
};
export type RoomRadioDiagnostic = {
  outcome: "selected" | "empty" | "filtered" | "provider-error" | "insufficient-metadata";
  seedGenre: string | null;
  artistKnown: boolean;
  metadata: "unchanged" | "refined" | "unavailable";
  searches: number;
  failedSearches: number;
  candidates: number;
};
export function roomRadioSeed(state: RoomRadioState) {
  if (state.current?.radio === false) return state.current;
  return (
    state.radioSeed ??
    state.history?.findLast((video) => video.radio === false) ??
    state.radioHistory?.findLast((video) => video.radio === false) ??
    state.current ??
    state.history?.at(-1) ??
    state.radioHistory?.at(-1)
  );
}
export function playableRoomQueue(state: RoomRadioState) {
  const seed = roomRadioSeed(state);
  const recent = [
    ...(state.radioHistory ?? []),
    ...(state.history ?? []),
    ...(state.radioExcludedSongs ?? []),
    ...(state.current ? [state.current] : []),
    ...state.queue.filter((video) => !video.radio),
  ];
  let ranker: ReturnType<typeof createRadioRanker> | undefined;
  return state.queue.filter((video, index) => {
    if (!video.radio) return true;
    if (state.radio === false || !seed || !video.embeddable) return false;
    ranker ??= createRadioRanker(
      { ...seed, entryId: seed.id }, recent, state.radioExcluded ?? [],
    );
    const valid = ranker.rank(
      [{ ...video, entryId: video.id }],
      video.radioRelatedTo === seed.id,
    ).length > 0;
    if (valid && index < state.queue.length - 1) ranker.remember(video);
    return valid;
  });
}
export async function roomRecommendation(
  state: RoomRadioState,
  search: (query: string) => Promise<RoomVideo[]>,
  diagnose: (result: RoomRadioDiagnostic) => void = (result) =>
    console.info("room-radio", JSON.stringify(result)),
): Promise<RoomVideo | null> {
  let seed = roomRadioSeed(state);
  if (
    state.radio === false ||
    !seed ||
    seed.live ||
    seed.music === false ||
    playableRoomQueue(state).length
  )
    return null;
  const artist = radioArtist(seed);
  let metadata: RoomRadioDiagnostic["metadata"] = "unchanged";
  // Missing or broad metadata can be refined by a specific label on an upload
  // of the same recording. A broad label alone never admits another artist.
  // Only use that label after matching both artist and song, never search rank alone.
  if (!specificRadioGenre(seed) && artist) {
    try {
      const metadataCandidates = await search(
        `${artist} "${radioTitle(seed).replace(/"/g, "")}"`,
      );
      const tagged = metadataCandidates.find(
        (candidate) =>
          isRadioMusic(candidate) &&
          candidate.embeddable &&
          specificRadioGenre(candidate) &&
          radioStyleCompatible(seed!, candidate) &&
          sameRadioRecording(seed!, candidate),
      );
      if (tagged) {
        seed = { ...seed, title: tagged.title, genres: tagged.genres };
        metadata = "refined";
      }
    } catch {
      metadata = "unavailable";
      /* retain conservative matching when metadata lookup is unavailable */
    }
  }
  if (!artist && !specificRadioGenre(seed)) {
    diagnose({ outcome: "insufficient-metadata", seedGenre: radioGenre(seed), artistKnown: false,
      metadata, searches: 0, failedSearches: 0, candidates: 0 });
    return null;
  }
  const track = (video: RoomVideo) => ({
    ...video,
    entryId: video.id,
    source: "youtube" as const,
  });
  // Try genre discovery first, then the original artist if known. Repeating
  // the same genre-only search cannot recover a sparse genre result. Both
  // paths still enforce the same content, history and relevance constraints.
  const queries = [
    radioQuery(seed),
    `${artist || specificRadioGenre(seed)} music audio`,
  ];
  let failure: unknown;
  let succeeded = false;
  let searches = 0, failedSearches = 0, candidatesSeen = 0;
  const report = (outcome: RoomRadioDiagnostic["outcome"]) => diagnose({
    outcome, seedGenre: radioGenre(seed!), artistKnown: Boolean(artist), metadata,
    searches, failedSearches, candidates: candidatesSeen,
  });
  for (const query of queries) {
    searches++;
    try {
      const candidates = await search(query);
      succeeded = true;
      candidatesSeen += candidates.length;
      const next = rankRadio(
        track(seed),
        candidates.filter((video) => video.embeddable).map(track),
        [
          ...(state.radioHistory ?? []),
          ...(state.history ?? []),
          ...(state.radioExcludedSongs ?? []),
          ...(state.current ? [state.current] : []),
        ],
        state.radioExcluded ?? [],
      )[0];
      if (next) {
        report("selected");
        return {
          id: next.id,
          title: next.title,
          artist: next.artist,
          genres: next.genres,
          music: next.music,
          radioRelatedTo: seed.id,
          image: next.image,
          duration: next.duration,
          live: next.live,
          embeddable: next.embeddable,
        };
      }
    } catch (error) {
      failure = error;
      failedSearches++;
    }
  }
  if (!succeeded && failure) {
    report("provider-error");
    throw failure;
  }
  report(candidatesSeen ? "filtered" : "empty");
  return null;
}
export function roomRadioHistory(state: RoomRadioState) {
  return [
    ...(state.radioHistory ?? []),
    ...(state.current ? [state.current] : []),
  ].slice(-RADIO_HISTORY_LIMIT);
}
