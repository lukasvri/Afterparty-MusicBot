const targetOrigin = "https://ap.openworks.no";

function maintenanceResponse() {
  return new Response("Afterparty is moving hosts. Please try again shortly.", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": "30",
    },
  });
}

// Run before the application handler so a retired host cannot write to its DB.
export function hostingTransition(request: Request, mode?: unknown): Response | null {
  if (mode === undefined || mode === "") return null;
  if (mode !== "redirect") return maintenanceResponse();

  const source = new URL(request.url);
  if (source.origin === targetOrigin) return maintenanceResponse();

  const target = new URL(targetOrigin);
  target.pathname = source.pathname;
  target.search = source.search;
  return new Response(null, {
    status: 307,
    headers: { Location: target.href, "Cache-Control": "no-store" },
  });
}
