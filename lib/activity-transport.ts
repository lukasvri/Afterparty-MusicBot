/** Install only while the authenticated Activity view is mounted. No OAuth token enters this transport. */
export function installActivityTransport() {
  const previous = window.fetch;
  const transport: typeof fetch = (input, init) => {
    const request = new Request(input instanceof Request ? input : new URL(String(input), location.href), init);
    const original = new URL(request.url);
    if (original.origin !== location.origin || !original.pathname.startsWith("/api/") || (original.pathname === "/api/activity" || original.pathname.startsWith("/api/activity/")))
      return previous.call(window, input, init);
    const target = new URL("/api/activity/bridge", location.origin);
    target.searchParams.set("path", original.pathname + original.search);
    const headers = new Headers(request.headers);
    // Standalone room capabilities never belong in an Activity session.
    headers.delete("Authorization");
    headers.delete("X-Afterparty-Visitor");
    return previous.call(window, new Request(target, new Request(request, { headers, credentials: "same-origin" })));
  };
  window.fetch = transport;
  return () => { if (window.fetch === transport) window.fetch = previous; };
}
