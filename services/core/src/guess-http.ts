import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GuessGame, type GuessAccess } from './guess-game.ts';
import { UnavailableGuessCatalog, type GuessCatalog } from './guess-catalog.ts';
import type { GuessMediaSource } from './guess-media.ts';
import { guessWaveSeconds, guessAbort } from './guess-audio-format.ts';
import { UserError } from './types.ts';
type Dependencies = {
  key: string; authenticate: (request: IncomingMessage) => void;
  body: (request: IncomingMessage, maximum: number) => Promise<Record<string, unknown>>;
  json: (response: ServerResponse, status: number, data: unknown) => void;
  guild: (grant: unknown, id: string, signal?: AbortSignal) => Promise<{ canManage: boolean }>;
  browserRoom: (id: string) => boolean; catalog?: GuessCatalog; media?: GuessMediaSource;
};
const controls = new Set(['configure', 'start', 'next', 'reveal', 'end', 'reset']);
/** Anonymous scoped game transport. Bounded private media transport, without queue/room imports or playback dependency. */
export class GuessHttp {
  private game: GuessGame;
  private catalog: GuessCatalog;
  private rates = new Map<string, { count: number; until: number }>();
  private deps: Dependencies;
  private mediaReads = 0;
  private mediaReceipts = new Map<string, { expires: number; ids: Set<string> }>();
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
    const connection = new AbortController(), onClose = () => connection.abort();
    response.once('close', onClose); request.once('aborted', onClose);
    const connectionSignal = AbortSignal.any([connection.signal, AbortSignal.timeout(12000)]);
    try {
      this.deps.authenticate(request);
      if (request.method !== 'POST') throw new UserError('Method not allowed.', 405);
      const input = await this.deps.body(request, 4096);
      connectionSignal.throwIfAborted();
      if (input.action === 'catalog') {
        this.limit('catalog:' + peer, 90);
        const categories = this.catalog.categories();
        if (!request.aborted && !response.destroyed) this.deps.json(response, 200, {
          categories, playable: Boolean(this.deps.media && categories.some(category => category.available)),
          ...(this.catalog.syntheticTest === true ? { syntheticTest: true } : {}),
        });
        return;
      }
      if (!['room', 'guild'].includes(String(input.scope)) || typeof input.scopeId !== 'string' || !(input.scope === 'room' ? /^[A-Z0-9]{8}$/ : /^\d{14,22}$/).test(input.scopeId)) throw new UserError('Invalid game scope.');
      if (!['join', 'read', 'guess', 'skip', 'media', ...controls].includes(String(input.action))) throw new UserError('Unknown game action.');
      const scope = input.scope as 'room' | 'guild', scopeId = input.scopeId, key = scope + ':' + scopeId;
      let host = false;
      if (scope === 'guild') host = (await guessAbort(this.deps.guild(input.tokenCipher, scopeId, connectionSignal), connectionSignal)).canManage;
      else { if (!this.deps.browserRoom(scopeId) || !Number.isFinite(input.roomExpiresAt) || Number(input.roomExpiresAt) <= Date.now()) throw new UserError('This browser room is unavailable.', 404); host = input.host === true; }
      if (request.aborted || response.destroyed) return;
      if (controls.has(String(input.action)) && !host) throw new UserError('Host access required.', 403);
      let token = input.token;
      // Validate a supplied grant before charging legitimate join capacity.
      let actor = token ? this.actor(token, key) : undefined;
      if (input.action === 'join') { this.limit('join:' + key, 30); this.limit('join-global', 120); if (!token) token = this.grant(key); }
      actor ??= this.actor(token, key);
      const access: GuessAccess = { scope, scopeId, host, actor: actor.id };
      if (input.action === 'media') {
        const controller = new AbortController(), abort = () => controller.abort();
        response.once('close', abort); request.once('aborted', abort);
        const signal = AbortSignal.any([connectionSignal, controller.signal, AbortSignal.timeout(10000)]);
        let reading = false;
        try {
          if (request.aborted || response.destroyed) return;
          const fields = { sessionId: input.sessionId as string, roundId: input.roundId as string };
          const descriptor = this.game.media(access, fields);
          if (!this.deps.media) throw new UserError('Game preview is unavailable.', 503);
          if (typeof input.eventId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.eventId)) throw new UserError('Invalid preview event.');
          const now = Date.now(), receiptKey = `${key}:${actor.id}:${fields.sessionId}:${fields.roundId}`;
          for (const [id, receipt] of this.mediaReceipts) if (receipt.expires <= now) this.mediaReceipts.delete(id);
          const receipt = this.mediaReceipts.get(receiptKey) ?? { expires: now + 300000, ids: new Set<string>() };
          if (receipt.ids.has(input.eventId)) throw new UserError('Preview event already received.', 409);
          if (receipt.ids.size >= 32 || (!this.mediaReceipts.has(receiptKey) && this.mediaReceipts.size >= 1024) || this.mediaReads >= 2) throw new UserError('Game previews are busy.', 429);
          this.limit('media:' + key, 64); this.limit('media-global', 256);
          receipt.ids.add(input.eventId); this.mediaReceipts.set(receiptKey, receipt); this.mediaReads++; reading = true;
          const bytes = await guessAbort(this.deps.media.read(descriptor.key, signal), signal); signal.throwIfAborted();
          if (scope === 'guild') await guessAbort(this.deps.guild(input.tokenCipher, scopeId, signal), signal);
          else if (!this.deps.browserRoom(scopeId) || Number(input.roomExpiresAt) <= Date.now()) throw new UserError('This browser room is unavailable.', 404);
          signal.throwIfAborted(); this.actor(input.token, key);
          const latest = this.game.media(access, fields);
          if (latest.key !== descriptor.key || guessWaveSeconds(bytes) < descriptor.durationSeconds) throw new UserError('Game preview is unavailable.', 503);
          if (!request.aborted && !response.destroyed) {
            response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(bytes);
          }
        } catch (error) {
          if (!request.aborted && !response.destroyed) throw error instanceof UserError ? error : new UserError('Game preview is unavailable.', 503);
        } finally {
          if (reading) this.mediaReads--; controller.abort(); response.off('close', abort); request.off('aborted', abort);
        }
        return;
      }
      // Refresh an active, still-valid anonymous identity before it expires.
      if (actor.expires - Date.now() < 300000) token = this.grant(key, actor.id);
      // Pass only model fields. Roles, clocks, scores, answers and source URLs are never client authority.
      const fields: Record<string, unknown> = { action: input.action };
      const names = input.action === 'join' ? ['nickname', 'sessionId', 'eventId'] : input.action === 'read' ? [] : ['sessionId', 'revision', 'roundId', 'eventId', ...(input.action === 'guess' ? ['text'] : input.action === 'configure' ? ['settings', 'categoryId'] : [])];
      for (const name of names) if (input[name] !== undefined) fields[name] = input[name];
      const result = this.game.apply(access, fields);
      if (!request.aborted && !response.destroyed) this.deps.json(response, 200, { ...result, canManage: host, mediaAvailable: Boolean(this.deps.media && result.game.phase === 'round'), ...(input.action === 'join' || token !== input.token ? { token } : {}) });
    } catch (error) {
      // Denied callers cannot spend valid participants' game or playback capacity.
      if (request.aborted || response.destroyed) return;
      this.limit('rejected:' + peer, 120); this.limit('rejected-global', 600); throw error;
    } finally { connection.abort(); response.off('close', onClose); request.off('aborted', onClose); }
  }
}
