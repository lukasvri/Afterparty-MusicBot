import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { Providers } from "../src/providers.ts";
import { Engine } from "../src/engine.ts";
import { Commands } from "../src/commands.ts";
import type { Sink } from "../src/audio.ts";
import type { Track } from "../src/types.ts";
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
for (const withAddition of [false, true]) {
  test(`concert undo counts pending requests${withAddition ? " and new queued tracks" : ""} toward capacity`, async () => {
    const a = setup(), b = setup();
    clearInterval(a.e.timer);
    clearInterval(b.e.timer);
    try {
      a.e.settings.playlistLimit = withAddition ? 5 : 4;
      const act = (action: string, extra = {}) =>
        a.q.apply({ action, revision: a.q.revision(), ...extra }, true);
      const other = { saved: b.q.read(), queue: [...b.e.queue], revision: b.q.revision() };
      await act("approval", { enabled: true });
      await act("clear");
      if (withAddition) a.e.enqueue([track("added")]);
      assert(a.q.request([track("request1"), track("request2")]));
      const revision = a.q.revision();
      const saved = a.q.read();
      const queue = [...a.e.queue];
      const persisted = a.e.store.get<Track[]>("queue", []);
      await assert.rejects(act("undo"), /The queue is full/);
      assert.equal(a.q.revision(), revision);
      assert.deepEqual(a.q.read(), saved, "Rejected undo retains requests and undo state");
      assert.deepEqual(a.e.queue, queue);
      assert.deepEqual(a.e.store.get<Track[]>("queue", []), persisted);
      await act("reject", { videoId: "request2" });
      await act("undo");
      assert.deepEqual(a.e.queue.map(t => t.entryId), ["one", "private", "two", ...(withAddition ? ["added"] : [])]);
      assert.deepEqual(a.q.read().requests.map(t => t.entryId), ["request1"]);
      assert.equal(a.e.queue.length + a.q.read().requests.length, a.e.settings.playlistLimit);
      assert.equal(a.q.read().undo, undefined);
      assert.deepEqual({ saved: b.q.read(), queue: b.e.queue, revision: b.q.revision() }, other, "Undo remains isolated to its server");
    } finally { a.close(); b.close(); }
  });
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
      /administrator access/,
    );
    await assert.rejects(
      a.q.apply(
        { action: "remove", revision: a.q.revision(), videoId: "private" },
        true,
      ),
      /concert queue/,
    );
    const stale = a.q.revision();
    await act("move", { videoId: "two", to: 0 });
    assert.deepEqual(
      a.e.queue.map((t) => t.entryId),
      ["two", "private", "one"],
    );
    await assert.rejects(
      a.q.apply({ action: "clear", revision: stale }, true),
      /changed/,
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
      /changed/,
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
 await assert.rejects(a.q.apply({action:'skip-vote',revision:a.q.revision(),playbackKey:'core:old',participantHash:'d'.repeat(64)},false),/changed/);
 a.e.current={...a.e.current!,concert:false};await assert.rejects(a.q.apply({action:'skip-vote',revision:a.q.revision(),playbackKey:'core:current',participantHash:'d'.repeat(64)},false),/changed/);assert.equal(skips,1);
 }finally{a.close();}
});

for (const location of ['current', 'queue'] as const) {
  for (const route of ['request', 'direct', 'approve'] as const) {
    test(`${route} accepts concert music matching private ${location}`, async () => {
      const a = setup();
      try {
        const privateTrack = track('shared', false);
        if (location === 'current') a.e.current = privateTrack;
        else a.e.queue.push(privateTrack);
        const requested = { ...track('public-copy'), id: privateTrack.id };
        if (route !== 'direct') await a.q.apply({ action: 'approval', enabled: true, revision: a.q.revision() }, true);
        if (route === 'request') {
          assert.equal(a.q.request([requested]), true);
          assert.throws(() => a.q.request([{ ...requested, entryId: 'duplicate' }]), /already/);
        } else if (route === 'direct') {
          a.e.providers.resolve = async () => [requested];
          await a.c.execute({ action: 'enqueue', videoId: requested.id }, 'public');
          await assert.rejects(a.c.execute({ action: 'enqueue', videoId: requested.id }, 'public'), /already/);
        } else {
          // Seed an already pending request to exercise approval independently.
          a.q.save({ ...a.q.read(), requests: [requested] });
          await assert.rejects(a.q.apply({ action: 'approve', videoId: requested.entryId, revision: a.q.revision() }, false), /administrator access/);
          await a.q.apply({ action: 'approve', videoId: requested.entryId, revision: a.q.revision() }, true);
          assert.equal(a.q.read().requests.length, 0);
        }
        assert.equal(a.e.current?.entryId, location === 'current' ? 'shared' : 'current');
        assert.equal(a.e.queue.some(t => t.entryId === 'shared'), location === 'queue');
        assert.equal(a.e.queue.filter(t => t.entryId === requested.entryId).length, route === 'request' ? 0 : 1);
      } finally { a.close(); }
    });
  }
}

test('duplicate protection stays within visibility scopes, including batches and current concerts', async () => {
  const a = setup();
  try {
    await a.q.apply({ action: 'approval', enabled: true, revision: a.q.revision() }, true);
    for (const existing of [a.e.current!, a.e.queue[0]]) {
      assert.throws(() => a.q.request([{ ...existing, entryId: 'copy' }]), /already/);
      assert.throws(() => a.e.enqueue([{ ...existing, entryId: 'copy' }]), /already/);
    }
    const publicCopy = { ...track('batch'), id: 'batch000000' };
    const privateCopy = { ...publicCopy, concert: false, entryId: 'private-batch' };
    assert.equal(a.e.enqueue([publicCopy, { ...publicCopy, entryId: 'duplicate' }, privateCopy]), 2);
    assert.throws(() => a.e.enqueue([{ ...privateCopy, concert: undefined, entryId: 'legacy-private' }]), /already/);
    assert.throws(() => a.e.enqueue([{ ...track('private', false), entryId: 'duplicate-private' }]), /already/);
    const request = track('pending');
    assert(a.q.request([request, { ...request, entryId: 'duplicate-pending' }]));
    assert.equal(a.q.read().requests.length, 1);
  } finally { a.close(); }
});

for (const action of ["remove", "clear"] as const) {
  test(`concert ${action} replaces a rejected radio suggestion without repeating another upload`, async () => {
    const a = setup();
    clearInterval(a.e.timer);
    const original = { ...track("seed"), title: "Artist - Original" };
    const suggested = { ...track("suggested", false), title: "Artist - Suggested" };
    const alternate = { ...track("alternate", false), title: "Artist - Suggested (Remastered Audio)" };
    const replacement = { ...track("replacement", false), title: "Artist - Replacement" };
    let searches = 0;
    a.e.current = original;
    a.e.queue = [];
    a.e.providers.search = async query => query === 'Artist "Original"' ? [] :
      ++searches <= 2 ? [suggested] : [alternate, replacement];
    try {
      await a.e.ensureRadio();
      assert.equal(a.e.queue[0]?.id, suggested.id);
      assert.equal(a.e.radioRetryAt, Infinity);
      const revision = a.q.revision();
      await a.q.apply({ action, videoId: suggested.entryId, revision }, true);
      assert.equal(a.e.current, original, "Removing a suggestion preserves current playback");
      assert.equal(a.e.radioRetryAt, 0, "The cleared recommendation must allow another lookup");
      assert(a.e.store.get<Record<string, number>>("radio-skips", {})[suggested.id]);
      const persisted = new Providers(a.e.store, {});
      assert(persisted.radioHistory().some((track) => track.id === suggested.id));
      await assert.rejects(a.q.apply({ action, videoId: suggested.entryId, revision }, true), /changed/);
      await a.e.ensureRadio();
      assert.equal(searches, 4, "each shared selection compares its two bounded discovery pools");
      assert.deepEqual(a.e.queue.map((track) => track.id), [replacement.id]);
      assert.deepEqual(a.e.store.get<Track[]>("queue", []).map((track) => track.id), [replacement.id]);
    } finally { a.close(); }
  });
}

test("concert undo restores only the selected rejection and preserves private queue entries", async () => {
  const a = setup(), b = setup();
  clearInterval(a.e.timer);
  const selected = { ...track("selected"), title: "Artist - Selected", radio: true };
  const kept = { ...track("kept"), title: "Artist - Kept", radio: true };
  const privateTrack = { ...track("private", false), radio: true };
  const rejected = { ...track("rejected"), title: "Artist - Rejected", radio: true };
  a.e.current = { ...track("seed"), title: "Artist - Original" };
  a.e.queue = [selected, privateTrack, kept, track("manual")];
  try {
    a.e.rejectRadio([rejected]);
    const act = (action: string, extra = {}) =>
      a.q.apply({ action, revision: a.q.revision(), ...extra }, true);
    await assert.rejects(a.q.apply({ action: "remove", videoId: selected.entryId, revision: a.q.revision() }, false), /administrator access/);
    await act("remove", { videoId: selected.entryId });
    assert.deepEqual(a.e.queue.map((track) => track.entryId), ["private", "kept", "manual"]);
    assert.deepEqual(Object.keys(a.e.store.get("radio-skips", {})).sort(), [rejected.id, selected.id].sort());
    await act("undo");
    assert.deepEqual(a.e.queue.map((track) => track.entryId), ["selected", "private", "kept", "manual"]);
    assert.equal(a.e.queue[0].entryId, selected.entryId, "Undo keeps the selected queue identity");
    assert.equal(a.e.queue[1], privateTrack, "Concert editing does not replace a private track");
    assert.deepEqual(Object.keys(a.e.store.get("radio-skips", {})), [rejected.id]);
    assert.deepEqual(a.e.store.get<{track: Track}[]>("radio-skipped-tracks", []).map((entry) => entry.track.id), [rejected.id]);
    assert.deepEqual(b.e.store.get("radio-skips", {}), {}, "Rejections stay in the selected server");
    assert(!JSON.stringify(a.q.snapshot()).includes(privateTrack.id));
    assert(!JSON.stringify(a.q.snapshot()).includes(rejected.id));
    await act("clear");
    assert.deepEqual(a.e.queue.map((track) => track.entryId), ["private"]);
    assert(!a.e.store.get<Record<string, number>>("radio-skips", {})[privateTrack.id]);
    await act("undo");
    assert.deepEqual(a.e.queue.map((track) => track.entryId), ["selected", "private", "kept", "manual"]);
    assert.deepEqual(Object.keys(a.e.store.get("radio-skips", {})), [rejected.id]);
  } finally { a.close(); b.close(); }
});

test("concert move and undo preserve rejection history for entries that were never removed", async () => {
  const a = setup();
  clearInterval(a.e.timer);
  const selected = { ...track("selected"), title: "Artist - Selected", radio: true };
  a.e.queue = [selected, track("manual")];
  try {
    a.e.rejectRadio([selected]);
    const before = a.e.store.get("radio-skips", {});
    const generation = a.e.radioGeneration;
    await a.q.apply({ action: "move", videoId: selected.entryId, to: 1, revision: a.q.revision() }, true);
    await a.q.apply({ action: "undo", revision: a.q.revision() }, true);
    assert.deepEqual(a.e.queue.map((track) => track.entryId), ["selected", "manual"]);
    assert.deepEqual(a.e.store.get("radio-skips", {}), before);
    assert.equal(a.e.radioGeneration, generation);
  } finally { a.close(); }
});

test('approval replaces radio at capacity and preserves other pending requests and servers',async()=>{
 const a=setup(),b=setup();clearInterval(a.e.timer);clearInterval(b.e.timer);
 try{
  a.e.settings.playlistLimit=2;a.e.queue=[];
  const act=(action:string,extra={})=>a.q.apply({action,revision:a.q.revision(),...extra},true);
  await act('approval',{enabled:true});
  assert(a.q.request([track('requested'),track('waiting')]));
  const privateTrack=track('private',false);
  a.e.queue=[privateTrack,{...track('radio'),radio:true}];a.e.persist();
  const other={queue:[...b.e.queue],saved:b.q.read(),revision:b.q.revision()};
  await act('approve',{videoId:'requested'});
  assert.deepEqual(a.e.queue.map(t=>t.entryId),['private','requested']);
  assert.deepEqual(a.q.read().requests.map(t=>t.entryId),['waiting']);
  const before={queue:[...a.e.queue],saved:a.q.read(),revision:a.q.revision()};
  await assert.rejects(act('approve',{videoId:'waiting'}),/The queue is full/);
  assert.deepEqual({queue:a.e.queue,saved:a.q.read(),revision:a.q.revision()},before);
  assert.deepEqual({queue:b.e.queue,saved:b.q.read(),revision:b.q.revision()},other);
 }finally{a.close();b.close();}
});

test('pending request admission still counts radio that remains queued',async()=>{
 const a=setup();clearInterval(a.e.timer);
 try{
  a.e.settings.playlistLimit=2;a.e.queue=[{...track('radio'),radio:true}];
  await a.q.apply({action:'approval',enabled:true,revision:a.q.revision()},true);
  assert(a.q.request([track('waiting')]));
  const before={queue:[...a.e.queue],saved:a.q.read(),revision:a.q.revision()};
  assert.throws(()=>a.q.request([track('overflow')]),/The queue is full/);
  assert.deepEqual({queue:a.e.queue,saved:a.q.read(),revision:a.q.revision()},before);
 }finally{a.close();}
});
