import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { Rooms } from "../src/rooms.ts";
import { deferred } from "./deferred.ts";
import type { RoomVideo } from "../src/protocol.ts";
import { roomRecommendation } from "../src/room-radio.ts";
const video = {
  id: "M7lc1UVf-VE",
  title: "Example",
  artist: "YouTube",
  image: "",
  duration: 60,
  live: false,
  embeddable: true,
};

test("room scheduling uses the playing-room expiry index without rewriting durable rooms", () => {
  const store = new Store(":memory:"), rooms = new Rooms(store, () => 10000);
  try {
    const insert = store.prepare("INSERT INTO video_rooms(code,data) VALUES(?,?)");
    for (let i = 0; i < 100; i++) insert.run(`R${String(i).padStart(7,"0")}`, JSON.stringify({ expiresAt: i % 3 ? 20000 : 9000, state: { playing: i % 2 === 0 } }));
    const query = "SELECT data FROM video_rooms WHERE json_extract(data,'$.expiresAt')>? AND json_extract(data,'$.state.playing')=1";
    const plan = JSON.stringify(store.prepare("EXPLAIN QUERY PLAN " + query).all(10000));
    assert.match(plan, /video_rooms_playing_expiry/);
    assert.equal(store.prepare(query).all(10000).length, 33);
    assert.equal(store.prepare("SELECT count(*) AS n FROM video_rooms").get()!.n, 100);
  } finally { rooms.dispose(); store.close(); }
});
test("one persisted room clock, shared start deadline, host protection and queue races", () => {
  const store = new Store(":memory:");
  let now = 10000;
  const rooms = new Rooms(store, () => now);
  try {
    const input = {
      code: "TESTROOM",
      name: "Test",
      owner_hash: "a".repeat(64),
      state: { current: video, queue: [], position: 0, playing: false },
      version: 1,
      updated_at: now,
      expires_at: 100000,
    };
    rooms.import(input);
    assert.throws(() =>
      rooms.mutate("TESTROOM", {
        action: "play",
        version: 1,
        actorHash: "bad",
      }),
    );
    const started = rooms.mutate("TESTROOM", {
      action: "play",
      version: 1,
      actorHash: "a".repeat(64),
    });
    assert.equal(started.startsAt, 11500);
    now = 11000;
    assert.equal(rooms.snapshot("TESTROOM").position, 0);
    now = 12000;
    assert.equal(rooms.snapshot("TESTROOM").position, 0.5);
    const paused = rooms.mutate("TESTROOM", {
      action: "pause",
      version: 2,
      actorHash: "a".repeat(64),
    });
    now = 13000;
    assert.equal(rooms.snapshot("TESTROOM").position, 0.5);
    assert.equal(paused.playing, false);
    assert.throws(() =>
      rooms.mutate("TESTROOM", {
        action: "play",
        version: 2,
        actorHash: "a".repeat(64),
      }),
    );
    const recovered = new Rooms(store, () => now);
    assert.equal(recovered.snapshot("TESTROOM").position, 0.5);
    assert(
      !JSON.stringify(recovered.snapshot("TESTROOM")).includes("ownerHash"),
    );
    rooms.import(input);
    assert.equal(rooms.snapshot("TESTROOM").version, 3);
  } finally {
    store.close();
  }
});

const seed = {
  ...video,
  id: "seed1234567",
  title: "Syn Cole - Feel Good | Future House | NCS - Copyright Free",
  artist: "NCS",
  duration: 200,
};
const next = {
  ...video,
  id: "next1234567",
  title: "Other Artist - Synthetic Next | Future House",
  artist: "NCS",
  duration: 200,
};
function setup() {
  const store = new Store(":memory:"),
    rooms = new Rooms(store, () => 10000);
  rooms.import({
    code: "TESTROOM",
    name: "Synthetic room",
    owner_hash: "a".repeat(64),
    state: { current: seed, queue: [], position: 100, playing: true },
    version: 1,
    updated_at: 10000,
    expires_at: 100000,
  });
  return {
    store,
    rooms,
    input: { action: "next", version: 1, actorHash: "a".repeat(64) },
  };
}

test("own-room radio continues an empty queue and retains its shared clock", async () => {
  const { store, rooms, input } = setup();
  try {
    rooms.search = async (query) => {
      assert.equal(query, 'future house audio -"Feel Good"');
      return [next];
    };
    const state = await rooms.control("TESTROOM", input);
    assert.equal(state.current?.id, next.id);
    assert.equal(state.radio, true);
    assert.equal(state.playing, true);
    assert.equal(state.startsAt, 11500);
    assert.equal(
      new Rooms(store, () => 10000).snapshot("TESTROOM").current?.id,
      next.id,
    );
    assert(!JSON.stringify(state).includes("ownerHash"));
    assert(!JSON.stringify(state).includes("radioHistory"));
  } finally {
    store.close();
  }
});

test("manual queue and radio-off preference take precedence without a lookup", async () => {
  for (const mode of ["manual", "off"]) {
    const { store, rooms, input } = setup();
    try {
      let calls = 0;
      rooms.search = async () => {
        calls++;
        return [next];
      };
      if (mode === "manual")
        rooms.mutate("TESTROOM", { action: "add", version: 1, video: next });
      else
        rooms.mutate("TESTROOM", {
          action: "radio",
          version: 1,
          actorHash: input.actorHash,
          enabled: false,
        });
      const state = await rooms.control("TESTROOM", { ...input, version: 2 });
      assert.equal(calls, 0);
      assert.equal(state.current?.id, mode === "manual" ? next.id : undefined);
      assert.equal(state.radio, mode === "manual");
    } finally {
      store.close();
    }
  }
});

test("guest and stale room-radio requests cannot spend a provider lookup", async () => {
  const { store, rooms, input } = setup();
  try {
    let calls = 0;
    rooms.search = async () => {
      calls++;
      return [next];
    };
    await assert.rejects(
      rooms.control("TESTROOM", { ...input, actorHash: "guest" }),
      /verten/,
    );
    await assert.rejects(
      rooms.control("TESTROOM", { ...input, version: 0 }),
      /endret/,
    );
    assert.equal(calls, 0);
  } finally {
    store.close();
  }
});

test("a late own-room radio result cannot replace a newer queue or pause", async () => {
  for (const action of ["add", "pause", "radio"]) {
    const { store, rooms, input } = setup(),
      pending = deferred<RoomVideo[]>();
    try {
      rooms.search = () => pending.promise;
      const result = rooms.control("TESTROOM", input);
      rooms.mutate("TESTROOM", {
        ...input,
        action,
        video: next,
        enabled: false,
      });
      pending.resolve([next]);
      await assert.rejects(result, /endret/);
      const state = rooms.snapshot("TESTROOM");
      assert.equal(state.current?.id, seed.id);
      if (action === "add") assert.equal(state.queue[0]?.id, next.id);
      if (action === "pause") assert.equal(state.playing, false);
      if (action === "radio") assert.equal(state.radio, false);
    } finally {
      store.close();
    }
  }
});

test("shared room recommendation filters repeats, live and blocked videos", async () => {
  const blocked = { ...next, embeddable: false };
  assert.equal(
    await roomRecommendation({ current: seed, queue: [] }, async () => [
      seed,
      blocked,
      { ...next, live: true },
    ]),
    null,
  );
  assert.equal(
    await roomRecommendation(
      { current: seed, queue: [], radioHistory: [next] },
      async () => [next],
    ),
    null,
  );
  const selected = await roomRecommendation(
    { current: seed, queue: [] },
    async () => [next],
  );
  assert.equal(selected?.id, next.id);
});

test("a failed own-room recommendation preserves the seed and can be retried", async () => {
  const { store, rooms, input } = setup();
  try {
    rooms.search = async () => {
      throw new Error("Synthetic provider failure");
    };
    await assert.rejects(
      rooms.control("TESTROOM", input),
      /Synthetic provider failure/,
    );
    assert.equal(rooms.snapshot("TESTROOM").version, 1);
    assert.equal(rooms.snapshot("TESTROOM").current?.id, seed.id);
    rooms.search = async () => [next];
    assert.equal((await rooms.control("TESTROOM", input)).current?.id, next.id);
  } finally {
    store.close();
  }
});

test("clock advances without a host, once, and survives a restart", async () => {
  const store = new Store(":memory:");
  let now = 10000;
  let rooms = new Rooms(store, () => now);
  try {
    rooms.import({
      code: "TESTROOM",
      name: "Clock",
      owner_hash: "a".repeat(64),
      state: {
        current: video,
        queue: [next],
        playing: true,
        position: 0,
        radio: false,
      },
      version: 1,
      updated_at: now,
      expires_at: 1000000,
    });
    now += 61000;
    await Promise.all([rooms.tick(), rooms.tick()]);
    assert.equal(rooms.snapshot("TESTROOM").current?.id, next.id);
    assert.equal(rooms.snapshot("TESTROOM").version, 2);
    rooms.dispose();
    rooms = new Rooms(store, () => now);
    assert.equal(rooms.snapshot("TESTROOM").current?.id, next.id);
    now += 202000;
    await rooms.tick();
    assert.equal(rooms.snapshot("TESTROOM").current, null);
    assert.equal(rooms.snapshot("TESTROOM").playing, false);
  } finally {
    rooms.dispose();
    store.close();
  }
});
test("automatic radio cannot override a newer pause and failed radio ends cleanly", async () => {
  const store = new Store(":memory:");
  let now = 10000;
  const rooms = new Rooms(store, () => now);
  try {
    rooms.import({
      code: "TESTROOM",
      name: "Clock",
      owner_hash: "a".repeat(64),
      state: { current: video, queue: [], playing: true, position: 0 },
      version: 1,
      updated_at: now,
      expires_at: 1000000,
    });
    const gate = deferred<RoomVideo[]>();
    rooms.search = () => gate.promise;
    now += 61000;
    const tick = rooms.tick();
    rooms.mutate("TESTROOM", {
      action: "pause",
      version: 1,
      actorHash: "a".repeat(64),
    });
    gate.resolve([next]);
    await tick;
    assert.equal(rooms.snapshot("TESTROOM").playing, false);
    assert.equal(rooms.snapshot("TESTROOM").current?.id, video.id);
    rooms.mutate("TESTROOM", {
      action: "play",
      version: 2,
      actorHash: "a".repeat(64),
    });
    rooms.search = async () => {
      throw Error("offline");
    };
    now += 2000;
    await rooms.tick();
    assert.equal(rooms.snapshot("TESTROOM").current, null);
  } finally {
    rooms.dispose();
    store.close();
  }
});
test("moderation, participant votes and queue undo never expose identities", () => {
  const { store, rooms, input } = setup();
  try {
    let version = 1;
    const act = (
      action: string,
      extra: Record<string, unknown> = {},
      host = true,
    ) =>
      rooms.mutate("TESTROOM", {
        action,
        version: version++,
        actorHash: host ? input.actorHash : "guest",
        ...extra,
      });
    act("approval", { enabled: true });
    const requested = act(
      "add",
      { video: next, displayName: "Synthetic guest" },
      false,
    );
    assert.equal(requested.queue.length, 0);
    assert.equal(requested.requests?.length, 1);
    assert.throws(
      () =>
        rooms.mutate("TESTROOM", {
          action: "approve",
          videoId: next.id,
          version: 3,
          actorHash: "guest",
        }),
      /verten/,
    );
    act("approve", { videoId: next.id });
    assert.equal(
      rooms.snapshot("TESTROOM").queue[0].requestedBy,
      "Synthetic guest",
    );
    act("vote", { videoId: next.id, participantHash: "b".repeat(64) }, false);
    assert.equal(rooms.snapshot("TESTROOM").voteCounts?.[next.id], 1);
    assert(
      !JSON.stringify(rooms.snapshot("TESTROOM")).includes("b".repeat(64)),
    );
    act("vote", { videoId: next.id, participantHash: "b".repeat(64) }, false);
    assert.equal(rooms.snapshot("TESTROOM").voteCounts?.[next.id], 0);
    act("clear");
    act("undo");
    assert.equal(rooms.snapshot("TESTROOM").queue.length, 1);
    for (const actor of ["b", "c", "d"])
      act("skip-vote", { participantHash: actor.repeat(64) }, false);
    assert.equal(rooms.snapshot("TESTROOM").current?.id, next.id);
    assert.equal(rooms.snapshot("TESTROOM").skipVotes, 0);
  } finally {
    store.close();
  }
});

test("live events never disclose imported website access metadata", () => {
  const store = new Store(":memory:");
  const rooms = new Rooms(store, () => 10000);
  try {
    rooms.import({
      code: "TESTROOM",
      name: "Private access",
      owner_hash: "a".repeat(64),
      state: {
        current: null,
        queue: [],
        playing: false,
        position: 0,
        cohostHashes: ["b".repeat(64)],
        inviteHashes: ["c".repeat(64)],
        transferHash: "d".repeat(64),
        engineOwnerHash: "a".repeat(64),
      },
      version: 1,
      updated_at: 10000,
      expires_at: 100000,
    });
    const payload = JSON.stringify(rooms.snapshot("TESTROOM"));
    for (const value of ["a", "b", "c", "d"])
      assert(!payload.includes(value.repeat(64)));
  } finally {
    store.close();
  }
});

test("the third guest skip vote continues radio through the same revision guard", async () => {
  const { store, rooms } = setup();
  try {
    rooms.search = async () => [next];
    for (const [i, actor] of ["b", "c", "d"].entries())
      await rooms.control("TESTROOM", {
        action: "skip-vote",
        version: i + 1,
        participantHash: actor.repeat(64),
        actorHash: "guest",
      });
    assert.equal(rooms.snapshot("TESTROOM").current?.id, next.id);
    assert.equal(rooms.snapshot("TESTROOM").skipVotes, 0);
  } finally {
    store.close();
  }
});

test("undo preserves guest tracks added after the host cleared the queue", () => {
  const { store, rooms, input } = setup();
  try {
    rooms.mutate("TESTROOM", { action: "add", video: next, version: 1 });
    rooms.mutate("TESTROOM", {
      action: "clear",
      actorHash: input.actorHash,
      version: 2,
    });
    rooms.mutate("TESTROOM", {
      action: "add",
      video: { ...next, id: "more1234567" },
      version: 3,
    });
    const restored = rooms.mutate("TESTROOM", {
      action: "undo",
      actorHash: input.actorHash,
      version: 4,
    });
    assert.deepEqual(
      restored.queue.map((v) => v.id),
      [next.id, "more1234567"],
    );
  } finally {
    store.close();
  }
});

test("radio falls back to a second artist search and can restart after the last track ended", async () => {
  const { store, rooms, input } = setup();
  try {
    rooms.search = async () => [];
    await assert.rejects(rooms.control("TESTROOM", input), /Radioen fann ikkje/);
    const ended = rooms.mutate("TESTROOM", { ...input, version: rooms.snapshot("TESTROOM").version });
    assert.equal(ended.current, null);
    const queries: string[] = [];
    rooms.search = async query => { queries.push(query); return queries.length === 1 ? [] : [next]; };
    const resumed = await rooms.control("TESTROOM", { ...input, action: "radio", enabled: true, version: ended.version });
    assert.equal(resumed.current?.id, next.id);
    assert.equal(resumed.playing, true);
    assert.equal(queries.length, 2);
    assert.deepEqual(queries, ['future house audio -"Feel Good"', "Syn Cole music audio"]);
  } finally { store.close(); }
});

test("radio queues the next song before the end, preserves the clock, and yields to manual choices", async () => {
  const store = new Store(":memory:");
  let now=10000, searches=0;
  const rooms=new Rooms(store,()=>now);
  rooms.import({code:"TESTROOM",name:"Preview radio",owner_hash:"a".repeat(64),state:{current:seed,queue:[],position:169,playing:true},version:1,updated_at:now,expires_at:100000});
  rooms.search=async()=>{searches++;return [next];};
  try {
    await rooms.tick(); assert.equal(searches,2);
    now+=1000;
    await rooms.tick();
    const prepared=rooms.snapshot("TESTROOM");
    assert.equal(prepared.current?.id,seed.id);
    assert.equal(prepared.position,170);
    assert.equal(prepared.queue[0]?.id,next.id);
    assert.equal(prepared.queue[0]?.radio,true);
    await rooms.tick(); assert.equal(searches,2);
    now+=30000;
    await rooms.tick();
    assert.equal(rooms.snapshot("TESTROOM").current?.id,next.id);
    assert.equal(searches,2,'the bounded pools are already resolved before transition');
  } finally { rooms.dispose();store.close(); }
});

test("turning radio off removes its prepared track and a manual request takes priority", async()=>{
 for(const action of ['radio','add']) {
  const {rooms,store}=setup();
  try {
   const prepared=rooms.mutate('TESTROOM',{action:'radio-prefetch',version:1,actorHash:'a'.repeat(64)},next);
   assert.equal(prepared.queue.length,1);
   const manual={...video,id:'manual12345'};
   const result=rooms.mutate('TESTROOM',{action,enabled:false,video:manual,version:prepared.version,actorHash:'a'.repeat(64)});
   assert.deepEqual(result.queue.map(v=>v.id),action==='add'?[manual.id]:[]);
  }finally{store.close();}
 }
});

test("a removed radio suggestion is not immediately recommended again",async()=>{
 const {rooms,store}=setup();
 try {
  const prepared=rooms.mutate('TESTROOM',{action:'radio-prefetch',version:1,actorHash:'a'.repeat(64)},next);
  const removed=rooms.mutate('TESTROOM',{action:'remove',videoId:next.id,version:prepared.version,actorHash:'a'.repeat(64)});
  rooms.search=async()=>[next];
  const retried=await rooms.control('TESTROOM',{action:'radio-prefetch',version:removed.version,actorHash:'a'.repeat(64)});
  assert.equal(retried.queue.length,0);
 }finally{store.close();}
});

test("untagged radio seeds can learn genre from the same recording and cross artists",async()=>{
 const plain={...seed,title:'Syn Cole - Feel Good'};
 const queries:string[]=[];
 const result=await roomRecommendation({current:plain,queue:[]},async query=>{
  queries.push(query);
  return queries.length===1?[seed]:[next];
 });
 assert.equal(result?.id,next.id);
 assert(queries[1].startsWith('future house'));
});

test('skip shares an in-flight radio lookup and takes priority over prefetch',async()=>{
 const {rooms,store,input}=setup();const gate=deferred<RoomVideo[]>();let calls=0;
 rooms.search=async()=>{calls++;return gate.promise;};
 try {
  const preload=rooms.control('TESTROOM',{...input,action:'radio-prefetch'});
  const skip=rooms.control('TESTROOM',input);
  gate.resolve([next]);
  await preload;const result=await skip;
  assert.equal(result.current?.id,next.id);assert.equal(result.queue.length,0);assert.equal(calls,2);
 }finally{store.close();}
});
test('an unsuccessful early skip keeps the current song and allows retry',async()=>{
 const {rooms,store,input}=setup();
 try {
  rooms.search=async()=>[];
  await assert.rejects(rooms.control('TESTROOM',input),/Radioen fann ikkje/);
  assert.equal(rooms.snapshot('TESTROOM').current?.id,seed.id);
  assert.equal(rooms.snapshot('TESTROOM').playing,true);
  rooms.search=async()=>[next];assert.equal((await rooms.control('TESTROOM',{...input,version:rooms.snapshot('TESTROOM').version})).current?.id,next.id);
 }finally{store.close();}
});

for (const skipFirst of [false, true]) test(`empty shared radio lookup persists backoff (skip first: ${skipFirst})`, async () => {
  const store = new Store(":memory:");
  let now = 10000, calls = 0;
  const rooms = new Rooms(store, () => now);
  rooms.import({ code: "TESTROOM", name: "Cooldown", owner_hash: "a".repeat(64), state: { current: seed, queue: [], position: 10, playing: true }, version: 1, updated_at: now, expires_at: 100000 });
  const gate = deferred<RoomVideo[]>();
  rooms.search = async () => { calls++; return gate.promise; };
  const input = { action: "next", version: 1, actorHash: "a".repeat(64) };
  try {
    let tick, skip;
    if (skipFirst) { skip = rooms.control("TESTROOM", input); tick = rooms.tick(); }
    else { tick = rooms.tick(); skip = rooms.control("TESTROOM", input); }
    const rejection = assert.rejects(skip, error => error instanceof Error && 'status' in error && error.status === 422);
    gate.resolve([]);
    await Promise.all([tick, rejection]);
    assert.equal(calls, 2, "one shared lookup with its two search queries");
    assert.equal(rooms.snapshot("TESTROOM").current?.id, seed.id);
    assert.equal(rooms.snapshot("TESTROOM").playing, true);
    const recovered = new Rooms(store, () => now);
    recovered.search = rooms.search;
    for (let i = 0; i < 29; i++) { now += 500; await recovered.tick(); }
    assert.equal(calls, 2, "persisted cooldown survives reload and repeated 500ms ticks");
    now += 500;
    await recovered.tick();
    assert.equal(calls, 4, "radio retries when the 15 second cooldown expires");
    recovered.dispose();
  } finally { rooms.dispose(); store.close(); }
});

test("retrying radio during playback prepares a song without restarting the shared clock", async () => {
  const { store, rooms, input } = setup();
  try {
    const room = rooms.load("TESTROOM");
    room.state.playbackKey = "same-playback";
    room.state.startsAt = 9000;
    rooms.save(room);
    rooms.search = async () => [next];
    const retried = await rooms.control("TESTROOM", { ...input, action: "radio", enabled: true });
    assert.equal(retried.current?.id, seed.id);
    assert.equal(retried.position, 100);
    assert.equal(retried.playbackKey, "same-playback");
    assert.equal(retried.startsAt, 9000);
    assert.equal(retried.playing, true);
    assert.deepEqual(retried.queue.map(video => video.id), [next.id]);
  } finally { rooms.dispose(); store.close(); }
});

test("an empty current-track radio retry reports an actionable failure and persists backoff", async () => {
  const { store, rooms, input } = setup();
  let calls = 0;
  try {
    rooms.search = async () => { calls++; return []; };
    await assert.rejects(rooms.control("TESTROOM", { ...input, action: "radio", enabled: true }),
      error => error instanceof Error && "status" in error && error.status === 422 && /Prøv radio igjen/.test(error.message));
    const saved = rooms.load("TESTROOM");
    assert.equal(saved.state.current?.id, seed.id);
    assert.equal(saved.state.position, 100);
    assert.equal(saved.state.playing, true);
    assert.equal(saved.state.radioRetryAt, 25000);
    assert.equal(saved.version, 2);
    await rooms.tick();
    assert.equal(calls, 2, "the failed explicit retry cannot immediately trigger an automatic retry");
    rooms.search = async () => [next];
    const recovered = await rooms.control("TESTROOM", { ...input, action: "radio", enabled: true, version: saved.version });
    assert.equal(recovered.queue[0]?.id, next.id);
  } finally { rooms.dispose(); store.close(); }
});

test("current-track radio retry rejects guests and stale callers before searching", async () => {
  const { store, rooms, input } = setup();
  try {
    rooms.search = async () => { assert.fail("unauthorized retry spent a search"); };
    for (const change of [{ actorHash: "guest" }, { version: 0 }])
      await assert.rejects(rooms.control("TESTROOM", { ...input, ...change, action: "radio", enabled: true }),
        error => error instanceof Error && "status" in error && [403, 409].includes(Number(error.status)));
  } finally { rooms.dispose(); store.close(); }
});

for (const winner of ["add", "radio"])
  test(`a late radio retry cannot override a newer ${winner} command`, async () => {
    const { store, rooms, input } = setup();
    const gate = deferred<RoomVideo[]>();
    try {
      rooms.search = async () => gate.promise;
      const pending = rooms.control("TESTROOM", { ...input, action: "radio", enabled: true });
      const rejected = assert.rejects(pending, error => error instanceof Error && "status" in error && error.status === 409);
      rooms.mutate("TESTROOM", { ...input, action: winner, enabled: false, video: next });
      gate.resolve([next]);
      await rejected;
      const current = rooms.snapshot("TESTROOM");
      assert.equal(current.current?.id, seed.id);
      assert.equal(current.radio, winner !== "radio");
      assert.deepEqual(current.queue.map(video => video.id), winner === "add" ? [next.id] : []);
    } finally { rooms.dispose(); store.close(); }
  });
