import {
  createRadioRanker,
  RADIO_HISTORY_LIMIT,
} from "./radio.ts";
import type { RoomVideo } from "./protocol.ts";
import { selectRadio, type RadioDiagnostic } from "./radio-pipeline.ts";

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
export type RoomRadioDiagnostic = RadioDiagnostic;
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
/** One selection policy for complete queues and short-circuit existence checks. */
function* playableEntries(state: RoomRadioState): Generator<RoomVideo> {
  let ranker: ReturnType<typeof createRadioRanker> | undefined;
  let seedId: string | undefined;
  for (const [index, video] of state.queue.entries()) {
    if (!video.radio) { yield video; continue; }
    if (state.radio === false || !video.embeddable) continue;
    if (!ranker) {
      const seed = roomRadioSeed(state);
      if (!seed) continue;
      seedId = seed.id;
      const recent = [
        ...(state.radioHistory ?? []), ...(state.history ?? []),
        ...(state.radioExcludedSongs ?? []), ...(state.current ? [state.current] : []),
        ...state.queue.filter((track) => !track.radio),
      ];
      ranker = createRadioRanker(
        { ...seed, entryId: seed.id }, recent, state.radioExcluded ?? [],
      );
    }
    const valid = ranker.rank(
      [{ ...video, entryId: video.id }],
      video.radioRelatedTo === seedId,
    ).length > 0;
    if (valid) yield video;
    if (valid && index < state.queue.length - 1) ranker.remember(video);
  }
}
export function playableRoomQueue(state: RoomRadioState) {
  return Array.from(playableEntries(state));
}
export function hasPlayableRoomQueue(state: RoomRadioState) {
  return playableEntries(state).next().done === false;
}
export async function roomRecommendation(
  state: RoomRadioState,
  search: (query: string) => Promise<RoomVideo[]>,
  diagnose: (result: RoomRadioDiagnostic) => void = result => console.info("room-radio", JSON.stringify(result)),
): Promise<RoomVideo | null> {
  const seed = roomRadioSeed(state);
  if (state.radio === false || !seed || seed.live || seed.music === false || hasPlayableRoomQueue(state)) return null;
  const result = await selectRadio({
    seed: { ...seed, entryId: seed.id, source: "youtube" },
    recent: [...(state.radioHistory ?? []), ...(state.history ?? []),
      ...(state.radioExcludedSongs ?? []), ...(state.current ? [state.current] : [])],
    excluded: state.radioExcluded ?? [],
    requireEmbeddable: true,
    search: async query => (await search(query)).map(video => ({ ...video, entryId: video.id, source: "youtube" })),
    diagnose,
  });
  if (result.error) throw result.error;
  const next = result.track;
  return next ? {
    id: next.id, title: next.title, artist: next.artist, genres: next.genres,
    music: next.music, ...(next.aiGenerated === true ? { aiGenerated: true } : {}), radioRelatedTo: seed.id, image: next.image,
    duration: next.duration, live: next.live, embeddable: next.embeddable,
  } : null;
}
export function roomRadioHistory(state: RoomRadioState) {
  return [
    ...(state.radioHistory ?? []),
    ...(state.current ? [state.current] : []),
  ].slice(-RADIO_HISTORY_LIMIT);
}
