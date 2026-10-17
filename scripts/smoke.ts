import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Room, Video } from "../lib/types.ts";

type CreatedRoom = { room: Room; token: string };
type RoomMutation = { room: Room };
type PublicRoom = Room & { owner_hash?: unknown; token?: unknown };
type SearchResult = { videos: Video[] };
type AdminRooms = { rooms: Array<Pick<Room, "code">> };

const base = process.env.AFTERPARTY_TEST_URL ?? process.env.MUSE_TEST_URL ?? "http://127.0.0.1:5173";
const envfile = process.env.SMOKE_ENV_FILE ?? ".dev.vars";
const values = Object.fromEntries(
  readFileSync(envfile, "utf8").split("\n").filter((line) => line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")];
  }),
);
const bridge = values.ADMIN_BRIDGE_KEY ?? values.PUBLIC_SITE_ADMIN_KEY;
const guest = { "Content-Type": "application/json", "X-Afterparty-Visitor": randomUUID() };
let code: string | undefined;
let checks = 0;

async function req<T = unknown>(path: string, options: RequestInit = {}): Promise<{ status: number; data: T }> {
  const response = await fetch(base + path, {
    headers: guest, signal: AbortSignal.timeout(20000), ...options,
  });
  const raw = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw };
  }
  return { status: response.status, data: data as T };
}

function check(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label);
  checks++;
  console.log("PASS " + label);
}

try {
  const anonymous = await req("/api/admin/rooms");
  check(anonymous.status, 403, "Anonymous admin access rejected");

  const created = await req<CreatedRoom>("/api/rooms", {
    method: "POST", body: JSON.stringify({ name: "Kontrollrom for testing" }),
  });
  check(created.status, 200, "Create durable room");
  code = created.data.room.code;
  const token = created.data.token;
  assert.match(code, /^[A-Z0-9]{8}$/);
  assert.equal(token.length, 64);
  checks++;
  const host = { ...guest, Authorization: `Bearer ${token}` };
  const guest2 = { ...guest, "X-Afterparty-Visitor": randomUUID() };

  const initial = await req<PublicRoom>(`/api/rooms/${code}`, { headers: host });
  check(initial.data.isHost, true, "Host role resolved from secret");
  assert.equal(initial.data.owner_hash, undefined);
  assert.equal(initial.data.token, undefined);
  checks++;
  let room: Room = initial.data;

  const guestPlay = await req(`/api/rooms/${code}`, {
    method: "POST", body: JSON.stringify({ version: room.version, action: "play" }),
  });
  check(guestPlay.status, 403, "Guests cannot control playback");
  const foreign = await req(`/api/rooms/${code}`, {
    method: "POST", headers: { ...host, Origin: "https://foreign.example" },
    body: JSON.stringify({ version: room.version, action: "add", videoId: "K4DyBUG242c" }),
  });
  check(foreign.status, 403, "Foreign-origin mutation rejected");

  const search = await req<SearchResult>("/api/search?q=Cartoon%20On%20%26%20On");
  check(search.status, 200, "Real YouTube song search");
  assert(search.data.videos.some((video) => video.id.length === 11));
  checks++;
  const nextVideo = search.data.videos.find((video) => video.id !== "K4DyBUG242c");
  assert(nextVideo, "Search provides another video for skip verification");

  const first = await req<RoomMutation>(`/api/rooms/${code}`, {
    method: "POST", headers: guest2,
    body: JSON.stringify({ version: room.version, action: "add", videoId: "K4DyBUG242c" }),
  });
  check(first.status, 200, "Guest can add a trusted YouTube video");
  room = first.data.room;
  assert(room.current);
  check(room.current.id, "K4DyBUG242c", "First video becomes current");
  const seen = await req<Room>(`/api/rooms/${code}`, { headers: guest2 });
  assert(seen.data.current);
  check(seen.data.current.id, room.current.id, "Second participant sees shared state");
  check(seen.data.isHost, false, "Guest role stays restricted");
  check(seen.data.viewers >= 2, true, "Actual participant presence");

  const stale = await req(`/api/rooms/${code}`, {
    method: "POST", headers: host,
    body: JSON.stringify({ version: room.version - 1, action: "play" }),
  });
  check(stale.status, 409, "Stale version cannot overwrite room");
  const play = await req<RoomMutation>(`/api/rooms/${code}`, {
    method: "POST", headers: host,
    body: JSON.stringify({ version: room.version, action: "play" }),
  });
  check(play.status, 200, "Host starts shared playback");
  room = play.data.room;
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, (room.startsAt ?? 0) - Date.now()) + 650));
  const playing = await req<Room>(`/api/rooms/${code}`, { headers: guest2 });
  check(playing.data.position > room.position, true, "Server advances shared timeline after scheduled start");

  const concurrent = await Promise.all(["pause", "seek"].map((action) => req(`/api/rooms/${code}`, {
    method: "POST", headers: host,
    body: JSON.stringify({ version: room.version, action, position: 12 }),
  })));
  check(concurrent.map((response) => response.status).sort(), [200, 409], "Concurrent actions have one winner");
  room = (await req<Room>(`/api/rooms/${code}`, { headers: host })).data;

  const seek = await req<RoomMutation>(`/api/rooms/${code}`, {
    method: "POST", headers: host,
    body: JSON.stringify({ version: room.version, action: "seek", position: 20 }),
  });
  check(seek.status, 200, "Host seeks shared video");
  room = seek.data.room;
  check(room.position >= 20 && room.position < 21, true, "Seek position stored accurately");
  const second = await req<RoomMutation>(`/api/rooms/${code}`, {
    method: "POST", headers: host,
    body: JSON.stringify({ version: room.version, action: "add", videoId: nextVideo.id }),
  });
  check(second.status, 200, "Second video added to shared queue");
  room = second.data.room;

  const guestNext = await req(`/api/rooms/${code}`, {
    method: "POST", headers: guest2,
    body: JSON.stringify({ version: room.version, action: "next" }),
  });
  check(guestNext.status, 403, "Guest cannot skip host video");
  const skipped = await req<RoomMutation>(`/api/rooms/${code}`, {
    method: "POST", headers: host,
    body: JSON.stringify({ version: room.version, action: "next" }),
  });
  check(skipped.status, 200, "Host skips shared video");
  room = skipped.data.room;
  assert(room.current);
  check(room.current.id, nextVideo.id, "Skip advances to queued video");
  const afterSkip = await req<Room>(`/api/rooms/${code}`, { headers: guest2 });
  assert(afterSkip.data.current);
  check(afterSkip.data.current.id, nextVideo.id, "Second participant sees skipped video");
  const guestClear = await req(`/api/rooms/${code}`, {
    method: "POST", headers: guest2,
    body: JSON.stringify({ version: room.version, action: "clear" }),
  });
  check(guestClear.status, 403, "Guests cannot clear queue");

  const admin = await req<AdminRooms>("/api/admin/rooms", { headers: { Authorization: `Bearer ${bridge}` } });
  check(admin.status, 200, "Private admin bridge authorized");
  assert(admin.data.rooms.some((room) => room.code === code));
  checks++;
  const invalidVideo = await req("/api/videos?ids=bad");
  check(invalidVideo.status, 400, "Invalid video URL rejected");
  const malformed = await req("/api/rooms", { method: "POST", body: "[" });
  check(malformed.status, 400, "Malformed request rejected");
  const oversized = await req("/api/rooms", {
    method: "POST", body: JSON.stringify({ name: "x".repeat(17000) }),
  });
  check(oversized.status, 413, "Oversized request bounded");
  console.log(`RESULT ${checks} checks passed at ${base}`);
} finally {
  if (code) {
    const cleaned = await req("/api/admin/rooms", {
      method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bridge}` },
      body: JSON.stringify({ code }),
    });
    assert.equal(cleaned.status, 200, "Disposable test room cleaned up");
    console.log("Disposable room cleaned up");
  }
}
