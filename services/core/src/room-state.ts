import { UserError } from "./types.ts";
import type { RoomVideo } from "./protocol.ts";

/** Durable room state, shared by Core and the Worker fallback. Never publish vote identities. */
export type RoomPlayback = {
  current: RoomVideo | null;
  queue: RoomVideo[];
  playing: boolean;
  position: number;
  startsAt?: number;
  playbackKey?: string;
  radio?: boolean;
  radioHistory?: RoomVideo[];
  approvalRequired?: boolean;
  requests?: RoomVideo[];
  history?: RoomVideo[];
  votes?: Record<string, string[]>;
  skipVoters?: string[];
  undoQueue?: RoomVideo[];
  radioRetryAt?: number;
  radioExcluded?: string[];
};
export const guestActions = new Set(["add", "vote", "skip-vote"]);
export function publicPlayback(state: RoomPlayback) {
  return {
    current: state.current,
    queue: state.queue,
    playing: state.playing,
    position: state.position,
    startsAt: state.startsAt,
    playbackKey: state.playbackKey,
    radio: state.radio,
    approvalRequired: state.approvalRequired ?? false,
    requests: state.requests ?? [],
    history: state.history ?? [],
    voteCounts: Object.fromEntries(
      Object.entries(state.votes ?? {}).map(([id, voters]) => [
        id,
        voters.length,
      ]),
    ),
    skipVotes: state.skipVoters?.length ?? 0,
  };
}
export function finished(state: RoomPlayback, updatedAt: number, now: number) {
  return Boolean(
    state.playing &&
    state.current &&
    !state.current.live &&
    state.current.duration > 0 &&
    state.position +
      Math.max(0, now - Math.max(updatedAt, state.startsAt ?? updatedAt)) /
        1000 >=
      state.current.duration,
  );
}
export function prefetchDue(state:RoomPlayback,updatedAt:number,now:number){
 const remaining=(state.current?.duration??0)-state.position-Math.max(0,now-Math.max(updatedAt,state.startsAt??updatedAt))/1000;
 return Boolean(state.playing && state.current && !state.current.live && state.radio!==false && !state.queue.length && remaining>0 && now>=(state.radioRetryAt??0));
}
export function needsRecommendation(
  state: RoomPlayback,
  input: Record<string, unknown>,
) {
  const actor = String(input.participantHash ?? "");
  return (
    input.action === "next" || input.action === "radio-prefetch" ||
    (input.action === "radio" && input.enabled === true && !state.current) ||
    Boolean(
      input.action === "skip-vote" &&
      state.current &&
      /^[a-f0-9]{64}$/.test(actor) &&
      state.skipVoters?.length === 2 &&
      !state.skipVoters.includes(actor),
    )
  );
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
    throw new UserError("Bare verten eller medverten kan styre rommet.", 403);
  const state: RoomPlayback = structuredClone(previous);
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
      throw new UserError("Låten finnes ikke lenger i køen.", 409);
    return i;
  };
  const advance = () => {
    if (state.current)
      state.history = [...(state.history ?? []), state.current].slice(-100);
    state.radioHistory = [
      ...(state.radioHistory ?? []),
      ...(state.current ? [state.current] : []),
    ].slice(-20);
    state.current = state.queue.shift() ?? recommended;
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
      throw new UserError("Videoen kan ikke spilles her. Velg en annen.", 422);
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
      state.current = track;
      state.position = 0;
      state.playing = true;
      state.playbackKey = crypto.randomUUID();
      state.skipVoters = [];
    } else {
      if (state.queue.length + (state.requests?.length ?? 0) >= 50)
        throw new UserError("Køen har plass til 50 låter.");
      if (
        state.current?.id === track.id ||
        [...state.queue, ...(state.requests ?? [])].some(
          (v) => v.id === track.id,
        )
      )
        throw new UserError("Låten er allerede i rommet.", 409);
      if (state.approvalRequired && !host) (state.requests ??= []).push(track);
      else if (!state.current) {
        state.current = track;
        state.position = 0;
        state.playing = false;
        state.playbackKey = crypto.randomUUID();
      } else {
        state.queue = state.queue.filter(item => !item.radio);
        state.queue.push(track);
      }
    }
  } else if (action === "play" || action === "pause") {
    if (!state.current) throw new UserError("Legg til en låt først.");
    state.playing = action === "play";
  } else if (action === "seek") {
    if (
      !state.current ||
      state.current.live ||
      typeof input.position !== "number" ||
      !Number.isFinite(input.position)
    )
      throw new UserError("Denne videoen kan ikke spoles.");
    state.position = Math.max(
      0,
      Math.min(Math.max(0, state.current.duration - 1), input.position),
    );
  } else if (action === "radio-prefetch") {
    if (!state.queue.length && state.radio !== false && recommended) state.queue.push({ ...recommended, radio: true });
    state.radioRetryAt = Number(input.now ?? 0) + 15000;
  } else if (action === "next") advance();
  else if (action === "radio" || action === "approval") {
    if (typeof input.enabled !== "boolean")
      throw new UserError("Velg på eller av.");
    if (action === "radio") {
      state.radio = input.enabled;
      if (!input.enabled) state.queue = state.queue.filter(track => !track.radio);
      if (input.enabled && !state.current && recommended) advance();
    }
    else state.approvalRequired = input.enabled;
  } else if (action === "approve" || action === "reject") {
    const items = state.requests ?? [];
    const i = index(items);
    const [track] = items.splice(i, 1);
    if (action === "approve") {
      if (state.queue.length >= 50) throw new UserError("Køen er full.");
      if (!state.current) {
        state.current = track;
        state.position = 0;
        state.playing = false;
        state.playbackKey = crypto.randomUUID();
      } else {
        state.queue = state.queue.filter(item => !item.radio);
        state.queue.push(track);
      }
    }
  } else if (action === "remove" || action === "clear" || action === "move") {
    state.undoQueue = [...state.queue];
    if (action === "clear") {
      state.radioExcluded = [...(state.radioExcluded ?? []), ...state.queue.filter(track => track.radio).map(track => track.id)].slice(-50);
      state.queue = [];
    } else if (action === "remove") {
      const [removed] = state.queue.splice(index(state.queue), 1);
      if (removed.radio) state.radioExcluded = [...(state.radioExcluded ?? []), removed.id].slice(-50);
    }
    else {
      const from = index(state.queue),
        to = Number(input.to);
      if (!Number.isInteger(to) || to < 0 || to >= state.queue.length)
        throw new UserError("Ugyldig køplass.");
      state.queue.splice(to, 0, state.queue.splice(from, 1)[0]);
    }
  } else if (action === "undo") {
    if (!state.undoQueue) throw new UserError("Ingen køendring å angre.");
    const restored = state.undoQueue.filter((v) => v.id !== state.current?.id);
    const additions = state.queue.filter(
      (v) => !restored.some((saved) => saved.id === v.id),
    );
    if (restored.length + additions.length > 50)
      throw new UserError(
        "Køen er for full til å angre. Fjern noen låter først.",
      );
    state.queue = [...restored, ...additions];
    delete state.undoQueue;
    delete state.radioRetryAt;
  } else if (action === "vote" || action === "skip-vote") {
    const actor = String(input.participantHash ?? "");
    if (!/^[a-f0-9]{64}$/.test(actor))
      throw new UserError("Bli med i rommet før du stemmer.", 403);
    const voters =
      action === "vote"
        ? ((state.votes ??= {})[state.queue[index(state.queue)].id] ??= [])
        : (state.skipVoters ??= []);
    if (action === "skip-vote" && !state.current)
      throw new UserError("Ingen låt å hoppe over.");
    if (voters.includes(actor)) voters.splice(voters.indexOf(actor), 1);
    else {
      if (voters.length >= 128) throw new UserError("Stemmelisten er full.");
      voters.push(actor);
    }
    // One vote per browser participant. A host can always skip immediately.
    if (action === "skip-vote" && voters.length >= 3) advance();
  } else throw new UserError("Ukjent romhandling.");
  if (state.votes) {
    const retained = new Set(
      [...state.queue, ...(state.undoQueue ?? [])].map((v) => v.id),
    );
    for (const id of Object.keys(state.votes))
      if (!retained.has(id)) delete state.votes[id];
  }
  return state;
}
