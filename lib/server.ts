import type {YouTubeResponses} from "@/services/core/src/external-types";
import { metadataGenres, metadataMusic } from "../services/core/src/radio.ts";
import { metadataAiGenerated } from "../services/core/src/music-content.ts";
import { visitorIdentity } from "./visitor-identity.ts";
import { env as cloudEnv } from "cloudflare:workers";
import type { Video, RoomState, Room } from "./types";
import { hasPasswordSession } from "./admin-session";
import { coreUrl, coreRequest } from "./core-server";
import { recordPlay } from "./party";
import {
  changeRoom,
  needsRecommendation,
  finished,
  prefetchDue,
  publicPlayback,
  guestActions,
} from "../services/core/src/room-state.ts";
import {
  roomRecommendation,
  playableRoomQueue,
} from "../services/core/src/room-radio.ts";
type Env = Cloudflare.Env & {
  YOUTUBE_API_KEY?: string;
  ADMIN_BRIDGE_KEY?: string;
};
const env = () => cloudEnv as Env;
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}
export const db = () =>
  env().DB ?? fail(503, "Romtjenesten er ikke klar ennå.");
export const hash = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const secret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const bearer = (request: Request) =>
  (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
export const isAdmin = async (request?: Request) => {
  const provided = request ? bearer(request) : "";
  if (
    provided &&
    env().ADMIN_BRIDGE_KEY &&
    (await hash(provided)) === (await hash(env().ADMIN_BRIDGE_KEY!))
  )
    return true;
  if (request && (await hasPasswordSession(request))) return true;
  return false;
};
export async function limit(
  request: Request,
  scope: string,
  maximum: number,
  milliseconds: number,
  global = false,
) {
  const identity = global
    ? "global"
    : await hash(
        request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-real-ip") ??
          "shared",
      );
  const now = Date.now();
  const key = `${scope}:${identity}`;
  const result = await db()
    .prepare(
      "INSERT INTO limits(key,count,until) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<? THEN 1 ELSE count+1 END, until=CASE WHEN until<? THEN ? ELSE until END WHERE until<? OR count<? RETURNING count",
    )
    .bind(key, now + milliseconds, now, now, now + milliseconds, now, maximum)
    .first();
  if (!result)
    fail(
      429,
      "Ta en liten pause og prøv igjen. Grensen beskytter søket og rommene mot misbruk.",
    );
}
export async function body(request: Request, maximum = 16000) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    fail(403, "Forespørselen kommer fra en annen nettside.");
  if (
    !(request.headers.get("content-type") ?? "").startsWith("application/json")
  )
    fail(415, "Bruk JSON.");
  if (Number(request.headers.get("content-length") ?? 0) > maximum)
    fail(413, "Forespørselen er for stor.");
  const reader = request.body?.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        fail(413, "Forespørselen er for stor.");
      }
      parts.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  const input = new TextDecoder().decode(bytes);
  let result;
  try {
    result = JSON.parse(input);
  } catch {
    fail(400, "Ugyldig forespørsel.");
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    fail(400, "Ugyldig forespørsel.");
  return result as Record<string, unknown>;
}
export async function api(operation: () => Promise<unknown>) {
  try {
    return Response.json(await operation(), {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const remote = error as Error & { status?: number };
    const status =
      error instanceof ApiError
        ? error.status
        : Number.isInteger(remote?.status) &&
            remote.status! >= 400 &&
            remote.status! <= 599
          ? remote.status!
          : 500;
    return Response.json(
      {
        error:
          status !== 500 && error instanceof Error
            ? error.message
            : "Noe gikk galt. Prøv igjen.",
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
}
export function videoId(input: string) {
  if (/^[\w-]{11}$/.test(input)) return input;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return fail(400, "Bruk en YouTube-lenke til en video.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    ![
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
    ].includes(url.hostname)
  )
    fail(400, "Bruk en YouTube-lenke.");
  const parts = url.pathname.split("/").filter(Boolean);
  const id =
    url.hostname === "youtu.be" && parts.length === 1
      ? parts[0]
      : url.pathname === "/watch"
        ? url.searchParams.get("v")
        : parts.length === 2 && ["live", "shorts", "embed"].includes(parts[0])
          ? parts[1]
          : null;
  if (!id || !/^[\w-]{11}$/.test(id)) fail(400, "Lenken må peke til en video.");
  return id;
}
const inFlight = new Map<string, Promise<unknown>>();
async function cached<T>(key: string, provider: () => Promise<T>, lifetime: (result: T) => number = () => 3600000): Promise<T> {
  const row = await db()
    .prepare("SELECT data FROM cached WHERE key=? AND expires_at>?")
    .bind(key, Date.now())
    .first<{ data: string }>();
  if (row) {
    try {
      return JSON.parse(row.data);
    } catch {
      /* refresh invalid cache */
    }
  }
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const pending = (async () => {
    const result = await provider();
    await db()
      .prepare(
        "INSERT INTO cached(key,data,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at",
      )
      .bind(key, JSON.stringify(result), Date.now() + lifetime(result))
      .run();
    return result;
  })();
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    inFlight.delete(key);
  }
}
async function youtube<K extends keyof YouTubeResponses>(path: K, params: Record<string, string>) {
  const key = env().YOUTUBE_API_KEY;
  if (!key) fail(503, "Musikksøket er ikke konfigurert ennå.");
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries({ ...params, key }))
    url.searchParams.set(k, v);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok)
    fail(
      response.status === 403 ? 429 : 502,
      "YouTube-søket er midlertidig utilgjengelig. Prøv igjen senere.",
    );
  return response.json() as Promise<YouTubeResponses[K]>;
}
function duration(input: string) {
  const m = input?.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m
    ? Number(m[1] ?? 0) * 86400 +
        Number(m[2] ?? 0) * 3600 +
        Number(m[3] ?? 0) * 60 +
        Number(m[4] ?? 0)
    : 0;
}
function decode(input: string) {
  return input
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
export async function videos(
  request: Request,
  ids: string[],
): Promise<Video[]> {
  if (!ids.length) return [];
  return cached(`videos:v4:${ids.join(",")}`, async () => {
    if (coreUrl()) {
      try {
        return (
          await coreRequest<{ videos: Video[] }>(
            "/v1/catalog?ids=" + ids.join(","),
          )
        ).videos;
      } catch {
        /* retain the direct metadata API */
      }
    }
    await limit(request, "video-budget", 1200, 86400000, true);
    const data = await youtube("videos", {
      id: ids.join(","),
      part: "snippet,contentDetails,status",
    });
    return data.items.map((v) => ({
      id: v.id,
      genres: metadataGenres(v.snippet.description, v.snippet.tags),
      music: metadataMusic(v.snippet.categoryId),
      aiGenerated: metadataAiGenerated(v.snippet.title, v.snippet.channelTitle, v.snippet.description, v.snippet.tags, v.status.containsSyntheticMedia),
      title: decode(v.snippet.title),
      artist: decode(v.snippet.channelTitle),
      image: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      duration: duration(v.contentDetails.duration),
      live: v.snippet.liveBroadcastContent === "live",
      embeddable: v.status.embeddable !== false,
    }));
  });
}
export async function search(request: Request, query: string) {
  return searchVideos(request, query, false);
}
/** Only room handlers can select the internal radio mode; public search has a fixed budget. */
async function searchVideos(request: Request, query: string, radio: boolean) {
  query = query.trim();
  if (query.length < 2 || query.length > 120)
    fail(400, "Skriv mellom 2 og 120 tegn.");
  await limit(request, radio ? "radio-visitor" : "search-visitor", radio ? 120 : 20, 600000);
  if (/^https?:\/\//.test(query))
    return { videos: await videos(request, [videoId(query)]) };
  const count = radio ? 20 : 30;
  const result = await cached(`search:v5:${radio ? "radio" : "user"}:${query.toLowerCase()}`, async () => {
    if (coreUrl()) {
      try {
        return (
          await coreRequest<{ videos: Video[] }>(
            "/v1/catalog?q=" + encodeURIComponent(query) + (radio ? "&mode=radio" : ""),
          )
        ).videos.slice(0, count);
      } catch {
        /* retain the direct metadata API */
      }
    }
    await limit(request, "search-budget", 40, 86400000, true);
    const data = await youtube("search", {
      part: "snippet",
      q: query,
      type: "video",
      maxResults: String(count),
      videoEmbeddable: "true",
      safeSearch: "moderate",
      ...(radio ? { videoCategoryId: "10" } : {}),
    });
    return videos(
      request,
      [...new Set(data.items.map((v) => v.id.videoId).filter(id => /^[\w-]{11}$/.test(id)))].slice(0, count),
    );
  }, videos => videos.length ? 3600000 : 60000);
  return { videos: result };
}
type Row = {
  is_public?: number;
  guild_id?: string;
  code: string;
  name: string;
  owner_hash: string;
  state: string;
  version: number;
  updated_at: number;
  expires_at: number;
};
export async function row(code: string) {
  if (!/^[A-Z0-9]{8}$/.test(code)) fail(404, "Rommet finnes ikke.");
  const value = await db()
    .prepare("SELECT * FROM rooms WHERE code=? AND expires_at>?")
    .bind(code, Date.now())
    .first<Row>();
  if (!value)
    fail(404, "Rommet er avsluttet eller har gått ut. Lag et nytt rom.");
  return value;
}
export async function publicRoom(
  request: Request,
  value: Row,
  heartbeat = true,
  allowRadioPrefetch = true,
): Promise<Room> {
  const state = JSON.parse(value.state) as RoomState;
  const actor = visitorIdentity(request.headers);
  const now = Date.now();
  const discord = Boolean(value.guild_id) || value.code === "DISCORD1";
  // Unchanged room snapshots do not need a write on every bridge heartbeat.
  // Read liveness from the same guild's heartbeat, retaining legacy room-only
  // snapshots when no bot_state record has been published yet.
  const bridgeHeartbeat = discord
    ? await db().prepare("SELECT updated_at FROM bot_state WHERE key=?")
      .bind(value.guild_id ? `discord:${value.guild_id}` : "discord")
      .first<{ updated_at: number }>()
    : null;
  const heartbeatAt = bridgeHeartbeat?.updated_at ?? value.updated_at;
  const discordOnline = discord && now - heartbeatAt < 15000;
  if (discord && !discordOnline) state.playing = false;
  const visibleState = publicPlayback(state);
  const actorHash = await hash(bearer(request));
  const owner = actorHash === value.owner_hash;
  const host = owner || (state.cohostHashes ?? []).includes(actorHash);
  if (heartbeat && actor && /^[a-f0-9-]{32,40}$/.test(actor))
    await db()
      .prepare(
        "INSERT INTO visitors(key,room,until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<?",
      )
      .bind(`${value.code}:${actor}`, value.code, now + 45000, now + 30000)
      .run();
  const viewers = await db()
    .prepare("SELECT count(*) AS n FROM visitors WHERE room=? AND until>?")
    .bind(value.code, now)
    .first<{ n: number }>();
  if (!discord && coreUrl()) {
    try {
      const data = await coreRequest<{ room: Room }>("/v1/rooms", "POST", {
        operation: "import",
        ...value,
        owner_hash: state.engineOwnerHash ?? value.owner_hash,
      });
      return {
        ...data.room,
        isPublic: value.is_public === 1,
        viewers: viewers?.n ?? 0,
        isHost: host,
        isOwner: owner,
      };
    } catch {
      fail(503, "Rommet venter på sanntidstjenesten. Prøv igjen.");
    }
  }
  if (!discord && (finished(state, value.updated_at, now) || (allowRadioPrefetch && prefetchDue(state, value.updated_at, now)))) {
    const action = finished(state, value.updated_at, now) ? "next" : "radio-prefetch";
    let recommended: Video | null = null;
    try {
      recommended = await roomRecommendation(
        state,
        async (query) => (await searchVideos(request, query, true)).videos,
      );
    } catch {
      /* end cleanly when radio is unavailable */
    }
    const next = changeRoom(
      state,
      { action, now: Date.now() },
      true,
      state.position + (state.playing ? Math.max(0, Date.now() - Math.max(value.updated_at, state.startsAt ?? value.updated_at)) / 1000 : 0),
      recommended,
    );
    const saved = next;
    await db()
      .prepare(
        "UPDATE rooms SET state=?,version=version+1,updated_at=? WHERE code=? AND version=?",
      )
      .bind(JSON.stringify(saved), Date.now(), value.code, value.version)
      .run();
    return publicRoom(request, await row(value.code), false);
  }
  const position =
    state.position +
    (state.playing && !state.buffering
      ? (discord
          ? Math.min(12000, now - value.updated_at)
          : now - value.updated_at) / 1000
      : 0);
  return {
    code: value.code,
    name: value.name,
    ...visibleState,
    radio: state.radio !== false,
    isPublic: value.is_public === 1,
    position:
      state.current && !state.current.live
        ? Math.min(state.current.duration, position)
        : position,
    version: value.version,
    serverTime: now,
    viewers: viewers?.n ?? 0,
    isHost: !discord && host,
    isOwner: !discord && owner,
    expiresAt: value.expires_at,
    ...(discord
      ? {
          mode: "discord" as const,
          guildId: value.guild_id,
          discordOnline,
          buffering:state.buffering,
          syncValidForMs: Math.max(0, 12000 - (now - heartbeatAt)),
        }
      : {}),
  };
}
export async function createRoom(
  request: Request,
  name: string,
  isPublic = false,
) {
  await limit(request, "create-room", 5, 3600000);
  await limit(request, "room-budget", 100, 86400000, true);
  name = String(name ?? "").trim();
  if (!name || name.length > 48)
    fail(400, "Gi rommet et navn med 1 til 48 tegn.");
  const code = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((v) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[v % 32])
    .join("");
  const token = secret();
  const now = Date.now();
  await db().batch([
    db().prepare("DELETE FROM visitors WHERE until<?").bind(now),
    db().prepare("DELETE FROM rooms WHERE expires_at<?").bind(now),
    db().prepare("DELETE FROM cached WHERE expires_at<?").bind(now),
    db().prepare("DELETE FROM limits WHERE until<?").bind(now),
  ]);
  await db()
    .prepare(
      "INSERT INTO rooms(code,name,owner_hash,state,version,updated_at,expires_at,is_public) VALUES(?,?,?,?,1,?,?,?)",
    )
    .bind(
      code,
      name,
      await hash(token),
      JSON.stringify({ current: null, queue: [], playing: false, position: 0 }),
      now,
      now + 172800000,
      isPublic ? 1 : 0,
    )
    .run();
  return { room: await publicRoom(request, await row(code)), token };
}
/** Explicitly listed user rooms only. No tokens, queue, guild or visitor identities. */
export async function openRooms(request: Request) {
  await limit(request, "room-directory", 60, 60000);
  const now = Date.now();
  const result = await db()
    .prepare(
      `SELECT r.code,r.name,r.expires_at,
    (SELECT count(*) FROM visitors v WHERE v.room=r.code AND v.until>?) AS viewers
    FROM rooms r WHERE r.is_public=1 AND r.expires_at>? AND r.guild_id IS NULL AND r.code!='DISCORD1'
    ORDER BY viewers DESC,r.updated_at DESC LIMIT 60`,
    )
    .bind(now, now)
    .all<{ code: string; name: string; expires_at: number; viewers: number }>();
  return {
    rooms: result.results.map((r) => ({
      code: r.code,
      name: r.name,
      viewers: r.viewers,
      expiresAt: r.expires_at,
    })),
  };
}
/** Authorize at the website boundary; client-supplied hashes and metadata are never forwarded. */
export async function mutate(
  request: Request,
  code: string,
  input: Record<string, unknown>,
) {
  const value = await row(code);
  if (code === "DISCORD1" || value.guild_id)
    fail(403, "Discord-rommet styres fra boten eller adminpanelet.");
  await limit(request, "room-actions", 60, 60000);
  const state = JSON.parse(value.state) as RoomState;
  const actorHash = await hash(bearer(request)),
    owner = actorHash === value.owner_hash;
  const host = owner || (state.cohostHashes ?? []).includes(actorHash);
  const action = String(input.action);
  const engineOwner = state.engineOwnerHash ?? value.owner_hash;
  const actor = visitorIdentity(request.headers);
  const participantHash =
    actor && /^[a-f0-9-]{32,40}$/.test(actor)
      ? await hash(code + ":" + actor)
      : "";
  if (
    ["invite", "transfer-invite", "revoke-hosts", "claim-host"].includes(action)
  ) {
    if (action !== "claim-host" && !owner)
      fail(403, "Bare eieren kan dele eller overføre vertsrollen.");
    let token: string | undefined,
      newOwner = value.owner_hash;
    state.engineOwnerHash = engineOwner;
    if (action === "invite") {
      token = secret();
      state.inviteHashes = [
        ...(state.inviteHashes ?? []),
        await hash(token),
      ].slice(-10);
    }
    if (action === "transfer-invite") {
      token = secret();
      state.transferHash = await hash(token);
    }
    if (action === "revoke-hosts") {
      state.cohostHashes = [];
      state.inviteHashes = [];
      delete state.transferHash;
    }
    if (action === "claim-host") {
      const invitation = await hash(String(input.token ?? ""));
      if (
        state.transferHash !== invitation &&
        !(state.inviteHashes ?? []).includes(invitation)
      )
        fail(403, "Invitasjonen er brukt eller ugyldig. Be verten om en ny.");
      token = secret();
      const credential = await hash(token);
      if (state.transferHash === invitation) {
        newOwner = credential;
        state.cohostHashes = [];
        state.inviteHashes = [];
        delete state.transferHash;
      } else {
        state.inviteHashes = (state.inviteHashes ?? []).filter(
          (v) => v !== invitation,
        );
        state.cohostHashes = [...(state.cohostHashes ?? []), credential].slice(
          -10,
        );
      }
    }
    const updated = await db()
      .prepare(
        "UPDATE rooms SET state=?,owner_hash=?,version=version+1 WHERE code=? AND version=?",
      )
      .bind(JSON.stringify(state), newOwner, code, value.version)
      .run();
    if (!updated.meta.changes) fail(409, "Rommet er endret. Prøv igjen.");
    return { token, room: await publicRoom(request, await row(code)) };
  }
  if (action === "visibility") {
    if (!owner) fail(403, "Bare eieren kan endre synligheten.");
    if (typeof input.isPublic !== "boolean")
      fail(400, "Velg offentlig eller privat rom.");
    await db()
      .prepare("UPDATE rooms SET is_public=? WHERE code=?")
      .bind(input.isPublic ? 1 : 0, code)
      .run();
    return { room: await publicRoom(request, await row(code), true, false) };
  }
  if (!host && !guestActions.has(action))
    fail(403, "Bare verten eller medverten kan styre avspillingen.");
  let live: Room | undefined;
  if (coreUrl())
    live = (
      await coreRequest<{ room: Room }>("/v1/rooms", "POST", {
        operation: "import",
        ...value,
        owner_hash: engineOwner,
      })
    ).room;
  if (action === "played") {
    const current = live ?? state;
    if (
      !host ||
      !current.playing ||
      !current.current ||
      input.videoId !== current.current.id
    )
      fail(403, "Spillehendelsen samsvarer ikke med rommet.");
    await recordPlay(
      current.playbackKey ?? `room:${code}:${value.version}`,
      current.current,
      "web",
      Date.now(),
    );
    return { ok: true };
  }
  if (input.version !== (live?.version ?? value.version))
    fail(409, "Rommet er endret. Prøv igjen med den nye køen.");
  let video: Video | undefined;
  if (action === "add" || action === "play-video") {
    if (typeof input.videoId !== "string" || !/^[\w-]{11}$/.test(input.videoId))
      fail(400, "Velg en YouTube-video.");
    video = (await videos(request, [input.videoId]))[0];
    if (!video) fail(404, "Videoen er ikke tilgjengelig.");
  }
  const command = {
    action,
    version: input.version,
    videoId: input.videoId,
    position: input.position,
    index: input.index,
    to: input.to,
    enabled: input.enabled,
    displayName: String(input.displayName ?? "Gjest")
      .trim()
      .slice(0, 32),
    video,
    participantHash,
    actorHash: host ? engineOwner : participantHash,
  };
  if (live) {
    const result = await coreRequest<{ room: Room }>("/v1/rooms", "POST", {
      ...command,
      operation: "mutate",
      code,
    });
    return {
      room: {
        ...result.room,
        isHost: host,
        isOwner: owner,
        isPublic: value.is_public === 1,
      },
    };
  }
  let recommended: Video | null = null;
  if (needsRecommendation(state, command))
    recommended = await roomRecommendation(
      { ...state, ...(command.action === "radio" ? { radio: command.enabled === true } : {}) },
      async (query) => (await searchVideos(request, query, true)).videos,
    );
  const now = Date.now(),
    position =
      state.position +
      (state.playing
        ? Math.max(
            0,
            now -
              Math.max(value.updated_at, state.startsAt ?? value.updated_at),
          ) / 1000
        : 0);
  const emptyEarlyNext = action === "next" && state.current && state.radio !== false &&
    !playableRoomQueue(state).length && !recommended && !finished(state, value.updated_at, now);
  // Match Core: save the normal prefetch cooldown before rejecting an empty
  // early skip. The same revision guard protects a newer pause or radio change.
  const next = changeRoom(state, {
    ...command, action: emptyEarlyNext ? "radio-prefetch" : action, now,
  }, host, position, recommended);
  const result = await db()
    .prepare(
      "UPDATE rooms SET state=?,version=version+1,updated_at=? WHERE code=? AND version=?",
    )
    .bind(JSON.stringify(next), now, code, value.version)
    .run();
  if (!result.meta.changes)
    fail(409, "En annen endring kom først. Prøv igjen.");
  if (emptyEarlyNext)
    fail(422, "Radioen fann ikkje neste låt. Prøv igjen eller legg til ei låt.");
  if (needsRecommendation(state, command) && action === "radio" && command.enabled === true && !recommended)
    fail(422, "Radioen fann ingen passande låtar. Prøv radio igjen eller legg til ei låt.");
  return { room: await publicRoom(request, await row(code), true, false) };
}
export async function adminRooms(request: Request) {
  if (!(await isAdmin(request)))
    fail(403, "Denne siden er bare for administratoren.");
  const all = await db()
    .prepare(
      "SELECT * FROM rooms WHERE expires_at>? ORDER BY updated_at DESC LIMIT 100",
    )
    .bind(Date.now())
    .all<Row>();
  return {
    rooms: await Promise.all(
      all.results.map((r) => publicRoom(request, r, false)),
    ),
  };
}
export async function closeRoom(request: Request, code: string) {
  if (!(await isAdmin(request)))
    fail(403, "Bare administratoren kan avslutte rom.");
  if (code === "DISCORD1" || (await row(code)).guild_id)
    fail(400, "Discord-rommet følger boten og kan ikke avsluttes her.");
  if (coreUrl()) {
    await coreRequest("/v1/rooms", "POST", {
      operation: "import",
      ...(await row(code)),
    });
    await coreRequest("/v1/rooms", "POST", { operation: "close", code });
  }
  await db().batch([
    db().prepare("DELETE FROM rooms WHERE code=?").bind(code),
    db().prepare("DELETE FROM visitors WHERE room=?").bind(code),
  ]);
  return { ok: true };
}
