import { fixtureRadioContent, fixtureRadioOwner } from './radio-content-fixture.ts';
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { Providers } from "../src/providers.ts";
import { Engine } from "../src/engine.ts";
import { rankRadio, radioQuery } from "../src/radio.ts";
import { roomRecommendation } from "../src/room-radio.ts";
import { changeRoom, publicPlayback } from "../src/room-state.ts";
import { Recommendations } from "../src/recommendations.ts";
import type { Track } from "../src/types.ts";
import type { Sink } from "../src/audio.ts";

const song = (id: string, title: string, genres: string[] = []): Track => ({
  id,
  entryId: id,
  title,
  genres,
  artist: "Music uploads",
  duration: 210,
  image: "",
  live: false,
  embeddable: true,
  source: "youtube",
});
const original = song("original001", "Martin Garrix - Animals", [
  "electro house",
]);
const next = {
  ...song("nextsong001", "Other Artist - Next", ["electro house"]),
  radio: true,
  radioContentChecked: 1 as const,
};
const third = song("thirdsong01", "Third Artist - Third", ["electro house"]);
const sink = (): Sink => ({
  onIdle: null,
  onError: null,
  play() {},
  pause() {},
  resume() {},
  stop() {},
  duration: () => 0,
  advancing: () => false,
  buffering: () => false,
});

test("Discord radio keeps the manually chosen original through recommendations and restart", async () => {
  const store = new Store(":memory:"),
    providers = fixtureRadioOwner(new Providers(store, {}));
  let engine = new Engine(store, providers, sink());
  const seeds: string[] = [];
  providers.radio = async (seed) => {
    seeds.push(seed.id);
    return seeds.length === 1 ? next : third;
  };
  try {
    engine.connected = true;
    engine.current = original;
    await engine.ensureRadio();
    engine.adoptTrack(engine.queue[0]);
    engine.close();
    engine = new Engine(store, providers, sink());
    engine.connected = true;
    engine.current = next;
    await engine.ensureRadio();
    assert.deepEqual(seeds, [original.id, original.id]);
    const manual = song("manualsong1", "New Artist - Deliberate choice", [
      "jazz",
    ]);
    engine.adoptTrack(manual);
    engine.queue = [];
    await engine.ensureRadio();
    assert.equal(seeds.at(-1), manual.id);
    engine.stop();
    assert.equal(store.get("radio-seed", null), null);
  } finally {
    engine.close();
    store.close();
  }
});

test("room radio persists its original instead of drifting through the previous recommendation", async () => {
  let state = changeRoom(
    { current: original, queue: [], playing: true, position: 0 },
    { action: "radio-prefetch" },
    true,
    0,
    next,
  );
  state = changeRoom(state, { action: "next" }, true, 210);
  const queries: string[] = [];
  const result = await roomRecommendation(
    JSON.parse(JSON.stringify(state)),
    async (query) => {
      queries.push(query);
      return [
        third,
        song("oldsynth001", "Old Artist - Eighties", ["synth pop"]),
      ];
    }, undefined, fixtureRadioContent
  );
  assert.equal(result?.id, third.id);
  assert(queries[0].includes('"Animals"'));
  assert(
    !("radioSeed" in publicPlayback(state)),
    "private seed metadata is not added to public snapshots",
  );
});

test("radio rejects production lessons even if artist, duration and genre match", () => {
  const bad = [
    "How to make Animals",
    "How To Play Animals",
    "Animals Tutorials",
    "Animals FL Studio project",
    "Animals Ableton breakdown",
    "Animals production lesson",
    "Animals HOWTO",
    "Animals step-by-step",
    "How I made Animals",
    "Animals How To",
  ];
  const candidates = bad.map((title, i) =>
    song("bad" + i, "Martin Garrix - " + title, ["electro house"]),
  );
  candidates.push(song("plainhowto1", "How to: Martin Garrix | Electro House"));
  assert.deepEqual(
    rankRadio(original, [...candidates, third], [], []).map((t) => t.id),
    [third.id],
  );
});

test("a broad pop tag does not turn an EDM artist seed into unrelated eighties radio", () => {
  const seed = { ...original, genres: ["pop"] };
  const sameArtist = song("othergarrix", "Martin Garrix - Another Song", [
    "pop",
  ]);
  const unrelated = song("oldpop00001", "Eighties Artist - Old Hit", ["pop"]);
  assert.deepEqual(
    rankRadio(seed, [unrelated, sameArtist], [], []).map((t) => t.id),
    [sameArtist.id],
  );
  assert(radioQuery(seed).startsWith("Martin Garrix audio"));
});

test("Last.fm radio applies video safety and the original genre even after catalog matching", async () => {
  const store = new Store(":memory:"),
    p = fixtureRadioOwner(new Providers(store, { LASTFM_API_KEY: "synthetic" }));
  try {
    p.recommendations.similar = async () => [
      { artist: "Martin Garrix", title: "Lesson", duration: 210 },
      { artist: "Old Artist", title: "Eighties", duration: 210 },
      { artist: "Third Artist", title: "Third", duration: 210 },
    ];
    p.search = async () => [];
    p.recommendations.topTracks = async () => [];
    p.matchSong = async (catalog) =>
      catalog.title === "Lesson"
        ? song("howto000001", "Martin Garrix - How to make Animals", [
            "electro house",
          ])
        : catalog.title === "Eighties"
          ? song("oldpop00001", "Old Artist - Eighties", ["synth pop"])
          : third;
    assert.equal((await p.radio(original, []))?.id, third.id);
  } finally {
    store.close();
  }
});

test("weak, malformed and instructional similarity results cannot seed Last.fm playback", async () => {
  const store = new Store(":memory:");
  try {
    const r = new Recommendations(store, "synthetic", async () =>
      Response.json({
        similartracks: {
          track: [
            null,
            {
              name: "Unrelated old hit",
              artist: { name: "Old Artist" },
              match: "0.01",
            },
            { name: "Missing similarity", artist: { name: "Artist" } },
            {
              name: "How to make Animals",
              artist: { name: "Martin Garrix" },
              match: "0.9",
            },
            {
              name: "Valid next",
              artist: { name: "Related Artist" },
              match: "0.8",
            },
          ],
        },
      }),
    );
    assert.deepEqual(
      (await r.similar(original)).map((s) => s.title),
      ["Valid next"],
    );
  } finally {
    store.close();
  }
});

test("old unfiltered Last.fm cache entries are not reused", async () => {
  const store = new Store(":memory:");
  let calls = 0;
  try {
    store.set("similar:" + JSON.stringify(["Martin Garrix", "Animals"]), {
      at: Date.now(),
      songs: [{ artist: "Old Artist", title: "Wrong", duration: 0 }],
    });
    const r = new Recommendations(store, "synthetic", async () => {
      calls++;
      return Response.json({
        similartracks: {
          track: [
            { artist: { name: "Related Artist" }, name: "Valid", match: "0.8" },
          ],
        },
      });
    });
    assert.deepEqual(
      (await r.similar(original)).map((s) => s.title),
      ["Valid"],
    );
    await r.similar(original);
    assert.equal(calls, 1);
  } finally {
    store.close();
  }
});

test("manual room selection and a played manual queue entry replace the anchor, toggles do not", () => {
  const manual = {
    ...song("manualsong1", "New Artist - Deliberate choice", ["jazz"]),
    radio: false,
  };
  let state = changeRoom(
    { current: original, queue: [], playing: true, position: 0 },
    { action: "radio-prefetch" },
    true,
    0,
    next,
  );
  state = changeRoom(state, { action: "next" }, true, 0);
  state = changeRoom(state, { action: "radio", enabled: false }, true, 20);
  state = changeRoom(state, { action: "radio", enabled: true }, true, 20);
  assert.equal(state.radioSeed?.id, original.id);
  state = changeRoom(state, { action: "add", video: manual }, true, 20);
  assert.equal(
    state.radioSeed?.id,
    original.id,
    "queued manual choice waits until it plays",
  );
  state = changeRoom(state, { action: "next" }, true, 20);
  assert.equal(state.radioSeed?.id, manual.id);
  state = changeRoom(
    state,
    { action: "play-video", video: original },
    true,
    20,
  );
  assert.equal(state.radioSeed?.id, original.id);
});

test("an older room recovers its last explicit song choice from history", async () => {
  const chosen = { ...original, radio: false };
  const oldRecommendation = { ...next, radio: undefined };
  const queries: string[] = [];
  const room = {
    current: oldRecommendation,
    history: [chosen],
    queue: [],
    playing: true,
    position: 0,
  };
  const selected = await roomRecommendation(room, async (query) => {
    queries.push(query);
    return [third];
  }, undefined, fixtureRadioContent);
  assert.equal(selected?.id, third.id);
  assert(queries[0].includes('"Animals"'));
  assert.equal(
    changeRoom(room, { action: "pause" }, true, 10).radioSeed?.id,
    chosen.id,
  );
});

test("unsafe alternate recordings cannot supply a genre for the original song", async () => {
  const plain = { ...original, genres: [] };
  const taggedTutorial = song(
    "tutorial001",
    "Martin Garrix - Animals (Tutorial)",
    ["synth pop"],
  );
  const valid = song("validsong01", "Martin Garrix - Another Song");
  const queries: string[] = [];
  const result = await roomRecommendation(
    { current: plain, queue: [] },
    async (query) => {
      queries.push(query);
      return queries.length === 1 ? [taggedTutorial] : [valid];
    }, undefined, fixtureRadioContent
  );
  assert.equal(result?.id, valid.id);
  assert(queries[1].startsWith("Martin Garrix audio"));
});

test("the uploader cannot override a different named artist, and genuine song names remain playable", () => {
  const seed = { ...original, genres: [] };
  const other = {
    ...song("unrelated01", "Old Artist - Unrelated"),
    artist: "Martin Garrix",
  };
  const valid = song(
    "goodtitle01",
    "Martin Garrix - How To Love (Official Audio)",
  );
  assert.deepEqual(
    rankRadio(seed, [other, valid], [], []).map((t) => t.id),
    [valid.id],
  );
});

test("unsafe radio suggestions saved by an older build do not block a safe room lookup", async () => {
  const bad = {
    ...song("tutorial001", "Martin Garrix - How to make Animals", [
      "electro house",
    ]),
    radio: true,
    radioContentChecked: 1 as const,
  };
  const state = { current: original, queue: [bad], playing: true, position: 0 };
  const result = await roomRecommendation(state, async () => [third], undefined, fixtureRadioContent);
  assert.equal(result?.id, third.id);
  const advanced = changeRoom(state, { action: "next" }, true, 210, result);
  assert.equal(advanced.current?.id, third.id);
  assert.equal(advanced.queue.length, 0);
});

test("Discord playback drops an older unsafe radio entry while preserving manual choices", async () => {
  const store = new Store(":memory:"),
    engine = new Engine(store, fixtureRadioOwner(new Providers(store, {})), sink());
  try {
    engine.connected = true;
    engine.current = original;
    engine.queue = [
      {
        ...song("tutorial001", "Martin Garrix - How to make Animals", [
          "electro house",
        ]),
        radio: true,
        radioContentChecked: 1 as const,
      },
      third,
    ];
    let selected: Track | null = null;
    engine.startTrack = async (track) => {
      selected = track;
    };
    await engine.startNext();
    assert.equal((selected as Track | null)?.id, third.id);
  } finally {
    engine.close();
    store.close();
  }
});

test("crossfade preparation cannot decode an older instructional radio suggestion", async () => {
  const store = new Store(":memory:"),
    engine = new Engine(store, fixtureRadioOwner(new Providers(store, {})), sink());
  try {
    engine.connected = true;
    engine.current = original;
    engine.queue = [
      {
        ...song("tutorial001", "Martin Garrix - How to make Animals", [
          "electro house",
        ]),
        radio: true,
        radioContentChecked: 1 as const,
      },
    ];
    let prepared = false;
    engine.prepare = async () => {
      prepared = true;
      throw Error("Unsafe lookup");
    };
    assert.equal(
      await engine.preparedNext(original, new AbortController().signal),
      null,
    );
    assert.equal(prepared, false);
    assert.equal(engine.queue.length, 0);
  } finally {
    engine.close();
    store.close();
  }
});

test("an alternate instrumental cannot supply the original recording's genre", async () => {
  const plain = { ...original, genres: [] };
  const alternate = song(
    "instrument1",
    "Martin Garrix - Animals (Instrumental)",
    ["ambient"],
  );
  const valid = song("validsong01", "Martin Garrix - Another Song");
  const queries: string[] = [];
  const result = await roomRecommendation(
    { current: plain, queue: [] },
    async (query) => {
      queries.push(query);
      return queries.length === 1 ? [alternate] : [valid];
    }, undefined, fixtureRadioContent
  );
  assert.equal(result?.id, valid.id);
  assert(queries[1].startsWith("Martin Garrix audio"));
});

test("a broad tag and an unknown uploader cannot establish a radio relationship", () => {
  const seed = {
    ...original,
    title: "Unidentified song",
    artist: "NCS",
    genres: ["pop"],
  };
  const candidate = {
    ...next,
    title: "Another unidentified song",
    artist: "NCS",
    genres: ["pop"],
  };
  assert.deepEqual(rankRadio(seed, [candidate], [], []), []);
});

test("Discord validates a recovered recommendation against the original, not an older drifted track", async () => {
  const store = new Store(":memory:");
  store.set("radio-seed", original);
  const providers = fixtureRadioOwner(new Providers(store, {})),
    engine = new Engine(store, providers, sink());
  try {
    engine.connected = true;
    engine.current = {
      ...song("oldradio001", "Old Artist - Eighties", ["synth pop"]),
      radio: true,
      radioContentChecked: 1 as const,
    };
    providers.radio = async (seed) => {
      assert.equal(seed.id, original.id);
      return third;
    };
    await engine.ensureRadio();
    assert.equal(engine.queue[0]?.id, third.id);
  } finally {
    engine.close();
    store.close();
  }
});
