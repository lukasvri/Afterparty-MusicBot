import type { BrowserOptions, ErrorEvent, Event, StackFrame } from "@sentry/browser";
import type { EventEnvelope } from "@sentry/core";

export type ErrorSurface = "classic" | "v3";
type Transport = ReturnType<NonNullable<BrowserOptions["transport"]>>;
type Envelope = Parameters<Transport["send"]>[0];
const errorTypes = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);

/** Public browser DSNs only. Missing/malformed configuration never loads the SDK. */
export function validErrorDsn(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^[a-f0-9]{16,64}$/i.test(url.username) && !url.password &&
      /^(?:o\d+\.)?ingest(?:\.[a-z]+)?\.sentry\.io$/.test(url.hostname) && /^\/\d+$/.test(url.pathname) && !url.search && !url.hash && !url.port;
  } catch { return false; }
}

function safeFrame(frame: StackFrame): StackFrame | null {
  try {
    const path = new URL(frame.filename ?? "", "https://redacted.invalid").pathname;
    const category = path.startsWith("/_next/static/") || frame.filename === "app:///classic/bundle.js" ? "classic"
      : path.startsWith("/afterparty-app/immutable/") || frame.filename === "app:///v3/bundle.js" ? "v3" : null;
    if (!category) return null;
    return {
      filename: `app:///${category}/bundle.js`,
      ...(Number.isSafeInteger(frame.lineno) && Number(frame.lineno) > 0 ? { lineno: frame.lineno } : {}),
      ...(Number.isSafeInteger(frame.colno) && Number(frame.colno) > 0 ? { colno: frame.colno } : {}),
      in_app: true,
    };
  } catch { return null; }
}

/** Allowlist, rather than editing potentially sensitive request/user/exception data. */
export function sanitizeErrorEvent(event: Event, surface: ErrorSurface): ErrorEvent | null {
  if (event.type || !event.exception?.values?.length) return null;
  const values = event.exception.values.slice(0, 3).map(exception => ({
    type: errorTypes.has(exception.type ?? "") ? exception.type : "Error",
    value: "Application error (details redacted)",
    stacktrace: { frames: (exception.stacktrace?.frames ?? []).slice(-20).map(safeFrame).filter((frame): frame is StackFrame => frame !== null) },
  })).filter(exception => exception.stacktrace.frames.length > 0);
  if (!values.length) return null;
  return {
    type: undefined,
    ...(typeof event.event_id === "string" && /^[a-f0-9]{32}$/i.test(event.event_id) ? { event_id: event.event_id } : {}),
    ...(Number.isFinite(event.timestamp) ? { timestamp: event.timestamp } : {}),
    platform: "javascript",
    level: "error",
    tags: { surface },
    exception: { values },
  };
}

/** Enforce error-only transport even if another caller adds attachments or scope data. */
export function sanitizeErrorEnvelope(envelope: Envelope, surface: ErrorSurface): EventEnvelope {
  const items: EventEnvelope[1] = [];
  let eventId = crypto.randomUUID().replaceAll("-", "");
  for (const [header, payload] of envelope[1]) {
    if (header.type !== "event" || !payload || typeof payload !== "object") continue;
    const event = sanitizeErrorEvent(payload as Event, surface);
    if (event) { eventId = event.event_id ?? eventId; items.push([{ type: "event" }, event]); break; }
  }
  return [{ event_id: eventId, sent_at: new Date().toISOString() }, items];
}

export function errorReportingOptions(dsn: string, surface: ErrorSurface): BrowserOptions {
  return {
    dsn,
    defaultIntegrations: false,
    maxBreadcrumbs: 0,
    sendClientReports: false,
    sampleRate: 0.1,
    tracePropagationTargets: [],
    dataCollection: {
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
      genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false }, databaseQueryData: false, queues: false,
      stackFrameVariables: false, frameContextLines: 0,
    },
    beforeBreadcrumb: () => null,
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
    beforeSend(event, hint) {
      hint.attachments = [];
      return sanitizeErrorEvent(event, surface);
    },
  };
}

/** The SDK samples after beforeSend, so count only sampled transport events. */
export function errorReportingTransport(transport: Transport, surface: ErrorSurface): Transport {
  let accepted = 0;
  return {
    flush: timeout => transport.flush(timeout),
    send(envelope) {
      const clean = sanitizeErrorEnvelope(envelope, surface);
      if (!clean[1].length || accepted >= 5) return Promise.resolve({ statusCode: 200 });
      accepted++;
      return transport.send(clean);
    },
  };
}

let started = false;
export async function initializeErrorReporting(dsn: string | undefined, surface: ErrorSurface): Promise<boolean> {
  if (started || typeof window === "undefined" || !validErrorDsn(dsn)) return false;
  started = true;
  try {
    const sdk = await import("@sentry/browser");
    sdk.init({
      ...errorReportingOptions(dsn, surface),
      integrations: [sdk.globalHandlersIntegration({ onerror: true, onunhandledrejection: true }), sdk.dedupeIntegration()],
      transport(options) {
        const transport = sdk.makeFetchTransport({ ...options, bufferSize: 5,
          fetchOptions: { credentials: "omit", referrerPolicy: "no-referrer" } });
        return errorReportingTransport(transport, surface);
      },
    });
    return true;
  } catch {
    // Optional diagnostics must not break playback, navigation or application startup.
    return false;
  }
}
