import { createHash, randomUUID } from 'node:crypto';
import { UserError } from './types.ts';
import { UnavailableGuessCatalog, copyGuessMedia, copyGuessSong, normalizeGuess,
  type GuessCatalog, type GuessCategorySummary, type GuessMediaDescriptor, type GuessSong } from './guess-catalog.ts';

/** Trusted handler authority, not request fields or Discord/display identities. */
export type GuessAccess = { scope: 'room' | 'guild'; scopeId: string; host: boolean; actor: string };
export type GuessSettings = { durationSeconds: number; roundCount: number; maxPoints: number; minPoints: number; hints: boolean; answerMode?: 'title' | 'artist' };
export const DEFAULT_GUESS_SETTINGS: Readonly<GuessSettings> = Object.freeze({ durationSeconds: 30, roundCount: 5, maxPoints: 1000, minPoints: 100, hints: true, answerMode: 'title' });
export type GuessFeedback = { correct: boolean; awarded: number };
export type GuessPublicState = {
  scope: GuessAccess['scope']; scopeId: string; sessionId: string; gameId: string; revision: number;
  phase: 'lobby' | 'round' | 'reveal' | 'results'; serverTime: number; categoryId: string;
  settings: GuessSettings; categories: GuessCategorySummary[]; roundNumber: number;
  scoreboard: { id: string; nickname: string; total: number; hasAnswered: boolean }[]; answeredCount: number;
  round: null | { roundId: string; startsAt: number; deadline: number;
    hints: { artistInitial?: string; titleWordCount?: number; artistWordCount?: number };
    skipVotes?: number; skipRequired?: number; answer?: { title: string; artist: string } };
};
export type GuessResult = { game: GuessPublicState; self: { participantId: string; result: GuessFeedback | null; skipVoted?: boolean } };
type Participant = { id: string; nickname: string; total: number; lastResult: GuessFeedback | null;
  rate: { until: number; count: number }; guesses: Set<string> };
type Round = { id: string; startRevision: number; song: GuessSong; startsAt: number; deadline: number;
  settings: Readonly<GuessSettings>; awards: Map<string, number>; skipVotes: Set<string> };
type State = {
  scope: GuessAccess['scope']; scopeId: string; sessionId: string; gameId: string; revision: number;
  phase: GuessPublicState['phase']; expires: number; categoryId: string; settings: Readonly<GuessSettings>;
  activeSettings: Readonly<GuessSettings> | null; roundNumber: number; round: Round | null; songs: GuessSong[];
  participants: Map<string, Participant>; guestReceipts: Set<string>; hostReceipts: Set<string>; moderationReceipts: Set<string>; joinReceipts: Set<string>;
};
const TTL = 30 * 60_000;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hostActions = new Set(['configure', 'start', 'next', 'reveal', 'end', 'reset']);
const commonFields = ['action', 'sessionId', 'roundId', 'revision', 'eventId'];
const extras: Record<string, string[]> = { join: ['nickname'], read: [], configure: ['settings', 'categoryId'],
  start: [], next: [], reveal: [], end: [], reset: [], guess: ['text'], skip: [] };

/**
 * Synchronous, ephemeral competitive authority with no playback or persistence.
 * apply(verifiedAccess,input) -> {game,self}. Only game may be broadcast; self is
 * private feedback for the requesting anonymous participant. join needs eventId
 * and optional nickname, bootstraps a lobby or recovers the same actor/public ID.
 * read requires an existing joined actor. Every other action requires current
 * sessionId/roundId (null in lobby) and UUID eventId. Host actions require the
 * current revision; guesses and skip votes accept revisions from the same active
 * round, so another participant's answer or join cannot invalidate them.
 * configure takes a complete settings object and categoryId from catalog
 * summaries, in lobby only.
 * The handler strips grant/role fields and rechecks authority after any awaits.
 *
 * start atomically selects the full game from the trusted catalog. next advances
 * only from reveal, and enters results after the configured final round. reveal
 * and end never rescore. reset from results returns to lobby, preserves anonymous roster and
 * lobby settings, clears all scores, and rotates gameId. A scope idle for 30m or
 * process restart loses its session. Stale mutations cannot recreate it.
 * One skip vote per joined actor reveals on strict majority of the current roster;
 * disconnected actors remain in that roster, and the host may still reveal.
 *
 * media() is internal authenticated descriptor lookup, not a public endpoint or
 * URL. The default provider has no playable sources. A reviewed transport must
 * authorize again and never expose arbitrary client media keys or provider URLs.
 */
export class GuessGame {
  private states = new Map<string, State>();
  private budgets = new Map<string, { until: number; count: number }>();
  private catalog: GuessCatalog;
  private now: () => number;
  private id: () => string;
  constructor(options: { catalog?: GuessCatalog; now?: () => number; id?: () => string } = {}) {
    this.catalog = options.catalog ?? new UnavailableGuessCatalog(); this.now = options.now ?? Date.now; this.id = options.id ?? randomUUID;
  }
  private authorize(access: GuessAccess, action: unknown) {
    if (!access || !['room', 'guild'].includes(access.scope) || typeof access.scopeId !== 'string' ||
      !(access.scope === 'room' ? /^[A-Z0-9]{8}$/ : /^\d{14,22}$/).test(access.scopeId) ||
      typeof access.host !== 'boolean' || typeof access.actor !== 'string' || !access.actor.length || access.actor.length > 128 || CONTROL.test(access.actor))
      throw new UserError('Invalid game access.', 403);
    if (typeof action !== 'string' || !Object.hasOwn(extras, action)) throw new UserError('Unknown game action.');
    if (hostActions.has(action) && !access.host) throw new UserError('Host access required.', 403);
  }
  private budget(lane: string, key: string, global: number, scoped: number, now: number) {
    for (const [id, rate] of this.budgets) if (rate.until <= now) this.budgets.delete(id);
    const keys: [string, number][] = [[lane, global], [`${lane}:${key}`, scoped]];
    if (this.budgets.size + keys.filter(([id]) => !this.budgets.has(id)).length > 4096 ||
      keys.some(([id, max]) => (this.budgets.get(id)?.count ?? 0) >= max)) throw new UserError('Games are busy. Try again shortly.', 429);
    for (const [id] of keys) { const rate = this.budgets.get(id) ?? { until: now + 60_000, count: 0 }; rate.count++; this.budgets.set(id, rate); }
  }
  private collect(now: number) { for (const [key, state] of this.states) if (state.expires <= now) this.states.delete(key); }
  private reconcile(state: State, now: number) {
    if (state.phase === 'round' && state.round && now >= state.round.deadline) { state.phase = 'reveal'; state.revision++; }
  }
  private categories(): GuessCategorySummary[] {
    const list = this.catalog.categories();
    if (!Array.isArray(list) || list.length > 20) throw new UserError('The eligible song catalog is unavailable.', 503);
    const seen = new Set<string>();
    return list.map(category => {
      if (!category || typeof category.id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(category.id) || seen.has(category.id) ||
        typeof category.name !== 'string' || !category.name.trim() || category.name.length > 60 || CONTROL.test(category.name) ||
        typeof category.available !== 'boolean' || !Number.isInteger(category.count) || category.count < 0 || category.count > 1000 || category.available !== (category.count > 0))
        throw new UserError('The eligible song catalog is unavailable.', 503);
      let durations: GuessCategorySummary['durations'];
      if (category.durations !== undefined) {
        if (!Array.isArray(category.durations) || category.durations.length > 76)
          throw new UserError('The eligible song catalog is unavailable.', 503);
        durations = [];
        let previous = 14, total = 0;
        for (const bin of category.durations) {
          if (!bin || Array.isArray(bin) || !Number.isInteger(bin.seconds) || bin.seconds <= previous || bin.seconds > 90 ||
            !Number.isInteger(bin.count) || bin.count < 1 || bin.count > 1000)
            throw new UserError('The eligible song catalog is unavailable.', 503);
          durations.push({ seconds: bin.seconds, count: bin.count }); previous = bin.seconds; total += bin.count;
        }
        if (total !== category.count) throw new UserError('The eligible song catalog is unavailable.', 503);
      }
      seen.add(category.id); return { id: category.id, name: category.name, available: category.available, count: category.count,
        ...(durations === undefined ? {} : { durations }) };
    });
  }
  private settings(value: unknown): Readonly<GuessSettings> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UserError('Choose complete game settings.');
    const settings = value as Record<string, unknown>;
    if (Object.keys(settings).some(key => !Object.hasOwn(DEFAULT_GUESS_SETTINGS, key)) ||
      typeof settings.durationSeconds !== 'number' || !Number.isInteger(settings.durationSeconds) || settings.durationSeconds < 15 || settings.durationSeconds > 90 ||
      typeof settings.roundCount !== 'number' || !Number.isInteger(settings.roundCount) || settings.roundCount < 1 || settings.roundCount > 20 ||
      typeof settings.maxPoints !== 'number' || !Number.isInteger(settings.maxPoints) || settings.maxPoints < 100 || settings.maxPoints > 2000 ||
      typeof settings.minPoints !== 'number' || !Number.isInteger(settings.minPoints) || settings.minPoints < 0 || settings.minPoints > settings.maxPoints || typeof settings.hints !== 'boolean' ||
      (settings.answerMode !== undefined && settings.answerMode !== 'title' && settings.answerMode !== 'artist'))
      throw new UserError('Use valid duration, rounds, scoring and hint settings.');
    return Object.freeze({ durationSeconds: settings.durationSeconds, roundCount: settings.roundCount,
      maxPoints: settings.maxPoints, minPoints: settings.minPoints, hints: settings.hints, answerMode: settings.answerMode ?? 'title' });
  }
  private snapshot(state: State, actor: string, now: number, categories: GuessCategorySummary[]): GuessResult {
    const round = state.round, participant = state.participants.get(actor)!;
    const hints: { artistInitial?: string; titleWordCount?: number; artistWordCount?: number } = {};
    if (state.phase === 'round' && round?.settings.hints) {
      const elapsed = now - round.startsAt, duration = round.settings.durationSeconds * 1000;
      if (elapsed >= duration * 20 / 30) hints.artistInitial = Array.from(round.song.artist.trim())[0];
      if (elapsed >= duration * 25 / 30) {
        if (round.settings.answerMode === 'artist') hints.artistWordCount = normalizeGuess(round.song.artist).split(' ').length;
        else hints.titleWordCount = normalizeGuess(round.song.title).split(' ').length;
      }
    }
    const game: GuessPublicState = {
      scope: state.scope, scopeId: state.scopeId, sessionId: state.sessionId, gameId: state.gameId,
      revision: state.revision, phase: state.phase, serverTime: now, categoryId: state.categoryId,
      settings: { ...(state.activeSettings ?? state.settings) }, categories, roundNumber: state.roundNumber,
      scoreboard: [...state.participants.values()].map(player => ({ id: player.id, nickname: player.nickname, total: player.total,
        hasAnswered: round?.awards.has(player.id) ?? false })).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id)),
      answeredCount: round?.awards.size ?? 0,
      round: round ? { roundId: round.id, startsAt: round.startsAt, deadline: round.deadline, hints,
        skipVotes: round.skipVotes.size, skipRequired: Math.floor(state.participants.size / 2) + 1,
        ...(['reveal', 'results'].includes(state.phase) ? { answer: { title: round.song.title, artist: round.song.artist } } : {}) } : null,
    };
    return { game, self: { participantId: participant.id, result: participant.lastResult ? { ...participant.lastResult } : null,
      skipVoted: round?.skipVotes.has(participant.id) ?? false } };
  }
  private newRound(state: State, now: number) {
    const settings = Object.freeze({ ...state.activeSettings! });
    state.round = { id: this.id(), startRevision: state.revision + 1, song: state.songs[state.roundNumber], startsAt: now + 1500,
      deadline: now + 1500 + settings.durationSeconds * 1000, settings, awards: new Map(), skipVotes: new Set() };
    state.roundNumber++; state.phase = 'round'; state.guestReceipts.clear();
    for (const participant of state.participants.values()) { participant.lastResult = null; participant.guesses.clear(); }
  }

  apply(access: GuessAccess, input: Record<string, unknown>): GuessResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UserError('Invalid game request.');
    const action = input.action;
    this.authorize(access, action);
    if (Object.keys(input).some(key => !commonFields.includes(key) && !extras[String(action)].includes(key))) throw new UserError('Unknown game request field.');
    const now = this.now(), key = `${access.scope}:${access.scopeId}`;
    this.collect(now);
    let state = this.states.get(key);
    if (action === 'join') {
      if (typeof input.eventId !== 'string' || !UUID.test(input.eventId)) throw new UserError('Invalid game event.');
      if (input.nickname !== undefined && (typeof input.nickname !== 'string' || !input.nickname.trim() || input.nickname.length > 24 || CONTROL.test(input.nickname)))
        throw new UserError('Use a nickname of one to twenty-four characters without control characters.');
      if (input.sessionId !== undefined && input.sessionId !== state?.sessionId) throw new UserError('The game session changed. Rejoin.', 409);
      const categories = this.categories();
      if (state?.participants.has(access.actor)) { this.reconcile(state, now); state.expires = now + TTL; this.budget('join', key, 256, 128, now); return this.snapshot(state, access.actor, now, categories); }
      if ((!state && this.states.size >= 128) || (state && state.participants.size >= 64)) throw new UserError('This game is full. Try again later.', 429);
      if (state && (state.joinReceipts.has(input.eventId) || state.hostReceipts.has(input.eventId) || state.moderationReceipts.has(input.eventId) || state.guestReceipts.has(input.eventId)))
        throw new UserError('Game event already received.', 409);
      this.budget('join', key, 256, 128, now);
      if (!state) {
        state = { scope: access.scope, scopeId: access.scopeId, sessionId: this.id(), gameId: this.id(), revision: 0,
          phase: 'lobby', expires: now + TTL, categoryId: categories[0]?.id ?? '', settings: Object.freeze({ ...DEFAULT_GUESS_SETTINGS }),
          activeSettings: null, roundNumber: 0, round: null, songs: [], participants: new Map(), guestReceipts: new Set(),
          hostReceipts: new Set(), moderationReceipts: new Set(), joinReceipts: new Set() };
        this.states.set(key, state);
      }
      this.reconcile(state, now);
      state.participants.set(access.actor, { id: this.id(), nickname: typeof input.nickname === 'string' ? input.nickname.trim() : `Player ${state.participants.size + 1}`,
        total: 0, lastResult: null, rate: { until: 0, count: 0 }, guesses: new Set() });
      state.joinReceipts.add(input.eventId); state.revision++; state.expires = now + TTL;
      return this.snapshot(state, access.actor, now, categories);
    }
    if (!state || !state.participants.has(access.actor)) throw new UserError('Join this game first.', 403);
    this.reconcile(state, now);
    const categories = this.categories();
    if (action === 'read') { this.budget('read', key, 4096, 480, now); state.expires = now + TTL; return this.snapshot(state, access.actor, now, categories); }
    const revision = input.revision;
    const guestAction = action === 'guess' || action === 'skip';
    const validRevision = guestAction
      ? typeof revision === 'number' && Number.isInteger(revision) && state.round !== null && revision >= state.round.startRevision && revision <= state.revision
      : revision === state.revision;
    if (input.sessionId !== state.sessionId || input.roundId !== (state.round?.id ?? null) || !validRevision)
      throw new UserError('The game changed. Refresh and try again.', 409);
    if (typeof input.eventId !== 'string' || !UUID.test(input.eventId)) throw new UserError('Invalid game event.');
    if ([state.joinReceipts, state.guestReceipts, state.hostReceipts, state.moderationReceipts].some(receipts => receipts.has(input.eventId as string)))
      throw new UserError('Game event already received.', 409);
    const moderation = ['reveal', 'end', 'reset'].includes(String(action));
    const receipts = guestAction ? state.guestReceipts : moderation ? state.moderationReceipts : state.hostReceipts;
    if (receipts.size >= (guestAction ? 2048 : moderation ? 128 : 256)) throw new UserError('Game action limit reached. Reset or rejoin later.', 429);
    let settings: Readonly<GuessSettings> | undefined, plan: GuessSong[] | undefined, answer: string | undefined;
    if (action === 'configure') {
      if (state.phase !== 'lobby') throw new UserError('Return to the lobby before changing settings.', 409);
      settings = this.settings(input.settings);
      if (!categories.some(category => category.id === input.categoryId)) throw new UserError('Choose a catalog category.');
    } else if (action === 'start') {
      if (state.phase !== 'lobby') throw new UserError('This game has already started.', 409);
      const category = categories.find(category => category.id === state!.categoryId);
      if (!category?.available || category.count < state.settings.roundCount) throw new UserError('This category has too few eligible songs for these settings.', 503);
      plan = [];
      for (let n = 0; n < state.settings.roundCount; n++) {
        const song = copyGuessSong(this.catalog.select(state.categoryId, { exclude: plan.map(selected => selected.id), durationSeconds: state.settings.durationSeconds }));
        const media = copyGuessMedia(this.catalog.media(song.mediaKey));
        if (plan.some(selected => selected.id === song.id) || media.key !== song.mediaKey || media.durationSeconds < state.settings.durationSeconds)
          throw new UserError('The eligible song catalog is unavailable.', 503);
        plan.push(song);
      }
    } else if (action === 'guess') {
      if (state.phase !== 'round' || !state.round || now < state.round.startsAt || state.round.awards.has(state.participants.get(access.actor)!.id))
        throw new UserError('This round is not accepting another answer from you.', 409);
      if (typeof input.text !== 'string' || input.text.length > 120 || CONTROL.test(input.text) || !normalizeGuess(input.text) || normalizeGuess(input.text).length > 120)
        throw new UserError('Use a short answer without control characters.');
      answer = normalizeGuess(input.text);
    } else if (action === 'skip') {
      if (state.phase !== 'round' || !state.round || now < state.round.startsAt || state.round.skipVotes.has(state.participants.get(access.actor)!.id))
        throw new UserError('This round is not accepting another skip vote from you.', 409);
    } else if (action === 'next' && state.phase !== 'reveal') throw new UserError('Reveal this round before advancing.', 409);
    else if (action === 'reveal' && state.phase !== 'round') throw new UserError('There is no hidden round to reveal.', 409);
    else if (action === 'end' && state.phase === 'results') throw new UserError('The game has ended.', 409);
    else if (action === 'reset' && state.phase !== 'results') throw new UserError('End this game before returning to the lobby.', 409);

    if (action === 'guess') {
      const player = state.participants.get(access.actor)!, round = state.round!;
      const digest = createHash('sha256').update(`${round.id}:${answer!}`).digest('hex');
      if (player.guesses.has(digest)) throw new UserError('That guess was already received.', 409);
      if ((player.rate.until > now && player.rate.count >= 20) || player.guesses.size >= 64) throw new UserError('Too many guesses. Try again shortly.', 429);
      this.budget('guess', key, 1200, 240, now);
      if (player.rate.until <= now) player.rate = { until: now + 60_000, count: 0 };
      player.rate.count++; player.guesses.add(digest);
      const accepted = round.settings.answerMode === 'artist' ? [round.song.artist] : [round.song.title, ...round.song.aliases];
      const correct = accepted.some(value => normalizeGuess(value) === answer);
      const awarded = correct ? Math.max(round.settings.minPoints, Math.floor(round.settings.maxPoints -
        (round.settings.maxPoints - round.settings.minPoints) * (now - round.startsAt) / (round.settings.durationSeconds * 1000))) : 0;
      player.lastResult = { correct, awarded };
      if (correct) { round.awards.set(player.id, awarded); player.total += awarded; }
    } else if (action === 'skip') {
      this.budget('skip', key, 1200, 240, now);
      state.round!.skipVotes.add(state.participants.get(access.actor)!.id);
      if (state.round!.skipVotes.size >= Math.floor(state.participants.size / 2) + 1) state.phase = 'reveal';
    } else {
      this.budget(moderation ? 'moderation' : 'host', key, moderation ? 256 : 240, moderation ? 128 : 60, now);
      if (action === 'configure') { state.settings = settings!; state.categoryId = input.categoryId as string; }
      else if (action === 'start') { state.activeSettings = Object.freeze({ ...state.settings }); state.songs = plan!; this.newRound(state, now); }
      else if (action === 'next') {
        if (state.roundNumber >= state.activeSettings!.roundCount) state.phase = 'results'; else this.newRound(state, now);
      } else if (action === 'reveal') state.phase = 'reveal';
      else if (action === 'end') state.phase = 'results';
      else if (action === 'reset') {
        state.gameId = this.id(); state.phase = 'lobby'; state.activeSettings = null; state.roundNumber = 0; state.round = null; state.songs = [];
        state.guestReceipts.clear(); state.hostReceipts.clear();
        for (const player of state.participants.values()) { player.total = 0; player.lastResult = null; player.guesses.clear(); }
      }
    }
    receipts.add(input.eventId); state.revision++; state.expires = now + TTL;
    return this.snapshot(state, access.actor, now, categories);
  }

  media(access: GuessAccess, input: { sessionId: string; roundId: string }): GuessMediaDescriptor {
    this.authorize(access, 'read');
    const now = this.now(), key = `${access.scope}:${access.scopeId}`; this.collect(now);
    const state = this.states.get(key);
    if (!state || !state.participants.has(access.actor)) throw new UserError('Join this game first.', 403);
    this.reconcile(state, now);
    if (!input || input.sessionId !== state.sessionId || input.roundId !== state.round?.id || state.phase !== 'round' || now < state.round.startsAt)
      throw new UserError('The game round changed.', 409);
    this.budget('media', key, 512, 128, now);
    const descriptor = copyGuessMedia(this.catalog.media(state.round!.song.mediaKey));
    if (descriptor.key !== state.round!.song.mediaKey) throw new UserError('The eligible song media is unavailable.', 503);
    return descriptor;
  }
}
