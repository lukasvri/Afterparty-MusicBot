import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import type { BrowserOptions, Event, EventHint } from "@sentry/browser";
import type { Envelope, EventEnvelope } from "@sentry/core";
import { errorReportingOptions, initializeErrorReporting, sanitizeErrorEnvelope, sanitizeErrorEvent, validErrorDsn } from "../lib/error-reporting.ts";

const dsn = "https://" + "a".repeat(32) + "@o123.ingest.us.sentry.io/456";
const sensitive = "private-room-token-guild-111111111111111@example.invalid";
const event = (): Event => ({
  event_id: "b".repeat(32), timestamp: 123456,
  message: sensitive, request: { url: `https://site.invalid/?room=${sensitive}`, headers: { Authorization: sensitive }, data: sensitive },
  user: { id: sensitive, email: sensitive }, extra: { token: sensitive }, contexts: { trace: { trace_id: sensitive, span_id: sensitive } },
  breadcrumbs: [{ message: sensitive }], tags: { guild: sensitive }, fingerprint: [sensitive],
  exception: { values: [{ type: "TypeError", value: sensitive, stacktrace: { frames: [
    { filename: `https://site.invalid/_next/static/chunks/${sensitive}.js?token=${sensitive}`, function: sensitive, lineno: 12, colno: 8, vars: { token: sensitive }, context_line: sensitive },
    { filename: `https://provider.invalid/${sensitive}`, lineno: 3 },
  ] } }] },
});

test("Sentry DSNs require explicit official HTTPS configuration", () => {
  assert(validErrorDsn(dsn));
  assert(validErrorDsn(dsn.replace(".us.", ".de.")));
  for (const invalid of [undefined, "", "http://invalid", dsn.replace("https:", "http:"), dsn+"?token=private", dsn.replace("sentry.io", "attacker.invalid"), dsn.replace("@", ":password@")])
    assert.equal(validErrorDsn(invalid), false);
});

test("missing DSN leaves browser reporting off without network or SDK initialization", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network"); });
  assert.equal(await initializeErrorReporting(undefined, "classic"), false);
  assert.equal(await initializeErrorReporting("", "v3"), false);
  assert.equal(fetch.mock.calls.length, 0);
});

test("error allowlist strips private event fields, messages, stack URLs and source context", () => {
  const clean = sanitizeErrorEvent(event(), "classic");
  assert(clean);
  assert(!JSON.stringify(clean).includes(sensitive));
  assert.deepEqual(clean.tags, { surface: "classic" });
  assert.deepEqual(clean.exception?.values?.[0].stacktrace?.frames, [{ filename: "app:///classic/bundle.js", lineno: 12, colno: 8, in_app: true }]);
  assert.equal(clean.exception?.values?.[0].value, "Application error (details redacted)");
  assert.deepEqual(sanitizeErrorEvent(clean, "classic"), clean, "transport sanitation is idempotent");
  assert.equal(sanitizeErrorEvent({ message: sensitive }, "classic"), null);
  assert.equal(sanitizeErrorEvent({ ...event(), type: "transaction" }, "classic"), null);
  assert.equal(sanitizeErrorEvent({ exception: { values: [{ type: "Error", stacktrace: { frames: [{ filename: "chrome-extension://private/file.js" }] } }] } }, "classic"), null);
});

test("transport removes attachments and all non-error envelope items and metadata", () => {
  const envelope: EventEnvelope = [{ event_id: "b".repeat(32), sent_at: sensitive, trace: { public_key: sensitive }, private: sensitive }, [
    [{ type: "attachment", length: sensitive.length, filename: sensitive }, sensitive],
    [{ type: "event", private: sensitive }, event()],
  ]];
  const clean = sanitizeErrorEnvelope(envelope, "v3");
  assert(!JSON.stringify(clean).includes(sensitive));
  assert.equal(clean[1].length, 1);
  assert.deepEqual(clean[1][0][0], { type: "event" });
  assert.equal(clean[0].event_id, "b".repeat(32));
  assert.equal(sanitizeErrorEnvelope([{ event_id: "b".repeat(32), sent_at: "" }, [[{ type: "attachment", length: 1, filename: "x" }, "x"]]], "v3")[1].length, 0);
});

test("SDK policy disables data collection and caps accepted sampled errors at five per page", async () => {
  const options = errorReportingOptions(dsn, "classic");
  assert.equal(options.defaultIntegrations, false);
  assert.equal(options.sampleRate, 0.1);
  assert.equal(options.maxBreadcrumbs, 0);
  assert.equal(options.sendClientReports, false);
  assert.equal(options.tracesSampleRate, undefined);
  assert.equal(options.beforeSendLog?.({ level: "error", message: sensitive }), null);
  assert.equal(options.beforeBreadcrumb?.({ message: sensitive }, {}), null);
  for (let n = 0; n < 6; n++) {
    const hint: EventHint = { attachments: [{ filename: "private.txt", data: sensitive }] };
    const clean = await options.beforeSend?.({ ...event(), type: undefined }, hint);
    assert.equal(clean !== null, n < 5);
    assert.deepEqual(hint.attachments, []);
  }
  assert.deepEqual(options.dataCollection, {
    userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
    genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false }, graphQL: { document: false, variables: false },
    databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0,
  });
});

test("configured browser SDK uses only global errors and privacy-filtered transport", async t => {
  const fixture: { loaded: number; options?: BrowserOptions; requests: Envelope[]; transportOptions?: { fetchOptions?: RequestInit } } = { loaded: 0, requests: [] };
  const globals = globalThis as typeof globalThis & { __errorReportingFixture?: typeof fixture };
  globals.__errorReportingFixture = fixture;
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier !== "@sentry/browser") return next(specifier, context);
    fixture.loaded++;
    return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(`
      const fixture=globalThis.__errorReportingFixture;
      export const init=options=>{fixture.options=options;};
      export const globalHandlersIntegration=options=>({name:'GlobalHandlers',options});
      export const dedupeIntegration=()=>({name:'Dedupe'});
      export const makeFetchTransport=options=>{fixture.transportOptions=options;return {flush:async()=>true,send:async envelope=>{fixture.requests.push(envelope);return {statusCode:200};}};};
    `) };
  } });
  t.after(() => {
    hooks.deregister(); delete globals.__errorReportingFixture;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
  });
  assert.equal(await initializeErrorReporting(undefined, "classic"), false);
  assert.equal(await initializeErrorReporting("malformed", "v3"), false);
  assert.equal(fixture.loaded, 0);
  assert.equal(await initializeErrorReporting(dsn, "classic"), true);
  const options = fixture.options!;
  assert.deepEqual(options.integrations, [
    { name: "GlobalHandlers", options: { onerror: true, onunhandledrejection: true } }, { name: "Dedupe" },
  ]);
  const transport = options.transport!({ url: "https://ingest.sentry.io", recordDroppedEvent: () => {} });
  const raw: EventEnvelope = [{ event_id: "b".repeat(32), sent_at: sensitive }, [
    [{ type: "event" }, event()], [{ type: "attachment", filename: sensitive, length: 1 }, sensitive],
  ]];
  await transport.send(raw);
  assert.equal(fixture.requests.length, 1);
  assert(!JSON.stringify(fixture.requests).includes(sensitive));
  await transport.send([{ sent_at: "" }, [[{ type: "session" }, { sid: sensitive, init: true, started: "", timestamp: "", status: "ok", errors: 0, attrs: { release: sensitive } }]]]);
  assert.equal(fixture.requests.length, 1, "non-error envelopes cannot cause a request");
  assert.deepEqual(fixture.transportOptions?.fetchOptions, { credentials: "omit", referrerPolicy: "no-referrer" });
  assert.equal(await initializeErrorReporting(dsn, "classic"), false, "re-mount does not install duplicate handlers");
});
