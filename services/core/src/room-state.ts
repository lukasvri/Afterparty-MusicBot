import { UserError } from "./types.ts";
import { ROOM_QUEUE_LIMIT, ROOM_START_LEAD_MS, ROOM_COMMAND_RECEIPT_LIMIT, validRoomCommandId, roomQueueCapacity, roomSeekPosition, type RoomVideo } from "./protocol.ts";
import { roomRadioSeed, playableRoomQueue, hasPlayableRoomQueue, roomRadioHistory } from "./room-radio.ts";
import { songIdentity, RADIO_HISTORY_LIMIT } from "./radio.ts";

/** Durable room state, shared by Core and the Worker fallback. Never publish vote identities. */
export type RoomPlayback = {
  current: RoomVideo | null;
  queue: RoomVideo[];
  playing: boolean;
  position: number;
  startsAt?: number;
  playbackKey?: string;
  radio?: boolean;
  radioSeed?: RoomVideo;
  radioHistory?: RoomVideo[];
  approvalRequired?: boolean;
  requests?: RoomVideo[];
  history?: RoomVideo[];
  votes?: Record<string, string[]>;
  skipVoters?: string[];
  undoQueue?: RoomVideo[];
  radioRetryAt?: number;
  radioExcluded?: string[];
  radioExcludedSongs?: RoomVideo[];
  /** Private bounded deduplication. Only the current revision's opaque receipt is public. */
  commandReceipts?: RoomCommandRecord[];
};
type RoomCommandRecord = { id: string; actor: string; request: string; version: number };
export function prepareRoomCommand(state: RoomPlayback, input: Record<string, unknown>, version: number, epoch?: string) {
  if (input.commandId === undefined) return null;
  if (!validRoomCommandId(input.commandId) || !["play", "pause", "seek"].includes(String(input.action)))
    throw new UserError("Invalid playback command ID.");
  if (input.syncEpoch !== epoch) throw new UserError("The room restarted. Refresh before trying again.", 409);
  const record = { id: input.commandId, actor: String(input.actorHash ?? ""),
    request: JSON.stringify([input.action, input.version, input.position ?? null, epoch ?? null]), version: version + 1 };
  const previous = state.commandReceipts?.find(item => item.id === record.id && item.actor === record.actor);
  if (previous && previous.request !== record.request) throw new UserError("The command ID was already used.", 409);
  return { record, duplicate: Boolean(previous) };
}
export function recordRoomCommand(state: RoomPlayback, command: ReturnType<typeof prepareRoomCommand>) {
  if (command) state.commandReceipts = [...(state.commandReceipts ?? []), command.record].slice(-ROOM_COMMAND_RECEIPT_LIMIT);
}
export function roomCommandReceipt(state: RoomPlayback, version: number) {
  const receipt = state.commandReceipts?.at(-1);
  return receipt?.version === version ? { commandReceipt: { id: receipt.id, version } } : {};
}
export const guestActions = new Set(["add", "vote", "skip-vote"]);
function publicVideo(video: RoomVideo): RoomVideo {
  if (video.radioRelatedTo === undefined) return video;
  const visible = { ...video };
  delete visible.radioRelatedTo;
  return visible;
}
export function publicPlayback(state: RoomPlayback) {
  return {
    current: state.current ? publicVideo(state.current) : null,
    queue: playableRoomQueue(state).map(publicVideo),
    playing: state.playing,
    position: state.position,
    startsAt: state.startsAt,
    playbackKey: state.playbackKey,
    radio: state.radio,
    approvalRequired: state.approvalRequired ?? false,
    requests: (state.requests ?? []).map(publicVideo),
    history: (state.history ?? []).map(publicVideo),
    voteCounts: Object.fromEntries(
      Object.entries(state.votes ?? {}).map(([id, voters]) => [
        id,
        voters.length,
      ]),
    ),
    skipVotes: state.skipVoters?.length ?? 0,
  };
}
/** One room clock for Core and the Worker, including an agreed future start. */
export function roomPlaybackPosition(state: RoomPlayback, updatedAt: number, now: number) {
  return state.position + (state.playing
    ? Math.max(0, now - Math.max(updatedAt, state.startsAt ?? updatedAt)) / 1000
    : 0);
}
export function finished(state: RoomPlayback, updatedAt: number, now: number) {
  return Boolean(
    state.playing &&
    state.current &&
    !state.current.live &&
    state.current.duration > 0 &&
    roomPlaybackPosition(state, updatedAt, now) >=
      state.current.duration,
  );
}
export function prefetchDue(state:RoomPlayback,updatedAt:number,now:number){
 const remaining=(state.current?.duration??0)-roomPlaybackPosition(state,updatedAt,now);
 return Boolean(state.playing && state.current && !state.current.live && state.radio!==false && remaining>0 && now>=(state.radioRetryAt??0) && !hasPlayableRoomQueue(state));
}
export function needsRecommendation(
  state: RoomPlayback,
  input: Record<string, unknown>,
) {
  // A queued track already wins over radio. Avoid allocating a shared lookup
  // and yielding the revision to concurrent commands when no search is needed.
  const enabling = input.action === "radio" && input.enabled === true;
  if (state.radio === false && !enabling) return false;
  const actor = String(input.participantHash ?? "");
  const eligible = (
    input.action === "next" || input.action === "radio-prefetch" ||
    (input.action === "radio" && input.enabled === true) ||
    Boolean(
      input.action === "skip-vote" &&
      state.current &&
      /^[a-f0-9]{64}$/.test(actor) &&
      state.skipVoters?.length === 2 &&
      !state.skipVoters.includes(actor),
    )
  );
  return eligible && !hasPlayableRoomQueue(state);
}
export function changeRoom(
  previous: RoomPlayback,
  input: Record<string, unknown>,
  host: boolean,
  position: number,
  recommended: RoomVideo | null = null,
): RoomPlayback {
  const action = String(input.action);
  if (!host && !guestActions.has(action))
    throw new UserError("Only the host or co-host can control the room.", 403);
  const state: RoomPlayback = structuredClone(previous);
  // Upgrade older rooms lazily. Automatic recommendations retain this anchor;
  // only an explicitly selected track that becomes current replaces it.
  const original = roomRadioSeed(state);
  if (original) state.radioSeed = structuredClone(original);
  state.queue = playableRoomQueue(state);
  state.position = position;
  const video = input.video as RoomVideo | undefined;
  const valid = (v: RoomVideo | undefined): v is RoomVideo =>
    Boolean(
      v &&
      /^[\w-]{11}$/.test(v.id) &&
      v.embeddable === true &&
      typeof v.title === "string" &&
      typeof v.artist === "string" &&
      typeof v.image === "string" &&
      typeof v.live === "boolean" &&
      Number.isFinite(v.duration) &&
      v.duration >= 0,
    );
  const index = (items: RoomVideo[]) => {
    const i = input.videoId
      ? items.findIndex((v) => v.id === input.videoId)
      : Number(input.index);
    if (!Number.isInteger(i) || i < 0 || i >= items.length)
      throw new UserError("This song is no longer in the queue.", 409);
    return i;
  };
  const advance = () => {
    if (state.current)
      state.history = [...(state.history ?? []), state.current].slice(-100);
    state.radioHistory = roomRadioHistory(state);
    state.current = state.queue.shift() ?? recommended;
    if (state.current && !state.current.radio && state.current !== recommended)
      state.radioSeed = structuredClone(state.current);
    if (state.current === recommended && recommended)
      state.current = { ...recommended, radio: true };
    state.position = 0;
    state.playing = Boolean(state.current);
    state.playbackKey = crypto.randomUUID();
    state.skipVoters = [];
    delete state.undoQueue;
    delete state.radioRetryAt;
    if (state.current && state.votes) delete state.votes[state.current.id];
  };
  if (action === "add" || action === "play-video") {
    if (!valid(video))
      throw new UserError("This video cannot be played here. Choose another one.", 422);
    const track = {
      ...video,
      radio: false,
      requestedBy:
        String(input.displayName ?? "Gjest")
          .trim()
          .slice(0, 32) || "Gjest",
    };
    if (action === "play-video") {
      if (state.current)
        state.history = [...(state.history ?? []), state.current].slice(-100);
      // A direct selection consumes that entry and invalidates suggestions
      // prepared for the old seed, while retaining other manual requests.
      state.queue = state.queue.filter(item => item.id !== track.id && !item.radio);
      state.requests = state.requests?.filter(item => item.id !== track.id);
      delete state.undoQueue;
      delete state.radioRetryAt;
      state.current = track;
      state.radioSeed = structuredClone(track);
      state.position = 0;
      state.playing = true;
      state.playbackKey = crypto.randomUUID();
      state.skipVoters = [];
    } else {
      if (!roomQueueCapacity(state.queue.length, state.requests?.length))
        throw new UserError(`The queue holds up to ${ROOM_QUEUE_LIMIT} songs.`);
      if (
        state.current?.id === track.id ||
        [...state.queue, ...(state.requests ?? [])].some(
          (v) => v.id === track.id,
        )
      )
        throw new UserError("This song is already in the room.", 409);
      if (state.approvalRequired && !host) (state.requests ??= []).push(track);
      else if (!state.current) {
        state.current = track;
        state.radioSeed = structuredClone(track);
        state.position = 0;
        state.playing = true;
        state.playbackKey = crypto.randomUUID();
      } else {
        state.queue.push(track);
      }
    }
  } else if (action === "play" || action === "pause") {
    if (!state.current) throw new UserError("Add a song first.");
    state.playing = action === "play";
  } else if (action === "seek") {
    if (
      !state.current ||
      state.current.live ||
      state.current.duration <= 0 ||
      typeof input.position !== "number" ||
      !Number.isFinite(input.position)
    )
      throw new UserError("This video does not support seeking.");
    state.position = roomSeekPosition(input.position, state.current.duration);
  } else if (action === "radio-prefetch") {
    if (!state.queue.length && state.radio !== false && recommended) state.queue.push({ ...recommended, radio: true });
    state.radioRetryAt = Number(input.now ?? 0) + 15000;
  } else if (action === "next") advance();
  else if (action === "radio" || action === "approval") {
    if (typeof input.enabled !== "boolean")
      throw new UserError("Choose on or off.");
    if (action === "radio") {
      state.radio = input.enabled;
      if (!input.enabled) state.queue = state.queue.filter(track => !track.radio);
      if (input.enabled) {
        if (!state.current && recommended) advance();
        else if (!state.queue.length) {
          if (recommended) state.queue.push({ ...recommended, radio: true });
          state.radioRetryAt = Number(input.now ?? 0) + 15000;
        }
      }
    }
    else state.approvalRequired = input.enabled;
  } else if (action === "approve" || action === "reject") {
    const items = state.requests ?? [];
    const i = index(items);
    const [track] = items.splice(i, 1);
    if (action === "approve") {
      if (!roomQueueCapacity(state.queue.length)) throw new UserError("The queue is full.");
      if (!state.current) {
        state.current = track;
        state.radioSeed = structuredClone(track);
        state.position = 0;
        state.playing = true;
        state.playbackKey = crypto.randomUUID();
      } else {
        state.queue.push(track);
      }
    }
  } else if (action === "remove" || action === "clear" || action === "move") {
    state.undoQueue = [...state.queue];
    const excludeRadio = (videos: RoomVideo[]) => {
      const rejected = videos.filter((track) => track.radio);
      if (!rejected.length) return;
      state.radioExcluded = [...(state.radioExcluded ?? []), ...rejected.map((track) => track.id)].slice(-RADIO_HISTORY_LIMIT);
      state.radioExcludedSongs = [...(state.radioExcludedSongs ?? []), ...rejected].slice(-RADIO_HISTORY_LIMIT);
    };
    if (action === "clear") {
      excludeRadio(state.queue);
      state.queue = [];
    } else if (action === "remove") {
      const [removed] = state.queue.splice(index(state.queue), 1);
      excludeRadio([removed]);
    }
    else {
      const from = index(state.queue),
        to = Number(input.to);
      if (!Number.isInteger(to) || to < 0 || to >= state.queue.length)
        throw new UserError("Invalid queue position.");
      state.queue.splice(to, 0, state.queue.splice(from, 1)[0]);
    }
  } else if (action === "undo") {
    if (!state.undoQueue) throw new UserError("There is no queue change to undo.");
    // A manual re-add is the current explicit choice. Keep its metadata and
    // manual status at the restored slot instead of resurrecting its radio copy.
    const restored = state.undoQueue.map((saved) =>
      state.queue.find((queued) => queued.id === saved.id && !queued.radio) ?? saved,
    ).filter((v) => v.id !== state.current?.id && (state.radio !== false || !v.radio));
    const additions = state.queue.filter(
      (v) => !restored.some((saved) => saved.id === v.id),
    );
    if (restored.length + additions.length + (state.requests?.length ?? 0) > ROOM_QUEUE_LIMIT)
      throw new UserError(
        "The queue is too full to undo. Remove some songs first.",
      );
    const restoredSuggestions = restored.filter(
      (track) => track.radio && !state.queue.some((queued) => queued.id === track.id),
    );
    state.queue = [...restored, ...additions];
    // Undo is an explicit request to restore these suggestions. It lifts only
    // their removal exclusions; current/history validation still applies.
    const restoredIds = new Set(restoredSuggestions.map((track) => track.id));
    const restoredSongs = new Set(restoredSuggestions.map(songIdentity));
    state.radioExcluded = state.radioExcluded?.filter((id) => !restoredIds.has(id));
    state.radioExcludedSongs = state.radioExcludedSongs?.filter((track) => !restoredSongs.has(songIdentity(track)));
    state.queue = playableRoomQueue(state);
    delete state.undoQueue;
    delete state.radioRetryAt;
  } else if (action === "vote" || action === "skip-vote") {
    const actor = String(input.participantHash ?? "");
    if (!/^[a-f0-9]{64}$/.test(actor))
      throw new UserError("Join the room before voting.", 403);
    const voters =
      action === "vote"
        ? ((state.votes ??= {})[state.queue[index(state.queue)].id] ??= [])
        : (state.skipVoters ??= []);
    if (action === "skip-vote" && !state.current)
      throw new UserError("There is no song to skip.");
    if (voters.includes(actor)) voters.splice(voters.indexOf(actor), 1);
    else {
      if (voters.length >= 128) throw new UserError("The voter list is full.");
      voters.push(actor);
    }
    // One vote per browser participant. A host can always skip immediately.
    if (action === "skip-vote" && voters.length >= 3) advance();
  } else throw new UserError("Unknown room action.");
  if (state.votes) {
    const retained = new Set(
      [...state.queue, ...(state.undoQueue ?? [])].map((v) => v.id),
    );
    for (const id of Object.keys(state.votes))
      if (!retained.has(id)) delete state.votes[id];
  }
  if (!state.playing) delete state.startsAt;
  else if (typeof input.now === 'number' && Number.isFinite(input.now) &&
    (state.playbackKey !== previous.playbackKey || !previous.playing || action === 'seek'))
    // A native scrub is already in progress. Re-anchor its clock immediately;
    // reserving another start barrier would pause every device for 1.5 seconds.
    state.startsAt = action === 'seek' && previous.playing ? input.now : input.now + ROOM_START_LEAD_MS;
  return state;
}
