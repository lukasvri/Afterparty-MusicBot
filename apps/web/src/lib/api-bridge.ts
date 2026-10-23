export type ApiBinding = { fetch(request: Request): Promise<Response> };

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
