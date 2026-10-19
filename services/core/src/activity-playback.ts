import { createHmac } from 'node:crypto';
import { Rooms } from './rooms.ts';
import type { Store } from './store.ts';
import type { RoomVideo } from './protocol.ts';
import { UserError } from './types.ts';

export type ActivityContext = { guildId: string; channelId: string; instanceId: string };
export function activityContext(value: Record<string, unknown>): ActivityContext {
  if (typeof value.guildId !== 'string' || !/^\d{14,22}$/.test(value.guildId) ||
      typeof value.channelId !== 'string' || !/^\d{14,22}$/.test(value.channelId) ||
      typeof value.instanceId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value.instanceId))
    throw new UserError('Open this Activity in a server channel.', 403);
  return { guildId: value.guildId, channelId: value.channelId, instanceId: value.instanceId };
}

/** Reuse the authoritative room clock, in a private table inaccessible to public rooms. */
export class ActivityPlayback {
  readonly rooms: Rooms;
  readonly store: Store;
  readonly key: string;
  constructor(store: Store, key: string, now = Date.now) {
    this.store = store; this.key = key;
    this.rooms = new Rooms(store, now, 'activity_rooms');
  }
  private identity(context: ActivityContext) {
    return createHmac('sha256', this.key).update('activity-room:' + JSON.stringify(context)).digest('hex');
  }
  join(context: ActivityContext, name: string) {
    const identity = this.identity(context), code = 'A1' + identity.slice(0, 6).toUpperCase();
    this.store.prepare("DELETE FROM activity_rooms WHERE json_extract(data,'$.expiresAt')<=?").run(this.rooms.now());
    const row = this.store.prepare('SELECT data FROM activity_rooms WHERE code=?').get(code);
    const binding = row ? (JSON.parse(String(row.data)) as {ownerHash:string}).ownerHash : null;
    // Short display codes are not capabilities. Refuse collisions instead of joining another session.
    if (binding && binding !== identity) throw new UserError('Activity room collision. Reopen later.', 409);
    if (!row && Number(this.store.prepare('SELECT count(*) AS n FROM activity_rooms').get()!.n) >= 128)
      throw new UserError('Activity rooms are busy. Try later.', 429);
    this.rooms.import({ code, name: name.slice(0, 80), owner_hash: identity,
      state: { current: null, queue: [], playing: false, position: 0, radio: false },
      version: 1, updated_at: this.rooms.now(), expires_at: this.rooms.now() + 86400000 });
    return code;
  }
  snapshot(code: string, context: ActivityContext, manager: boolean) {
    this.requireBinding(code, context);
    return { ...this.rooms.snapshot(code), mode: 'activity' as const, guildId: context.guildId, isHost: manager };
  }
  private requireBinding(code: string, context: ActivityContext) {
    if (this.rooms.load(code).ownerHash !== this.identity(context))
      throw new UserError('Activity belongs to another channel or session.', 403);
  }
  async control(code: string, context: ActivityContext, input: Record<string, unknown>,
    access: { user: { id: string; name: string }; canManage: boolean },
    video: (id: string) => Promise<RoomVideo>, recheck: () => Promise<void>) {
    this.requireBinding(code, context);
    const allowed = ['add', 'play-video', 'play', 'pause', 'seek', 'next', 'remove', 'clear', 'move', 'undo', 'approval', 'approve', 'reject', 'vote', 'skip-vote'];
    if (!allowed.includes(String(input.action))) throw new UserError('Unsupported Activity control.', 400);
    if (!access.canManage && !['add', 'vote', 'skip-vote'].includes(String(input.action)))
      throw new UserError('A server manager must control playback.', 403);
    const current = this.rooms.snapshot(code);
    if (input.version !== current.version) throw new UserError('The room has changed. Try again.', 409);
    const fields: Record<string, unknown> = {};
    // Allowlist fields. Caller-provided role, video metadata, clock and identity never reach the reducer.
    for (const key of ['action', 'version', 'videoId', 'index', 'to', 'position', 'enabled']) fields[key] = input[key];
    if (['add', 'play-video'].includes(String(input.action))) {
      if (typeof input.videoId !== 'string' || !/^[\w-]{11}$/.test(input.videoId)) throw new UserError('Choose a YouTube video.');
      fields.video = await video(input.videoId);
    }
    await recheck();
    fields.displayName = access.user.name;
    fields.participantHash = createHmac('sha256', this.key).update(code + ':' + access.user.id).digest('hex');
    fields.actorHash = access.canManage ? this.identity(context) : '';
    await this.rooms.control(code, fields);
    return this.snapshot(code, context, access.canManage);
  }
  tick() { return this.rooms.tick(); }
  dispose() { this.rooms.dispose(); }
}
