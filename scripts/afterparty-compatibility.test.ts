import { test } from "node:test";
import assert from "node:assert/strict";
import { readBrowserValue } from "../lib/browser-storage.ts";
import { visitorIdentity } from "../lib/visitor-identity.ts";

test("saved room ownership, visitor identity and every preference survive the namespace migration", () => {
  const keys = [
    "host:TESTROOM",
    "visitor",
    "audio",
    "volume",
    "sync-offset",
    "sync-mode-v1",
    "motion",
  ];
  const values = new Map(keys.map((k: string) => ["muse-" + k, "saved-" + k]));
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  };
  for (const key of keys) {
    assert.equal(
      readBrowserValue(storage, "afterparty-" + key),
      "saved-" + key,
    );
    assert.equal(values.get("afterparty-" + key), "saved-" + key);
  }
  values.set("afterparty-audio", "new-choice");
  assert.equal(readBrowserValue(storage, "afterparty-audio"), "new-choice");
  assert.equal(readBrowserValue(storage, "afterparty-host:NEWROOM"), null);
});
test("read-only browser storage still returns existing ownership", () => {
  const storage = {
    getItem: (k: string) => (k === "muse-host:TESTROOM" ? "saved-token" : null),
    setItem: () => {
      throw Error("quota");
    },
  };
  assert.equal(
    readBrowserValue(storage, "afterparty-host:TESTROOM"),
    "saved-token",
  );
});
test("new visitor header takes precedence and existing clients remain recognized", () => {
  assert.equal(
    visitorIdentity(new Headers({ "X-Muse-Visitor": "old" })),
    "old",
  );
  assert.equal(
    visitorIdentity(
      new Headers({ "X-Afterparty-Visitor": "new", "X-Muse-Visitor": "old" }),
    ),
    "new",
  );
  assert.equal(visitorIdentity(new Headers()), null);
});

test("blocked browser persistence retains host credentials for the current page", async () => {
  const { browserStorage } = await import("../lib/browser-storage.ts");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw Error("blocked");
      },
      setItem() {
        throw Error("blocked");
      },
    },
  });
  try {
    assert.equal(
      browserStorage.set("afterparty-host:SYNTHETC", "synthetic"),
      false,
    );
    assert.equal(browserStorage.get("afterparty-host:SYNTHETC"), "synthetic");
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("evening imports validate limits and preserve an existing library on malformed input", async () => {
  const { readLibrary } = await import("../lib/evening-library.ts");
  assert.throws(() =>
    readLibrary('{"version":1,"evenings":[],"favorites":[{"id":"invalid"}]}'),
  );
  assert.throws(() =>
    readLibrary(
      JSON.stringify({
        version: 1,
        evenings: Array(31).fill({}),
        favorites: [],
      }),
    ),
  );
  assert.deepEqual(readLibrary(null), {
    version: 1,
    evenings: [],
    favorites: [],
  });
  const saved = {
    version: 1,
    evenings: [{ id: "one", name: "Friday", savedAt: 1, tracks: [] }],
    favorites: [],
  };
  assert.deepEqual(readLibrary(JSON.stringify(saved)), saved);
});
