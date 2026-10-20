import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GuessGame, type GuessAccess } from './guess-game.ts';
import { UnavailableGuessCatalog, type GuessCatalog } from './guess-catalog.ts';
import { UserError } from './types.ts';
type Dependencies = {
  key: string; authenticate: (request: IncomingMessage) => void;
  body: (request: IncomingMessage, maximum: number) => Promise<Record<string, unknown>>;
  json: (response: ServerResponse, status: number, data: unknown) => void;
  guild: (grant: unknown, id: string) => Promise<{ canManage: boolean }>;
  browserRoom: (id: string) => boolean; catalog?: GuessCatalog;
};
const controls = new Set(['configure', 'start', 'next', 'reveal', 'end', 'reset']);
/** Anonymous scoped game transport. No media endpoint, queue/room imports or playback dependency. */
export class GuessHttp {
  private game: GuessGame;
  private catalog: GuessCatalog;
  private rates = new Map<string, { count: number; until: number }>();
  private deps: Dependencies;
  constructor(deps: Dependencies) { this.deps = deps; this.catalog = deps.catalog ?? new UnavailableGuessCatalog(); this.game = new GuessGame({ catalog: this.catalog }); }
  private limit(key: string, max: number) {
    const now = Date.now();
    for (const [id, value] of this.rates) if (value.until <= now) this.rates.delete(id);
    let value = this.rates.get(key);
    if (!value) { if (this.rates.size >= 2048) throw new UserError('Games are busy. Try again shortly.', 429); value = { count: 0, until: now + 60000 }; this.rates.set(key, value); }
    if (++value.count > max) throw new UserError('Games are busy. Try again shortly.', 429);
  }
  private signature(payload: string) { return createHmac('sha256', this.deps.key).update('guess:' + payload).digest('hex'); }
  private grant(scope: string, id: string = randomUUID()) { const payload = Buffer.from(JSON.stringify({ scope, id, expires: Date.now() + 1800000 })).toString('base64url'); return payload + '.' + this.signature(payload); }
  private actor(token: unknown, scope: string) {
    if (typeof token !== 'string' || token.length > 1024) throw new UserError('Rejoin the game.', 419);
    const [payload, signature, extra] = token.split('.');
    if (extra || !/^[a-f0-9]{64}$/.test(signature ?? '') || !timingSafeEqual(Buffer.from(signature), Buffer.from(this.signature(payload)))) throw new UserError('Rejoin the game.', 419);
    try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (data.scope !== scope || data.expires <= Date.now() || data.expires > Date.now() + 1800000 || typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)) throw Error(); return { id: data.id as string, expires: Number(data.expires) };
    } catch { throw new UserError('Rejoin the game.', 419); }
  }
  async handle(request: IncomingMessage, response: ServerResponse) {
    const peer = request.socket.remoteAddress ?? 'unknown';
    try {
      this.deps.authenticate(request);
      if (request.method !== 'POST') throw new UserError('Method not allowed.', 405);
      const input = await this.deps.body(request, 4096);
      if (input.action === 'catalog') { this.limit('catalog:' + peer, 90); if (!request.aborted && !response.destroyed) this.deps.json(response, 200, { categories: this.catalog.categories(), playable: false }); return; }
      if (!['room', 'guild'].includes(String(input.scope)) || typeof input.scopeId !== 'string' || !(input.scope === 'room' ? /^[A-Z0-9]{8}$/ : /^\d{14,22}$/).test(input.scopeId)) throw new UserError('Invalid game scope.');
      if (!['join', 'read', 'guess', ...controls].includes(String(input.action))) throw new UserError('Unknown game action.');
      const scope = input.scope as 'room' | 'guild', scopeId = input.scopeId, key = scope + ':' + scopeId;
      let host = false;
      if (scope === 'guild') host = (await this.deps.guild(input.tokenCipher, scopeId)).canManage;
      else { if (!this.deps.browserRoom(scopeId) || !Number.isFinite(input.roomExpiresAt) || Number(input.roomExpiresAt) <= Date.now()) throw new UserError('This browser room is unavailable.', 404); host = input.host === true; }
      if (request.aborted || response.destroyed) return;
      if (controls.has(String(input.action)) && !host) throw new UserError('Host access required.', 403);
      let token = input.token;
      // Validate a supplied grant before charging legitimate join capacity.
      let actor = token ? this.actor(token, key) : undefined;
      if (input.action === 'join') { this.limit('join:' + key, 30); this.limit('join-global', 120); if (!token) token = this.grant(key); }
      actor ??= this.actor(token, key);
      const access: GuessAccess = { scope, scopeId, host, actor: actor.id };
      // Refresh an active, still-valid anonymous identity before it expires.
      if (actor.expires - Date.now() < 300000) token = this.grant(key, actor.id);
      // Pass only model fields. Roles, clocks, scores, answers and source URLs are never client authority.
      const fields: Record<string, unknown> = { action: input.action };
      const names = input.action === 'join' ? ['nickname', 'sessionId', 'eventId'] : input.action === 'read' ? [] : ['sessionId', 'revision', 'roundId', 'eventId', ...(input.action === 'guess' ? ['text'] : input.action === 'configure' ? ['settings', 'categoryId'] : [])];
      for (const name of names) if (input[name] !== undefined) fields[name] = input[name];
      const result = this.game.apply(access, fields);
      if (!request.aborted && !response.destroyed) this.deps.json(response, 200, { ...result, canManage: host, ...(input.action === 'join' || token !== input.token ? { token } : {}) });
    } catch (error) {
      // Denied callers cannot spend valid participants' game or playback capacity.
      this.limit('rejected:' + peer, 120); this.limit('rejected-global', 600); throw error;
    }
  }
}
