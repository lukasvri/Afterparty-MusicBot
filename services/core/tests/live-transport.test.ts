import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { ServerResponse } from "node:http";
import WebSocket from "ws";
import { Store } from "../src/store.ts";
import { Providers } from "../src/providers.ts";
import { Engine } from "../src/engine.ts";
import { Commands } from "../src/commands.ts";
import { createServers } from "../src/server.ts";
import { ROOM_LEASE_MS } from "../src/protocol.ts";
import type { Sink } from "../src/audio.ts";
import type { PublicState, Track } from "../src/types.ts";

test("live transports send five periodic snapshots in five seconds and publish controls immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let elapsed = 0;
  t.mock.method(performance, "now", () => elapsed);
  const wallClock = 1000000;
  t.mock.method(Date, "now", () => wallClock + elapsed);
  const store = new Store(":memory:");
  const sink: Sink = {
    onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {},
    duration: () => 0, advancing: () => false, buffering: () => false,
  };
  const engine = new Engine(store, new Providers(store, {}), sink);
  // Drive clock ticks explicitly, independently from audio and wall-clock time.
  clearInterval(engine.timer);
  const commands = new Commands(engine);
  const video: Track = {
    id: "abcdefghijk", entryId: "synthetic-entry", title: "Synthetic video",
    artist: "Synthetic artist", image: "", duration: 100,
    live: false, embeddable: true, concert: true, requestedBy: "private-test-identity",
  };
  engine.connected = true;
  engine.current = video;
  const servers = await createServers(engine, commands, {
    key: "synthetic-key", origin: "https://site.example", passwordHash: "", hosts: [],
    publicPort: 0, adminPort: false, host: "127.0.0.1", privateState: () => ({}),
  });
  const port = (servers.publicServer.address() as { port: number }).port;
  const request = (input: unknown) => fetch(`http://127.0.0.1:${port}/v1/rooms`, {
    method: "POST", headers: { Authorization: "Bearer synthetic-key", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  let socket: WebSocket | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const imported = await request({
      operation: "import", code: "TESTROOM", name: "Synthetic room", owner_hash: "a".repeat(64),
      state: { current: video, queue: [], playing: false, position: 0, radio: false },
      version: 1, updated_at: Date.now(), expires_at: Date.now() + 60000,
    });
    assert.equal(imported.status, 200);
    await imported.json();
    const streamResponse: { current?: ServerResponse } = {};
    servers.publicServer.on("request", (req, res) => {
      if (req.url === "/events?room=TESTROOM") streamResponse.current = res;
    });
    const stream = await fetch(`http://127.0.0.1:${port}/events?room=TESTROOM`, { headers: { Origin: "https://site.example" } });
    assert.equal(stream.status, 200);
    reader = stream.body!.getReader();
    await reader.read();
    assert(streamResponse.current);
    const write = t.mock.method(streamResponse.current, "write");
    socket = new WebSocket(`ws://127.0.0.1:${port}/live`, { origin: "https://site.example" });
    await once(socket, "message");
    const peer = [...servers.wss.clients][0];
    const send = t.mock.method(peer, "send");
    const sentState = () => JSON.parse(String(send.mock.calls.at(-1)!.arguments[0])).state as PublicState;

    // Count actual transport writes while simulating the same ten engine ticks
    // per second as production. This excludes initial connection snapshots.
    for (let i = 0; i < 50; i++) {
      elapsed += 100;
      t.mock.timers.tick(100);
      engine.emit("clock");
    }
    assert.equal(send.mock.callCount(), 5);
    assert.equal(write.mock.callCount(), 5);
    assert.equal(sentState().serverTime, wallClock + 5000);
    for (const call of send.mock.calls)
      assert.doesNotMatch(String(call.arguments[0]), /private-test-identity/);
    for (const call of write.mock.calls) {
      const frame = JSON.parse(String(call.arguments[0]).slice(6));
      assert.equal(frame.room.syncValidForMs, ROOM_LEASE_MS);
      assert.equal(frame.room.position, 0);
    }

    engine.pause();
    assert.equal(send.mock.callCount(), 6, "pause must not wait for a periodic tick");
    assert.equal(sentState().playing, false);
    engine.loading = true;
    engine.emit("clock");
    assert.equal(send.mock.callCount(), 7, "buffering transitions must be immediate");
    assert.equal(sentState().buffering, true);
    engine.loading = false;
    engine.emit("clock");
    assert.equal(send.mock.callCount(), 8);
    assert.equal(sentState().buffering, false);

    const changed = await request({ operation: "mutate", code: "TESTROOM", action: "play", version: 1, actorHash: "a".repeat(64) });
    assert.equal(changed.status, 200);
    const payload = await changed.json() as { room: { startsAt: number; serverTime: number } };
    assert.equal(write.mock.callCount(), 6, "room controls must not wait for a periodic tick");
    assert.equal(payload.room.startsAt, Date.now() + 1500);
    assert.equal(payload.room.serverTime, Date.now());
  } finally {
    await reader?.cancel();
    socket?.terminate();
    await servers.close();
    commands.close();
    engine.close();
    store.close();
  }
});
