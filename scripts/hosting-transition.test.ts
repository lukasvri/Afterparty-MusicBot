import { test } from "node:test";
import assert from "node:assert/strict";
import { hostingTransition } from "../lib/hosting-transition.ts";

const oldOrigin = "https://retired.example.com";

test("an absent or empty transition leaves normal handling unchanged", () => {
  const request = new Request(`${oldOrigin}/api/rooms`);
  assert.equal(hostingTransition(request), null);
  assert.equal(hostingTransition(request, ""), null);
});

test("hold blocks reads and writes before the application handler", async () => {
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = hostingTransition(new Request(`${oldOrigin}/api/rooms`, { method }), "hold");
    assert.ok(response);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Retry-After"), "30");
    assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assert.equal(await response.text(), "Afterparty is moving hosts. Please try again shortly.");
  }
});

test("redirect preserves the method, path and query on the fixed target", () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    const response = hostingTransition(new Request(`${oldOrigin}/api/rooms/a%20b?view=all&next=https%3A%2F%2Fevil.example`, { method }), "redirect");
    assert.ok(response);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("Location"), "https://ap.openworks.no/api/rooms/a%20b?view=all&next=https%3A%2F%2Fevil.example");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("a network-path-looking source path cannot replace the fixed destination", () => {
  const response = hostingTransition(new Request(`${oldOrigin}//evil.example/path?x=1`), "redirect");
  assert.equal(response?.headers.get("Location"), "https://ap.openworks.no//evil.example/path?x=1");
});

test("the target origin fails closed instead of redirecting to itself", () => {
  for (const url of ["https://ap.openworks.no/", "https://ap.openworks.no:443/api/rooms?x=1"]) {
    const response = hostingTransition(new Request(url), "redirect");
    assert.equal(response?.status, 503);
    assert.equal(response?.headers.get("Location"), null);
    assert.equal(response?.headers.get("Retry-After"), "30");
  }
});

test("unknown transition settings fail closed", () => {
  for (const mode of ["redirect ", " HOLD", "resume", null, false, 0, {}]) {
    const response = hostingTransition(new Request(`${oldOrigin}/`), mode);
    assert.equal(response?.status, 503);
    assert.equal(response?.headers.get("Cache-Control"), "no-store");
    assert.equal(response?.headers.get("Location"), null);
  }
});
