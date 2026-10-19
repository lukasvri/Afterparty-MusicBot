import { EventEmitter } from 'node:events';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { UserError } from './types.ts';
import type { Store } from './store.ts';
export type SocialPlayback = { playbackKey: string | null; videoId: string | null; position: number };
export type SocialState = {
  scope: 'room' | 'guild'; scopeId: string; playbackKey: string | null; revision: number; enabled: boolean;
  reactions: { id: string; emoji: string; at: number }[];
  highlights: { id: string; text: string; position: number; videoId: string; at: number }[];
  bingo: { cells: string[]; marked: number[]; active: boolean } | null;
};
const emojis = ['❤️', '🔥', '👏', '🤘', '✨', '🎉'];
const hostActions = new Set(['configure', 'remove-highlight', 'bingo-start', 'bingo-mark', 'bingo-stop']);
/** Social writes never touch engine/room state or their command revisions. */
export class Social extends EventEmitter {
  private rates = new Map<string, { until: number; count: number }>();
  private recent = new Map<string, number>();
  private reactions = new Map<string, SocialState['reactions']>();
  private store: Store;
  private key: string;
  private now: () => number;
  constructor(store: Store, key: string, now = Date.now) {
    super();
    this.store = store; this.key = key; this.now = now;
    store.db.exec(`CREATE TABLE IF NOT EXISTS concert_social(scope TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS concert_social_receipts(scope TEXT NOT NULL,event_id TEXT NOT NULL,expires INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'guest',PRIMARY KEY(scope,event_id));
      CREATE INDEX IF NOT EXISTS concert_social_receipts_expiry ON concert_social_receipts(expires)`);
    if (!store.prepare('PRAGMA table_info(concert_social_receipts)').all().some(column => column.name === 'kind')) {
      store.db.exec("ALTER TABLE concert_social_receipts ADD COLUMN kind TEXT NOT NULL DEFAULT 'guest'");
    }
  }
  private budget(key: string, max: number, window = 60000) {
    const now = this.now();
    for (const [id, value] of this.rates) if (value.until <= now) this.rates.delete(id);
    let rate = this.rates.get(key);
    if (!rate) {
      if (this.rates.size >= 2048) throw new UserError('Social is busy. Try later.', 429);
      rate = { until: now + window, count: 0 }; this.rates.set(key, rate);
    }
    if (++rate.count > max) throw new UserError('Social is busy. Try later.', 429);
  }
  private signature(payload: string) { return createHmac('sha256', this.key).update('social:' + payload).digest('hex'); }
  private actor(token: unknown, scope: string) {
    if (typeof token !== 'string' || token.length > 1024) throw new UserError('Join social again.', 401);
    const [payload, signature, extra] = token.split('.');
    const expected = this.signature(payload);
    if (extra || !signature || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new UserError('Join social again.', 401);
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (value.scope !== scope || value.expires <= this.now() || value.expires > this.now() + 1800000 || typeof value.id !== 'string') throw Error();
      return value.id as string;
    } catch { throw new UserError('Join social again.', 401); }
  }
  apply(input: Record<string, unknown>, playback: SocialPlayback, host: boolean) {
    if (!['room', 'guild'].includes(String(input.scope)) || typeof input.scopeId !== 'string' || !(input.scope === 'room' ? /^[A-Z0-9]{8}$/ : /^\d{14,22}$/).test(input.scopeId)) throw new UserError('Invalid social scope.');
    const scope = input.scope as 'room' | 'guild', scopeId = input.scopeId, key = scope + ':' + scopeId, now = this.now(), reactionKey = key + ':' + playback.playbackKey;
    this.budget('global', 240); this.budget(key, 90);
    let token: string | undefined;
    if (input.action === 'join') {
      this.budget('joins', 30); this.budget(key + ':joins', 12);
      const payload = Buffer.from(JSON.stringify({ scope: key, id: randomUUID(), expires: now + 1800000 })).toString('base64url');
      token = payload + '.' + this.signature(payload);
    }
    const actor = this.actor(token ?? input.token, key);
    this.store.prepare('DELETE FROM concert_social WHERE expires<=?').run(now);
    this.store.prepare('DELETE FROM concert_social_receipts WHERE expires<=?').run(now);
    const saved = this.store.prepare('SELECT data FROM concert_social WHERE scope=?').get(key);
    let state: SocialState = saved ? JSON.parse(String(saved.data)) : { scope, scopeId, playbackKey: playback.playbackKey, revision: now, enabled: true, reactions: [], highlights: [], bingo: null };
    if (!saved) {
      if (Number(this.store.prepare('SELECT count(*) AS n FROM concert_social').get()!.n) >= 128) throw new UserError('Social is busy. Try later.', 429);
      // Persist the initial generation so reads and subsequent host CAS agree.
      // A new generation after retention expires must outrank the old snapshot.
      this.store.prepare('INSERT INTO concert_social(scope,data,expires) VALUES(?,?,?)').run(key, JSON.stringify(state), now + 86400000);
    }
    if (state.playbackKey !== playback.playbackKey) { this.reactions.delete(reactionKey); state = { ...state, playbackKey: playback.playbackKey, revision: state.revision + 1, highlights: [], bingo: null }; this.store.prepare('UPDATE concert_social SET data=? WHERE scope=?').run(JSON.stringify({ ...state, reactions: [] }), key); }
    const activeReactions = (this.reactions.get(reactionKey) ?? []).filter(r => now - r.at < 6000);
    state.reactions = activeReactions;
    if (input.action === 'join' || input.action === 'read' || input.action === 'stream') return { ...(token ? { token } : {}), social: state };
    if (typeof input.eventId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.eventId)) throw new UserError('Invalid social event.');
    if (!playback.playbackKey || input.playbackKey !== playback.playbackKey) throw new UserError('The concert changed. Refresh social.', 409);
    if (hostActions.has(String(input.action)) && !host) throw new UserError('Host access required.', 403);
    if (hostActions.has(String(input.action)) && input.revision !== state.revision) throw new UserError('Social changed. Refresh and try again.', 409);
    if (!state.enabled && !['configure', 'remove-highlight', 'bingo-stop'].includes(String(input.action))) throw new UserError('Social is disabled by the host.', 403);
    for (const [id, expires] of this.recent) if (expires <= now) this.recent.delete(id);
    const eventKey = key + ':' + actor + ':' + input.eventId;
    if (this.recent.has(eventKey) || state.highlights.some(h => h.id === input.eventId) || this.store.prepare('SELECT 1 FROM concert_social_receipts WHERE scope=? AND event_id=?').get(key, input.eventId)) throw new UserError('Event already received.', 409);
    if (this.recent.size >= 4096) throw new UserError('Social is busy. Try later.', 429);
    this.budget(key + ':' + actor, 20);
    if (input.action === 'reaction') {
      if (!emojis.includes(String(input.emoji))) throw new UserError('Choose a reaction.');
      this.budget('reactions', 90); this.budget(key + ':reactions', 30); this.budget(key + ':' + actor + ':reaction', 6);
      if (!this.reactions.has(reactionKey) && this.reactions.size >= 128) {
        for (const [id, events] of this.reactions) if (!events.some(e => now - e.at < 6000)) this.reactions.delete(id);
        if (this.reactions.size >= 128) throw new UserError('Reactions are busy.', 429);
      }
      state.reactions = [...activeReactions, { id: input.eventId, emoji: String(input.emoji), at: now }].slice(-20);
      this.reactions.set(reactionKey, state.reactions);
    } else {
      // Keep receipts for 24 hours; guest actions cannot consume the separate
      // host moderation reserve. Reject at capacity instead of permitting replay.
      const receiptKind = hostActions.has(String(input.action)) ? 'host' : 'guest';
      if (Number(this.store.prepare('SELECT count(*) AS n FROM concert_social_receipts WHERE scope=? AND kind=?').get(key, receiptKind)!.n) >= 128) throw new UserError('Daily social action limit reached. Try later.', 429);
      switch (input.action) {
        case 'highlight': {
          this.budget(key + ':' + actor + ':highlight', 3);
          if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 160 || /[\u0000-\u001f\u007f]/.test(input.text) || !playback.videoId || !/^[\w-]{11}$/.test(playback.videoId)) throw new UserError('Use a short highlight caption.');
          state.highlights = [...state.highlights, { id: input.eventId, text: input.text.trim(), position: Math.max(0, Math.floor(playback.position)), videoId: playback.videoId, at: now }].slice(-30); break;
        }
        case 'remove-highlight': state.highlights = state.highlights.filter(h => h.id !== input.highlightId); break;
        case 'configure': if (typeof input.enabled !== 'boolean') throw new UserError('Invalid social setting.'); state.enabled = input.enabled; if (!state.enabled) { state.reactions = []; this.reactions.delete(reactionKey); } break;
        case 'bingo-start':
          if (!Array.isArray(input.cells) || input.cells.length !== 9 || !input.cells.every(c => typeof c === 'string' && c.trim().length > 0 && c.length <= 60 && !/[\u0000-\u001f\u007f]/.test(c)) || new Set(input.cells.map(c => c.trim().toLowerCase())).size !== 9) throw new UserError('Enter nine distinct short bingo prompts.');
          state.bingo = { cells: input.cells.map(c => String(c).trim()), marked: [], active: true }; break;
        case 'bingo-mark':
          if (!state.bingo?.active || !Number.isInteger(input.cell) || Number(input.cell) < 0 || Number(input.cell) > 8) throw new UserError('Choose a live bingo square.');
          if (!state.bingo.marked.includes(Number(input.cell))) state.bingo.marked.push(Number(input.cell)); break;
        case 'bingo-stop': if (state.bingo) state.bingo.active = false; break;
        default: throw new UserError('Unknown social action.');
      }
      state.revision++;
      this.store.transaction(() => {
        this.store.prepare('INSERT INTO concert_social(scope,data,expires) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET data=excluded.data,expires=excluded.expires').run(key, JSON.stringify({ ...state, reactions: [] }), now + 86400000);
        this.store.prepare('INSERT INTO concert_social_receipts(scope,event_id,expires,kind) VALUES(?,?,?,?)').run(key, input.eventId as string, now + 86400000, receiptKind);
      });
    }
    // Reaction receipts intentionally remain ephemeral across Core restarts.
    this.recent.set(eventKey, now + 1800000);
    this.emit('change', key, state, input.action === 'reaction');
    return { social: state };
  }
}
