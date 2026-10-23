export type ApiBinding = { fetch(request: Request): Promise<Response> };

/** Only the dedicated beta Worker changes its landing page. */
export function betaEntry(request: Request, enabled: boolean): Response | null {
  const url = new URL(request.url);
  if (
    !enabled ||
    !['GET', 'HEAD'].includes(request.method) ||
    url.pathname !== '/' ||
    url.searchParams.get('classic') === '1'
  )
    return null;
  return Response.redirect(new URL(`/v3${url.search}`, url.origin), 307);
}

/** Preserve the public URL, cookies, method and streaming body for legacy guards. */
export async function bridge(request: Request, api?: ApiBinding): Promise<Response> {
  if (!api)
    return Response.json(
      { error: 'The Afterparty API is unavailable.' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  try {
    return await api.fetch(request);
  } catch {
    return Response.json(
      { error: 'The Afterparty API is unavailable. Please reconnect.' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
