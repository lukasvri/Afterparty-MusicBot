import { Catalog } from "./catalog.ts";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Engine } from "./engine.ts";
import { Commands } from "./commands.ts";
import { UserError, publicTrack } from "./types.ts";
import { Social } from "./social.ts";
import { Rooms } from "./rooms.ts";
import type { Guilds, GuildSession } from "./guilds.ts";
import type { DiscordOAuth } from "./oauth.ts";
import { verifyTicket } from "./tickets.ts";
import { LIVE_SNAPSHOT_INTERVAL_MS } from "./protocol.ts";
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}
export async function body(request: IncomingMessage, maximum = 16384) {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw new UserError("The request is too large.", 413);
    parts.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new UserError("Invalid JSON.");
  }
}
type Options = {
  key: string;
  origin: string;
  catalog?: Catalog;
  publicPort?: number;
  guilds?: Guilds;
  oauth?: DiscordOAuth;
  activity?: { enabled: boolean; clientId: string; testGuildIds: string[] };
  applicationId?: () => string;
  isReady?: () => boolean;
  host?: string;
  onRequest?: (ms: number) => void;
};
export async function createServers(
  engine: Engine,
  commands: Commands,
  options: Options,
) {
  if (!options.key) throw new Error("The bridge connection is missing a secret.");
  const catalog = options.catalog ?? new Catalog(engine.store);
  const activity = options.activity;
  const activityReady = Boolean(activity?.enabled === true && /^\d{14,22}$/.test(activity.clientId) && activity.clientId === options.oauth?.clientId && options.oauth?.secret && options.guilds && activity.testGuildIds.length > 0 && activity.testGuildIds.length <= 20 && activity.testGuildIds.every(id => /^\d{14,22}$/.test(id)));
  const rooms = new Rooms(engine.store);
  const social = new Social(engine.store, options.key);
  const socialClients = new Map<ServerResponse, { key: string; host: boolean }>();
  social.on("change", (key, state, reaction) => {
    const payload = JSON.stringify({ social: state });
    for (const [client, access] of socialClients) {
      if (access.key !== key) continue;
      if (client.destroyed || client.writableLength > 16384) {
        if (!reaction) client.destroy();
        continue;
      }
      try { client.write("data: " + payload.slice(0, -1) + ",\"canManage\":" + access.host + "}\n\n"); } catch { client.destroy(); }
    }
  });
  rooms.search = (query) => engine.providers.search(query, 20, true);
  const roomClients = new Map<ServerResponse, string>();
  const roomState = (code: string, joining = false) => ({
    ...rooms.snapshot(code),
    viewers:
      [...roomClients.values()].filter((value) => value === code).length +
      (joining ? 1 : 0),
  });
  const rate = new Map<string, { until: number; count: number }>();
  const socialUnauthorized = new Map<string, { until: number; count: number }>();
  let rejectedUpgrades = 0;
  const upgradeOrigins = new Set<string>();
  const eventClients = new Set<ServerResponse>();
  const eventGuilds = new Map<ServerResponse, string>();
  const socketGuilds = new Map<WebSocket, string>();
  const limit = (key: string, max: number, window = 60000) => {
    const now = Date.now();
    if (rate.size > 2000)
      for (const [k, v] of rate) if (v.until < now) rate.delete(k);
    let v = rate.get(key);
    if (!v || v.until < now) {
      v = { count: 0, until: now + window };
      rate.set(key, v);
    }
    if (++v.count > max)
      throw new UserError("Too many requests. Try again later.", 429);
  };
  const authenticate = (request: IncomingMessage) => {
    const token = String(request.headers.authorization ?? "").replace(
      /^Bearer /,
      "",
    );
    if (!equalSecret(token, options.key))
      throw new UserError("Access denied.", 403);
  };
  const select = (id?: unknown) =>
    options.guilds
      ? options.guilds.get(id)
      : {
          id: "",
          name: "Afterparty",
          roomCode: "DISCORD1",
          engine,
          commands,
          bot: null,
        };
  const snapshot = (session: ReturnType<typeof select>, all = false) =>
    options.guilds
      ? options.guilds.state(session as GuildSession, all)
      : all
        ? session.engine.snapshot()
        : session.engine.websiteSnapshot();
  const execute = (
    id: string,
    input: Record<string, unknown>,
    scope: "public" | "admin",
  ) => {
    const target = select(input.guildId),
      previous = target.engine.store.job(id, input);
    if (!previous) {
      void target.commands
        .execute(input, scope)
        .then((result) => target.engine.store.finishJob(id, "done", result))
        .catch((error) =>
          target.engine.store.finishJob(
            id,
            "failed",
            error instanceof Error ? error.message : "The command failed.",
          ),
        );
    }
    return { id, status: previous?.status ?? "processing" };
  };
  const publicServer = createServer(async (request, response) => {
    const started = performance.now();
    response.once("finish", () =>
      options.onRequest?.(performance.now() - started),
    );
    try {
      const url = new URL(request.url ?? "/", "http://core");
      if (url.pathname === "/v1/activity") {
        try { authenticate(request); } catch (error) { limit("activity-unauthorized", 120); throw error; }
        limit("activity-global", 120);
      }
      if (url.pathname === "/v1/social") {
        // Invalid bridge callers cannot consume the allowance reserved for social
        // participants or playback. Keep their own bounded socket/global guard.
        try { authenticate(request); } catch (error) {
          limit("social-unauthorized-global", 600);
          const now = Date.now(), peer = request.socket.remoteAddress ?? "unknown";
          for (const [id, entry] of socialUnauthorized) if (entry.until <= now) socialUnauthorized.delete(id);
          let entry = socialUnauthorized.get(peer);
          if (!entry) {
            if (socialUnauthorized.size >= 1024) throw new UserError("Too many requests. Try again later.", 429);
            entry = { count: 0, until: now + 60000 }; socialUnauthorized.set(peer, entry);
          }
          if (++entry.count > 120) throw new UserError("Too many requests. Try again later.", 429);
          throw error;
        }
        limit("social-global", 120);
      }
      limit("public:" + request.socket.remoteAddress, 600);
      if (
        request.method === "GET" &&
        ["/events", "/v1/clock"].includes(url.pathname)
      ) {
        if (request.headers.origin !== options.origin)
          throw new UserError("Access denied.", 403);
        response.setHeader("Access-Control-Allow-Origin", options.origin);
        response.setHeader("Vary", "Origin");
        if (url.pathname === "/v1/clock") {
          json(response, 200, { serverTime: Date.now() });
          return;
        }
        if (eventClients.size + roomClients.size + socialClients.size >= 128)
          throw new UserError("Too many connections.", 503);
        const code = url.searchParams.get("room");
        const target = code ? null : select(url.searchParams.get("guildId"));
        const initial = code
          ? { type: "room", room: roomState(code, true) }
          : { type: "state", state: snapshot(target!) };
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
          Connection: "keep-alive",
          "X-Content-Type-Options": "nosniff",
        });
        response.flushHeaders();
        if (code) roomClients.set(response, code);
        else {
          eventClients.add(response);
          eventGuilds.set(response, target!.id);
        }
        response.write("data: " + JSON.stringify(initial) + "\n\n");
        response.once("close", () => {
          eventClients.delete(response);
          eventGuilds.delete(response);
          roomClients.delete(response);
        });
        return;
      }
      if (url.pathname === "/v1/ticket") {
        if (request.headers.origin !== options.origin)
          throw new UserError("Access denied.", 403);
        response.setHeader("Access-Control-Allow-Origin", options.origin);
        response.setHeader("Vary", "Origin");
        if (request.method === "OPTIONS") {
          response.setHeader("Access-Control-Allow-Methods", "POST");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type");
          response.writeHead(204);
          response.end();
          return;
        }
        if (request.method !== "POST")
          throw new UserError("Method not allowed.", 405);
        const input = verifyTicket((await body(request)).ticket, options.key);
        const target = select(input.guildId);
        const id = String(input.id);
        execute(
          id,
          { ...input, bridge: true },
          input.scope === "public" ? "public" : "admin",
        );
        const deadline = Date.now() + 25000;
        while (!response.destroyed && Date.now() < deadline) {
          const job = target.engine.store
            .prepare("SELECT id,status,result FROM jobs WHERE id=?")
            .get(id);
          if (job && job.status !== "processing") {
            json(response, 200, { command: job, state: snapshot(target) });
            return;
          }
          await new Promise((r) => setTimeout(r, 25));
        }
        json(response, 202, {
          command: { id, status: "processing" },
          state: snapshot(target),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/state") {
        const all = url.searchParams.get("all") === "1";
        if (all) authenticate(request);
        json(response, 200, {
          state: snapshot(
            url.searchParams.get("room") && options.guilds
              ? (options.guilds.byRoom(url.searchParams.get("room")!) ??
                  select("invalid"))
              : select(url.searchParams.get("guildId")),
            all,
          ),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, (options.isReady?.() ?? engine.ready) ? 200 : 503, {
          ready: options.isReady?.() ?? engine.ready,
          engine: "gutta-krutt-core",
          audio: {
            buffering: engine.diagnostics.snapshot().buffering,
            interruptions: engine.diagnostics.snapshot().interruptions,
            maxInterruptionMs: engine.diagnostics.snapshot().maxInterruptionMs,
          },
        });
        return;
      }
      if (url.pathname === "/v1/catalog") {
        authenticate(request);
        const query = url.searchParams.get("q"),
          ids = url.searchParams.get("ids");
        if (query && (query.length < 2 || query.length > 120))
          throw new UserError("Enter between 2 and 120 characters.");
        if (ids && !/^[\w,-]{11,600}$/.test(ids))
          throw new UserError("Invalid video IDs.");
        if (request.method !== "GET") throw new UserError("Method not allowed.", 405);
        const controller = new AbortController();
        const cancel = () => { if (!response.writableEnded) controller.abort(); };
        request.once("aborted", cancel);
        response.once("close", cancel);
        try {
          if (request.aborted || response.destroyed) controller.abort();
          const tracks = query || ids ? await catalog.lookup(ids ? { ids: ids.split(",").slice(0, 50) } : { query: query!, preview: url.searchParams.get('preview') === '1' }, controller.signal) : [];
          if (!response.destroyed) json(response, 200, { videos: tracks.map((t) => publicTrack(t)) });
        } finally {
          request.off("aborted", cancel);
          response.off("close", cancel);
        }
        return;
      }
      if (url.pathname === "/v1/application") {
        authenticate(request);
        json(response, 200, {
          clientId: options.applicationId?.() ?? "",
          defaultGuildId: options.guilds?.defaultId ?? "",
          oauthReady: Boolean(options.oauth?.secret),
          guilds: options.guilds?.list() ?? [],
        });
        return;
      }
      if (url.pathname === "/v1/activity") {
        authenticate(request);
        if (request.method !== "POST") throw new UserError("Method not allowed.", 405);
        const input = await body(request, 4096);
        if (input.operation !== "verify") limit("activity-start", 30);
        if (input.operation === "config") {
          json(response, 200, { enabled: activityReady, clientId: activityReady ? activity!.clientId : "" });
          return;
        }
        if (!activityReady) throw new UserError("Activity test mode is disabled.", 503);
        if (!["exchange", "verify"].includes(String(input.operation))) throw new UserError("Invalid Activity operation.");
        if (typeof input.guildId !== "string" || !/^\d{14,22}$/.test(input.guildId) || !activity!.testGuildIds.includes(input.guildId)) throw new UserError("This server is not enabled for Activity tests.", 403);
        const target = options.guilds!.get(input.guildId);
        if (input.operation === "exchange") limit("activity-exchange", 12);
        const result = input.operation === "verify"
          ? await options.oauth!.verifyActivity(input.tokenCipher, target.id)
          : await options.oauth!.exchangeActivity(input.code, target.id);
        // Recheck installation after asynchronous identity verification.
        if (options.guilds!.get(target.id) !== target) throw new UserError("The test server changed. Try again.", 409);
        json(response, 200, { ...result, guild: { id: target.id, name: target.name, roomCode: target.roomCode } });
        return;
      }
      if (url.pathname === "/v1/oauth") {
        authenticate(request);
        if (request.method !== "POST" || !options.oauth)
          throw new UserError("Discord sign-in is not configured.", 503);
        const input = await body(request);
        json(
          response,
          200,
          input.operation === "exchange"
            ? await options.oauth.exchange(input.code)
            : await options.oauth.guilds(input.tokenCipher),
        );
        return;
      }
      if (url.pathname === "/v1/admin") {
        authenticate(request);
        const input =
          request.method === "GET"
            ? {
                guildId: url.searchParams.get("guildId"),
                tokenCipher: request.headers["x-discord-grant"],
              }
            : await body(request, 65536);
        const target = select(input.guildId);
        if (input.tokenCipher) {
          if (!options.oauth) throw new UserError("Access denied.", 403);
          await options.oauth.require(input.tokenCipher, target.id);
        } else if (options.guilds && target.id !== options.guilds.defaultId)
          throw new UserError(
            "Discord sign-in is required for this server.",
            403,
          );
        if (request.method === "GET") {
          json(response, 200, {
            ...target.bot?.privateState(),
            state: snapshot(target, true),
            audio: {
              ...target.engine.diagnostics.snapshot(),
              ...target.engine.sink.diagnostics?.(),
            },
            guildId: target.id,
            roomCode: target.roomCode,
            commands: target.engine.store.jobs(),
          });
          return;
        }
        if (input.operation === "settings") {
          json(response, 200, {
            settings: target.commands.updateSettings(
              input.settings as Record<string, unknown>,
            ),
          });
          return;
        }
        if (input.operation === "channels") {
          const guild = target.bot?.client.guilds.cache.get(target.id);
          json(response, 200, {
            channels: guild
              ? [...guild.channels.cache.values()]
                  .filter((c) => c.isTextBased() || c.isVoiceBased())
                  .map((c) => ({
                    id: c.id,
                    name: c.name,
                    voice: c.isVoiceBased(),
                  }))
              : [],
          });
          return;
        }
        if (input.operation === "join") {
          const channel = target.bot?.client.guilds.cache
            .get(target.id)
            ?.channels.cache.get(String(input.channelId));
          if (!channel?.isVoiceBased())
            throw new UserError("Choose a voice channel on this server.");
          await target.bot!.join(channel);
          json(response, 200, { ok: true });
          return;
        }
        if (input.operation === "music-channel") {
          const channel = target.bot?.client.guilds.cache
            .get(target.id)
            ?.channels.cache.get(String(input.channelId));
          if (!channel?.isTextBased() || !("send" in channel))
            throw new UserError("Choose a text channel on this server.");
          target.bot!.musicChannelId = channel.id;
          target.engine.store.set("music-channel", channel.id);
          json(response, 200, { ok: true });
          return;
        }
        if (input.operation === "command") {
          const id = String(input.commandId ?? "");
          if (!/^[a-f0-9-]{36}$/.test(id))
            throw new UserError("Invalid command ID.");
          const command = {
            ...(input.command as Record<string, unknown>),
            guildId: target.id,
          };
          json(response, 200, execute(id, command, "admin"));
          return;
        }
        throw new UserError("Unknown administration action.");
      }
      if (url.pathname === "/v1/concert-queue") {
        authenticate(request);
        const input = await body(request);
        const target = select(input.guildId);
        const admin = input.admin === true;
        if (admin) {
          if (input.tokenCipher) {
            if (!options.oauth) throw new UserError("Access denied.", 403);
            await options.oauth.require(input.tokenCipher, target.id);
          } else if (options.guilds && target.id !== options.guilds.defaultId)
            throw new UserError(
              "Discord sign-in is required for this server.",
              403,
            );
        }
        const queue = target.commands.concertQueue;
        const state =
          input.action === "read"
            ? queue.snapshot()
            : await target.engine.serialize(() => queue.apply(input, admin));
        json(response, 200, { state, canManage: admin });
        return;
      }
      if (url.pathname === "/v1/social") {
        authenticate(request);
        if (request.method !== "POST") throw new UserError("Method not allowed.", 405);
        const input = await body(request, 8192);
        let host = false;
        let playback: { playbackKey: string | null; videoId: string | null; position: number };
        if (input.scope === "room") {
          if (typeof input.scopeId !== "string" || !/^[A-Z0-9]{8}$/.test(input.scopeId) || input.scopeId === "DISCORD1" || options.guilds?.byRoom(input.scopeId)) throw new UserError("Invalid browser room.", 404);
          const state = rooms.snapshot(input.scopeId);
          playback = { playbackKey: state.playbackKey ?? null, videoId: state.current?.id ?? null, position: state.position };
          host = input.host === true;
        } else if (input.scope === "guild") {
          if (typeof input.scopeId !== "string" || !/^\d{14,22}$/.test(input.scopeId) || !options.oauth) throw new UserError("Discord sign-in required.", 403);
          const target = select(input.scopeId);
          if (target.id !== input.scopeId) throw new UserError("Invalid server.", 403);
          const grant = options.oauth.open(input.tokenCipher);
          if (grant.activityGuildId && (!activityReady || !activity!.testGuildIds.includes(target.id))) throw new UserError("Activity test mode is disabled for this server.", 403);
          const access = await options.oauth.member(input.tokenCipher, target.id);
          host = access.canManage;
          const state = snapshot(target);
          playback = { playbackKey: state.playbackKey, videoId: state.current?.id ?? null, position: state.position };
        } else throw new UserError("Invalid social scope.");
        // OAuth membership can outlive a disconnected HTTP client. Do not create
        // state, retain a dead stream, or attach cleanup after close already fired.
        if (request.aborted || response.destroyed) return;
        const result = { ...social.apply(input, playback, host), canManage: host };
        if (input.action === "stream") {
          if (socialClients.size >= 64 || socialClients.size + eventClients.size + roomClients.size >= 128) throw new UserError("Social connections are busy.", 503);
          response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" });
          response.flushHeaders();
          socialClients.set(response, { key: input.scope + ":" + input.scopeId, host });
          response.write("data: " + JSON.stringify(result) + "\n\n");
          const heartbeat = setInterval(() => {
            if (response.writableLength > 16384) response.destroy();
            else response.write(": heartbeat\n\n");
          }, 15000);
          const expiry = setTimeout(() => response.end(), 60000);
          response.once("close", () => { clearInterval(heartbeat); clearTimeout(expiry); socialClients.delete(response); });
        } else json(response, 200, result);
        return;
      }
      if (url.pathname === "/v1/rooms") {
        authenticate(request);
        if (request.method !== "POST")
          throw new UserError("Method not allowed.", 405);
        const input = await body(request, 1048576),
          code = String(input.code ?? "");
        if (input.operation === "import") {
          json(response, 200, { room: rooms.import(input) });
          return;
        }
        if (input.operation === "read") {
          json(response, 200, { room: rooms.snapshot(code) });
          return;
        }
        if (input.operation === "close") {
          rooms.close(code);
          json(response, 200, { ok: true });
          return;
        }
        if (input.operation === "mutate") {
          json(response, 200, { room: await rooms.control(code, input) });
          return;
        }
        throw new UserError("Unknown room action.");
      }
      if (!["/v1/command", "/v1/jobs"].includes(url.pathname)) {
        json(response, 404, { error: "Endpoint not found." });
        return;
      }
      authenticate(request);
      if (request.method === "POST" && url.pathname === "/v1/command") {
        const input = await body(request);
        const id = String(input.id ?? "");
        if (!/^(?:public:)?[a-f0-9-]{36}$/.test(id))
          throw new UserError("Invalid command ID.");
        const scope = input.scope === "public" ? "public" : "admin";
        if (
          scope === "public" &&
          !["enqueue", "skip", "pause", "resume"].includes(String(input.action))
        )
          throw new UserError("Access to this action is denied.", 403);
        json(response, 200, execute(id, input, scope));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/jobs") {
        authenticate(request);
        if (url.searchParams.get("diagnostics") === "1") {
          json(response, 200, {
            clients: wss.clients.size,
            httpStreams: eventClients.size,
            rejectedUpgrades,
            origins: [...upgradeOrigins],
          });
          return;
        }
        const target = select(url.searchParams.get("guildId")),
          id = url.searchParams.get("id");
        json(
          response,
          200,
          id
            ? {
                command:
                  target.engine.store
                    .prepare("SELECT id,status,result FROM jobs WHERE id=?")
                    .get(id) ?? null,
              }
            : { commands: target.engine.store.jobs() },
        );
        return;
      }
      json(response, 405, { error: "Method not allowed." });
    } catch (error) {
      json(response, error instanceof UserError ? error.status : 500, {
        error:
          error instanceof UserError
            ? error.message
            : "The service could not complete the request.",
      });
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2048,
    perMessageDeflate: false,
  });
  publicServer.on("upgrade", (request, socket, head) => {
    const origin = String(request.headers.origin ?? "missing").slice(0, 200);
    if (upgradeOrigins.size < 10) upgradeOrigins.add(origin);
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://core");
    } catch {
      rejectedUpgrades++;
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (
      url.pathname !== "/live" ||
      request.headers.origin !== options.origin ||
      wss.clients.size >= 128
    ) {
      rejectedUpgrades++;
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    try {
      limit("upgrade:" + request.socket.remoteAddress, 120);
    } catch {
      socket.destroy();
      return;
    }
    let target;
    try {
      target = select(url.searchParams.get("guildId"));
    } catch {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      socketGuilds.set(ws, target.id);
      wss.emit("connection", ws, request);
    });
  });
  wss.on("connection", (ws) => {
    ws.send(
      JSON.stringify({
        type: "state",
        state: snapshot(select(socketGuilds.get(ws))),
      }),
    );
    ws.on("close", () => socketGuilds.delete(ws));
    let count = 0,
      reset = Date.now();
    ws.on("message", (raw) => {
      if (Date.now() - reset > 10000) {
        count = 0;
        reset = Date.now();
      }
      if (++count > 30) {
        ws.close(1008);
        return;
      }
      try {
        const value = JSON.parse(raw.toString());
        if (value.type !== "ping" || !Number.isFinite(value.sent))
          throw new Error();
        ws.send(
          JSON.stringify({
            type: "pong",
            sent: value.sent,
            serverTime: Date.now(),
          }),
        );
      } catch {
        ws.close(1008);
      }
    });
  });
  const broadcast = (guildId?: string) => {
    const snapshots = new Map<string, string>();
    const payload = (id: string) => {
      let p = snapshots.get(id);
      if (!p) {
        p = JSON.stringify({ type: "state", state: snapshot(select(id)) });
        snapshots.set(id, p);
      }
      return p;
    };
    for (const client of eventClients) {
      const id = eventGuilds.get(client) ?? "";
      if (guildId && id !== guildId) continue;
      if (client.destroyed || client.writableLength > 65536) {
        client.destroy();
        eventClients.delete(client);
        eventGuilds.delete(client);
      } else {
        try {
          client.write("data: " + payload(id) + "\n\n");
        } catch {
          client.end();
        }
      }
    }
    for (const ws of wss.clients) {
      const id = socketGuilds.get(ws) ?? "";
      if (guildId && id !== guildId) continue;
      if (ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > 65536) {
          ws.terminate();
          continue;
        }
        try {
          ws.send(payload(id));
        } catch {
          ws.close(1001);
        }
      }
    }
  };
  const roomBroadcast = (only?: string) => {
    const snapshots = new Map<string, string>();
    for (const [client, code] of roomClients) {
      if (only && code !== only) continue;
      if (client.destroyed || client.writableLength > 65536) {
        client.destroy();
        roomClients.delete(client);
        continue;
      }
      try {
        let payload = snapshots.get(code);
        if (!payload) {
          payload =
            "data: " +
            JSON.stringify({ type: "room", room: roomState(code) }) +
            "\n\n";
          snapshots.set(code, payload);
        }
        client.write(payload);
      } catch {
        client.end();
        roomClients.delete(client);
      }
    }
  };
  rooms.on("change", roomBroadcast);
  const roomClock = setInterval(roomBroadcast, LIVE_SNAPSHOT_INTERVAL_MS);
  const roomAdvance = setInterval(() => {
    void rooms.tick().catch(() => {});
  }, 500);
  const subscriptions = new Map<
    Engine,
    { state: () => void; clock: () => void }
  >();
  const subscribe = (source: Engine, id = "") => {
    let last = performance.now();
    let buffering = source.loading || source.sink.buffering();
    const state = () => {
        last = performance.now();
        buffering = source.loading || source.sink.buffering();
        broadcast(id);
      },
      clock = () => {
        // Buffering pauses the shared timeline, so do not wait for the next
        // periodic snapshot to tell clients that audible playback has stopped.
        const nextBuffering = source.loading || source.sink.buffering();
        if (
          nextBuffering !== buffering ||
          performance.now() - last >= LIVE_SNAPSHOT_INTERVAL_MS
        ) state();
      };
    source.on("state", state);
    source.on("clock", clock);
    subscriptions.set(source, { state, clock });
  };
  const added = (s: GuildSession) => subscribe(s.engine, s.id),
    removed = (s: GuildSession) => {
      const listeners = subscriptions.get(s.engine);
      if (listeners) {
        s.engine.off("state", listeners.state);
        s.engine.off("clock", listeners.clock);
        subscriptions.delete(s.engine);
      }
      for (const [client, id] of eventGuilds)
        if (id === s.id) {
          client.end();
          eventGuilds.delete(client);
          eventClients.delete(client);
        }
      for (const [socket, id] of socketGuilds)
        if (id === s.id) socket.close(1001);
    };
  if (options.guilds) {
    for (const s of options.guilds.sessions.values()) added(s);
    options.guilds.on("added", added);
    options.guilds.on("removed", removed);
  } else subscribe(engine);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const target = ws as WebSocket & { alive?: boolean };
      if (target.alive === false) {
        ws.terminate();
        continue;
      }
      target.alive = false;
      ws.ping();
    }
  }, 20000);
  wss.on("connection", (ws) => {
    (ws as WebSocket & { alive?: boolean }).alive = true;
    ws.on("pong", () => {
      (ws as WebSocket & { alive?: boolean }).alive = true;
    });
  });
  publicServer.requestTimeout = 15000;
  publicServer.headersTimeout = 10000;
  publicServer.on("clientError", (_e, socket) => socket.destroy());
  let closePromise: Promise<void> | undefined;
  const close = (failedStartup = false) =>
    (closePromise ??= (async () => {
      clearInterval(heartbeat);
      clearInterval(roomClock);
      clearInterval(roomAdvance);
      rooms.dispose();
      for (const client of socialClients.keys()) client.end();
      socialClients.clear();
      social.removeAllListeners();
      for (const client of roomClients.keys()) client.end();
      roomClients.clear();
      for (const [source, listeners] of subscriptions) {
        source.off("state", listeners.state);
        source.off("clock", listeners.clock);
      }
      subscriptions.clear();
      options.guilds?.off("added", added);
      options.guilds?.off("removed", removed);
      for (const ws of wss.clients) {
        if (failedStartup) ws.terminate();
        else ws.close(1001);
      }
      wss.close();
      for (const client of eventClients) client.end();
      eventClients.clear();
      await new Promise<void>((resolve) => {
        publicServer.close(() => resolve());
        if (failedStartup) publicServer.closeAllConnections();
      });
    })());
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        publicServer.off("listening", onListening);
        publicServer.off("error", onError);
        reject(error);
      };
      const onListening = () => {
        publicServer.off("error", onError);
        resolve();
      };
      publicServer.once("error", onError);
      publicServer.once("listening", onListening);
      try {
        publicServer.listen(options.publicPort ?? 3990, options.host ?? "0.0.0.0");
      } catch (error) {
        onError(error as Error);
      }
    });
  } catch (error) {
    await close(true);
    throw error;
  }
  return { publicServer, wss, close: () => { catalog.close(); return close(); } };
}
