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

test("browser subscriptions notify same-page edits, isolate keys and unsubscribe", async () => {
  const { browserStorage } = await import("../lib/browser-storage.ts");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const events = new EventTarget(), values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {configurable:true, value:events});
  Object.defineProperty(globalThis, "localStorage", {configurable:true, value:{
    getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>values.set(key,value),
  }});
  let notifications = 0;
  const key = "afterparty-synthetic-subscription";
  const unsubscribe = browserStorage.subscribe(key, () => {notifications++;});
  try {
    assert(browserStorage.set(key, "first"));
    assert.equal(browserStorage.get(key), "first");
    assert.equal(notifications, 1);
    browserStorage.set(key + "-other", "other");
    assert.equal(notifications, 1);
    values.set(key, "another-tab");
    const changed = new Event("storage");
    Object.defineProperty(changed, "key", {value:key});
    events.dispatchEvent(changed);
    assert.equal(browserStorage.get(key), "another-tab");
    assert.equal(notifications, 2);
    unsubscribe();
    browserStorage.set(key, "after-unsubscribe");
    events.dispatchEvent(changed);
    assert.equal(notifications, 2);
  } finally {
    unsubscribe();
    if(originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if(originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("blocked storage still notifies subscribers and cross-tab clearing invalidates memory", async () => {
  const { browserStorage } = await import("../lib/browser-storage.ts");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", {configurable:true, value:events});
  Object.defineProperty(globalThis, "localStorage", {configurable:true, value:{
    getItem:()=>null,
    setItem:()=>{throw Error("blocked");},
  }});
  let notifications = 0;
  const key = "afterparty-synthetic-blocked-subscription";
  const unsubscribe = browserStorage.subscribe(key, () => {notifications++;});
  try {
    assert.equal(browserStorage.set(key, "remembered"), false);
    assert.equal(browserStorage.get(key), "remembered");
    assert.equal(notifications, 1);
    const cleared = new Event("storage");
    Object.defineProperty(cleared, "key", {value:null});
    events.dispatchEvent(cleared);
    assert.equal(browserStorage.get(key), null);
    assert.equal(notifications, 2);
  } finally {
    unsubscribe();
    if(originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if(originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("observed browser snapshots avoid repeated storage reads and share event invalidation", async () => {
  const { browserStorage } = await import("../lib/browser-storage.ts");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const events = new EventTarget();
  const key = "afterparty-counted-snapshot", missing = key + "-missing";
  const values = new Map([[key, "saved"]]);
  let reads = 0, notifications = 0;
  Object.defineProperty(globalThis, "window", {configurable:true, value:events});
  Object.defineProperty(globalThis, "localStorage", {configurable:true, value:{
    getItem:(name:string)=>{reads++;return values.get(name)??null;},
    setItem:(name:string,value:string)=>values.set(name,value),
  }});
  const notify = () => { notifications++; browserStorage.get(key); };
  const unsubscribe = browserStorage.subscribe(key, notify);
  const unsubscribeOther = browserStorage.subscribe(key, () => notify());
  const unsubscribeMissing = browserStorage.subscribe(missing, () => {});
  try {
    for(let i=0;i<100;i++) assert.equal(browserStorage.get(key), "saved");
    assert.equal(reads, 1, "100 unchanged observed reads need one storage read");
    reads = 0;
    for(let i=0;i<100;i++) assert.equal(browserStorage.get(missing), null);
    assert.equal(reads, 2, "A missing preference checks current and legacy storage once");
    values.set(key, "another-tab");
    const changed = new Event("storage");
    Object.defineProperty(changed, "key", {value:key});
    reads = 0;
    events.dispatchEvent(changed);
    assert.equal(reads, 1, "All observers share the invalidated snapshot");
    assert.equal(notifications, 2);
    assert.equal(browserStorage.get(key), "another-tab");
    browserStorage.set(key, "same-page");
    assert.equal(browserStorage.get(key), "same-page");
    assert.equal(notifications, 4);
    unsubscribe(); unsubscribeOther(); unsubscribeMissing();
    values.set(missing, "saved-after-unsubscribe");
    assert.equal(browserStorage.get(missing), "saved-after-unsubscribe", "Unobserved reads must not retain snapshots");
    reads = 0;
    const credential = "afterparty-host:UNOBSERV";
    values.set(credential, "first");
    assert.equal(browserStorage.get(credential), "first");
    values.set(credential, "second");
    assert.equal(browserStorage.get(credential), "second");
    assert.equal(reads, 2, "Unobserved credentials continue to read actual storage");
  } finally {
    unsubscribe(); unsubscribeOther(); unsubscribeMissing();
    if(originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if(originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("evening tracks preserve first occurrence and order with one ID read per input", async () => {
  const { uniqueEveningTracks } = await import("../lib/evening-library.ts");
  type Video = import("../lib/types.ts").Video;
  let reads = 0;
  const videos = Array.from({length:151}, (_,i) => ({
    get id(){reads++;return String(i).padStart(11,"0");},
  }) as Video);
  assert.deepEqual(uniqueEveningTracks(videos.slice(0,100),videos.slice(100)), videos);
  assert.equal(reads, 151, "Deduplication must scan each input ID once");
  const first = {id:"abcdefghijk",title:"First selection"} as Video;
  const other = {id:"lmnopqrstuv",title:"Other selection"} as Video;
  const duplicate = {...first,title:"Later metadata"};
  const invalid = {id:"not a valid YouTube ID"} as Video;
  assert.deepEqual(uniqueEveningTracks([first,invalid,other],[duplicate,other]),[first,other]);
});

test("successful browser writes stay fresh while a key has no subscribers", async () => {
  const { browserStorage } = await import("../lib/browser-storage.ts");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const events = new EventTarget();
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {configurable:true, value:events});
  Object.defineProperty(globalThis, "localStorage", {configurable:true, value:{
    getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>values.set(key,value),
  }});
  const credential = "afterparty-host:FRESHKEY";
  const preference = "afterparty-synthetic-remount";
  let unsubscribe = () => {};
  try {
    assert.equal(browserStorage.set(credential, "old-token"), true);
    values.set(credential, "replacement-token");
    assert.equal(browserStorage.get(credential), "replacement-token", "Unobserved credentials must see another tab's replacement after a local write");
    values.delete(credential);
    assert.equal(browserStorage.get(credential), null, "Removed credentials must not survive in memory");

    unsubscribe = browserStorage.subscribe(preference, () => {});
    browserStorage.set(preference, "old-choice");
    assert.equal(browserStorage.get(preference), "old-choice");
    unsubscribe();
    values.set(preference, "new-choice");
    unsubscribe = browserStorage.subscribe(preference, () => {});
    assert.equal(browserStorage.get(preference), "new-choice", "Remount must read changes made while unsubscribed");
  } finally {
    unsubscribe();
    if(originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if(originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
