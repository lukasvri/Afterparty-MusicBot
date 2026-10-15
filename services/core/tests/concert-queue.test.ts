import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { Providers } from "../src/providers.ts";
import { Engine } from "../src/engine.ts";
import { Commands } from "../src/commands.ts";
import type { Sink } from "../src/audio.ts";
const track = (entryId: string, concert = true) => ({
  id: entryId.padEnd(11, "0"),
  entryId,
  title: entryId,
  artist: "Test",
  image: "",
  duration: 180,
  live: false,
  embeddable: true,
  source: "youtube" as const,
  concert,
});
function setup() {
  const store = new Store(":memory:");
  const sink: Sink = {
    play() {},
    stop() {},
    pause() {},
    resume() {},
    duration: () => 0,
    advancing: () => true,
    buffering: () => false,
    onIdle: null,
    onError: null,
  };
  const e = new Engine(store, new Providers(store, {}), sink);
  e.connected = true;
  e.current = track("current");
  e.queue = [track("one"), track("private", false), track("two")];
  const c = new Commands(e);
  return {
    e,
    c,
    q: c.concertQueue,
    close() {
      c.close();
      e.close();
      store.close();
    },
  };
}
test("concert queue revisions, moderation and undo preserve private music and server isolation", async () => {
  const a = setup(),
    b = setup();
  try {
    const act = (action: string, extra = {}) =>
      a.q.apply({ action, revision: a.q.revision(), ...extra }, true);
    assert.deepEqual(
      a.q.snapshot().queue.map((v) => v.entryId),
      ["one", "two"],
    );
    await assert.rejects(
      a.q.apply({ action: "clear", revision: a.q.revision() }, false),
      /administratortilgang/,
    );
    await assert.rejects(
      a.q.apply(
        { action: "remove", revision: a.q.revision(), videoId: "private" },
        true,
      ),
      /konsertkøen/,
    );
    const stale = a.q.revision();
    await act("move", { videoId: "two", to: 0 });
    assert.deepEqual(
      a.e.queue.map((t) => t.entryId),
      ["two", "private", "one"],
    );
    await assert.rejects(
      a.q.apply({ action: "clear", revision: stale }, true),
      /endret/,
    );
    await act("clear");
    assert.deepEqual(
      a.e.queue.map((t) => t.entryId),
      ["private"],
    );
    await act("undo");
    assert.deepEqual(
      a.q.snapshot().queue.map((t) => t.entryId),
      ["two", "one"],
    );
    assert.deepEqual(
      a.e.queue.map((t) => t.entryId),
      ["two", "private", "one"],
    );
    await act("approval", { enabled: true });
    assert(a.q.request([track("request")]));
    assert.equal(a.q.snapshot().requests.length, 1);
    await act("approve", { videoId: "request" });
    assert.equal(a.q.snapshot().requests.length, 0);
    assert(a.e.queue.some((t) => t.entryId === "request"));
    assert.equal(b.q.snapshot().approvalRequired, false);
    assert.deepEqual(
      b.e.queue.map((t) => t.entryId),
      ["one", "private", "two"],
    );
  } finally {
    a.close();
    b.close();
  }
});
test("votes are per participant and do not invalidate prepared audio; undo expires on track change", async () => {
  const a = setup();
  try {
    let invalidations = 0;
    a.e.mixer = {
      invalidateNext() {
        invalidations++;
      },
      destroy() {},
    } as never;
    const actor = "a".repeat(64);
    await a.q.apply(
      {
        action: "vote",
        videoId: "one",
        participantHash: actor,
        revision: a.q.revision(),
      },
      false,
    );
    assert.equal(a.q.snapshot().voteCounts.one, 1);
    assert.equal(invalidations, 0);
    assert(!JSON.stringify(a.q.snapshot()).includes(actor));
    await a.q.apply({ action: "clear", revision: a.q.revision() }, true);
    a.e.current = track("new");
    await assert.rejects(
      a.q.apply({ action: "undo", revision: a.q.revision() }, true),
      /endret/,
    );
  } finally {
    a.close();
  }
});
test("public enqueue uses durable moderation while normal Discord music remains private", async () => {
  const a = setup();
  try {
    await a.q.apply(
      { action: "approval", enabled: true, revision: a.q.revision() },
      true,
    );
    a.e.providers.resolve = async () => [track("requested")];
    await a.c.execute({ action: "enqueue", videoId: "requested00" }, "public");
    assert.equal(a.q.read().requests.length, 1);
    assert(!a.e.queue.some((t) => t.entryId === "requested"));
    const persisted = new Commands(a.e);
    assert.equal(persisted.concertQueue.snapshot().requests.length, 1);
    persisted.close();
    a.e.providers.resolve = async () => [track("ordinary")];
    await a.c.execute({ action: "enqueue", query: "ordinary" }, "discord");
    assert(a.e.queue.some((t) => t.entryId === "ordinary" && !t.concert));
    assert(!a.q.snapshot().queue.some((t) => t.entryId === "ordinary"));
  } finally {
    a.close();
  }
});

test('three distinct skip votes apply only to the current public playback key',async()=>{
 const a=setup();try{let skips=0;a.e.skip=async()=>{skips++;};
 for(const actor of ['a','b','c'])await a.q.apply({action:'skip-vote',revision:a.q.revision(),playbackKey:'core:current',participantHash:actor.repeat(64)},false);
 assert.equal(skips,1);assert.equal(a.q.snapshot().skipVotes,0);
 await assert.rejects(a.q.apply({action:'skip-vote',revision:a.q.revision(),playbackKey:'core:old',participantHash:'d'.repeat(64)},false),/endret/);
 a.e.current={...a.e.current!,concert:false};await assert.rejects(a.q.apply({action:'skip-vote',revision:a.q.revision(),playbackKey:'core:current',participantHash:'d'.repeat(64)},false),/endret/);assert.equal(skips,1);
 }finally{a.close();}
});
