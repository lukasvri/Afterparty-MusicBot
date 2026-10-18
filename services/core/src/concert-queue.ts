import type { Engine } from "./engine.ts";
import { publicTrack, UserError, type Track } from "./types.ts";
type Saved = {
  approvalRequired: boolean;
  requests: Track[];
  undo?: Track[];
  undoKey?: string;
  undoBefore?: Record<string, string>;
  votes: Record<string, string[]>;
  revision: number;
  skipKey?: string;
  skipVoters: string[];
};
const empty = (): Saved => ({
  approvalRequired: false,
  requests: [],
  votes: {},
  revision: 0,
  skipVoters: [],
});
export class ConcertQueue {
  readonly engine: Engine;
  constructor(engine: Engine) {
    this.engine = engine;
  }
  read() {
    return this.engine.store.get<Saved>("concert-queue", empty());
  }
  save(s: Saved) {
    s.revision++;
    this.engine.store.set("concert-queue", s);
    this.engine.changed();
  }
  revision() {
    return this.engine.revision() + ":" + this.read().revision;
  }
  snapshot() {
    const e = this.engine,
      s = this.read(),
      state = e.websiteSnapshot();
    let wait =
      e.current && !e.current.live
        ? Math.max(0, e.current.duration - e.snapshot().position)
        : null;
    const queue = e.queue
      .filter((t) => t.entryId !== e.current?.entryId)
      .map((t) => {
        const v = {
          ...publicTrack(t)!,
          entryId: t.entryId,
          radio: t.radio,
          waitSeconds: wait,
        };
        wait = wait === null || t.live ? null : wait + t.duration;
        return v;
      })
      .filter((t) => t.concert);
    return {
      ...state,
      queue,
      revision: this.revision(),
      approvalRequired: s.approvalRequired,
      requests: s.requests.map((t) => ({
        ...publicTrack(t)!,
        entryId: t.entryId,
      })),
      voteCounts: Object.fromEntries(
        queue.map((t) => [t.entryId, s.votes[t.entryId]?.length ?? 0]),
      ),
      skipVotes: s.skipKey === state.playbackKey ? s.skipVoters.length : 0,
    };
  }
  request(tracks: Track[]) {
    const e = this.engine,
      s = this.read();
    if (!s.approvalRequired) return false;
    const known = new Set([
      e.current?.concert ? e.current.id : undefined,
      ...e.queue.filter((t) => t.concert).map((t) => t.id),
      ...s.requests.map((t) => t.id),
    ]);
    const fresh = tracks.filter((t) => {
      if (known.has(t.id)) return false;
      known.add(t.id);
      return true;
    });
    if (!fresh.length)
      throw new UserError("This song is already in the room.", 409);
    if (
      s.requests.length + e.queue.length + fresh.length >
      e.settings.playlistLimit
    )
      throw new UserError("The queue is full.");
    s.requests.push(...fresh);
    this.save(s);
    return true;
  }
  async apply(input: Record<string, unknown>, admin: boolean) {
    const e = this.engine,
      action = String(input.action),
      s = this.read();
    if (!admin && !["vote", "skip-vote"].includes(action))
      throw new UserError("Discord administrator access is required.", 403);
    if (input.revision !== this.revision())
      throw new UserError("The queue has changed. Refresh and try again.", 409);
    const entry = String(input.videoId ?? "");
    const visible = e.queue.filter(
      (t) => t.concert && t.entryId !== e.current?.entryId,
    );
    const find = () => {
      const t = visible.find((t) => t.entryId === entry);
      if (!t) throw new UserError("This song is not in the concert queue.", 409);
      return t;
    };
    if (action === "approval") {
      if (typeof input.enabled !== "boolean")
        throw new UserError("Choose on or off.");
      s.approvalRequired = input.enabled;
    } else if (action === "approve" || action === "reject") {
      const i = s.requests.findIndex((t) => t.entryId === entry);
      if (i < 0) throw new UserError("This request is no longer available.", 409);
      if (action === "approve") e.enqueue([s.requests[i]]);
      s.requests.splice(i, 1);
    } else if (action === "clear" || action === "remove" || action === "move") {
      if (e.mixer?.fadeFrame)
        throw new UserError("Wait for the transition to finish.", 409);
      s.undo = visible;
      s.undoKey = e.current?.entryId;
      s.undoBefore = Object.fromEntries(
        visible.map((t) => [
          t.entryId,
          e.queue.slice(e.queue.indexOf(t) + 1).find((v) => !v.concert)
            ?.entryId ?? "",
        ]),
      );
      if (action === "clear") {
        e.rejectRadio(visible);
        e.queue = e.queue.filter((t) => !t.concert);
      }
      else if (action === "remove") {
        const t = find();
        e.rejectRadio([t]);
        e.queue = e.queue.filter((v) => v.entryId !== t.entryId);
      } else {
        const t = find(),
          to = Number(input.to);
        if (!Number.isInteger(to) || to < 0 || to >= visible.length)
          throw new UserError("Invalid queue position.");
        const reordered = [...visible];
        reordered.splice(reordered.indexOf(t), 1);
        reordered.splice(to, 0, t);
        let i = 0;
        e.queue = e.queue.map((v) =>
          visible.includes(v) ? reordered[i++] : v,
        );
      }
    } else if (action === "undo") {
      if (e.mixer?.fadeFrame || s.undoKey !== e.current?.entryId)
        throw new UserError("Playback has changed.", 409);
      if (!s.undo) throw new UserError("There is no queue change to undo.");
      const old = s.undo.filter(
        (t) =>
          t.entryId !== e.current?.entryId && (!t.radio || e.settings.radio),
      );
      const additions = visible.filter(
        (t) => !old.some((v) => v.entryId === t.entryId),
      );
      const desired = [...old, ...additions];
      if (
        e.queue.filter((t) => !t.concert).length + desired.length + s.requests.length >
        e.settings.playlistLimit
      )
        throw new UserError("The queue is full.");
      const remaining = new Set(old.map((t) => t.entryId));
      const restored: Track[] = [];
      for (const privateTrack of e.queue.filter((t) => !t.concert)) {
        for (const t of old)
          if (
            remaining.has(t.entryId) &&
            s.undoBefore?.[t.entryId] === privateTrack.entryId
          ) {
            restored.push(t);
            remaining.delete(t.entryId);
          }
        restored.push(privateTrack);
      }
      restored.push(
        ...old.filter((t) => remaining.has(t.entryId)),
        ...additions,
      );
      // Only entries brought back by this undo lift their removal exclusions.
      // Reordering an existing entry must not erase an unrelated rejection.
      e.restoreRadio(old.filter((track) =>
        !visible.some((current) => current.entryId === track.entryId),
      ));
      e.queue = restored;
      delete s.undo;
      delete s.undoBefore;
    } else if (action === "vote" || action === "skip-vote") {
      const actor = String(input.participantHash ?? "");
      if (!/^[a-f0-9]{64}$/.test(actor))
        throw new UserError("Join before voting.", 403);
      if (action === "skip-vote") {
        if (
          !e.current?.concert ||
          input.playbackKey !== "core:" + e.current.entryId
        )
          throw new UserError("The concert has changed.", 409);
        if (s.skipKey !== input.playbackKey) {
          s.skipKey = String(input.playbackKey);
          s.skipVoters = [];
        }
      }
      const voters =
        action === "vote" ? (s.votes[find().entryId] ??= []) : s.skipVoters;
      const i = voters.indexOf(actor);
      if (i >= 0) voters.splice(i, 1);
      else {
        if (voters.length >= 128) throw new UserError("The voter list is full.");
        voters.push(actor);
      }
      if (action === "skip-vote" && voters.length >= 3) {
        s.skipVoters = [];
        delete s.undo;
        this.save(s);
        await e.skip();
        return this.snapshot();
      }
    } else throw new UserError("Unknown queue action.");
    const ids = new Set([...e.queue, ...(s.undo ?? [])].map((t) => t.entryId));
    s.votes = Object.fromEntries(
      Object.entries(s.votes).filter(([id]) => ids.has(id)),
    );
    if (["clear", "remove", "move", "undo"].includes(action)) {
      e.mixer?.invalidateNext();
      e.persist();
    }
    this.save(s);
    return this.snapshot();
  }
}
