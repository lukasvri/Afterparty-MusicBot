import { rankRadio } from "../src/radio.ts";
import { roomRadioSeed, type RoomRadioState } from "../src/room-radio.ts";
import type { Track } from "../src/types.ts";

/** Previous queue selection, retained as an independent per-entry parity baseline. */
export function repeatedHistoryQueue(state: RoomRadioState, rank = rankRadio) {
  const seed = roomRadioSeed(state);
  const recent = [
    ...(state.radioHistory ?? []), ...(state.history ?? []),
    ...(state.radioExcludedSongs ?? []), ...(state.current ? [state.current] : []),
    ...state.queue.filter(video => !video.radio),
  ];
  return state.queue.filter(video => {
    if (!video.radio) return true;
    if (state.radio === false || !seed || !video.embeddable) return false;
    const valid = rank(
      { ...seed, entryId: seed.id }, [{ ...video, entryId: video.id }],
      recent, state.radioExcluded ?? [], video.radioRelatedTo === seed.id,
    ).length > 0;
    if (valid) recent.push(video);
    return valid;
  });
}

export const syntheticSong = (id: number, extra: Partial<Track> = {}): Track => ({
  id: `id${String(id).padStart(9, "0")}`, entryId: String(id),
  title: `Synthetic Artist ${id} - Song ${id} [Electro House]`,
  artist: "Synthetic Publisher", duration: 210, image: "", live: false,
  embeddable: true, radio: true, music: true, radioContentChecked: 1, ...extra,
});

export function syntheticRoom(automatic: number, manual: number, history: number): RoomRadioState {
  return {
    current: syntheticSong(0, { radio: false }), radio: true,
    history: Array.from({ length: history }, (_, index) => syntheticSong(index + 100)),
    queue: [
      ...Array.from({ length: manual }, (_, index) => syntheticSong(index + 300, { radio: false })),
      ...Array.from({ length: automatic }, (_, index) => syntheticSong(index + 1)),
    ],
  };
}
