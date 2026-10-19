import type { Video } from './types';

/** YouTube artwork must share the Activity origin, which Discord's CSP allows. */
export function artworkUrl(video: Pick<Video, 'id' | 'source' | 'image'>) {
  if (video.source !== 'soundcloud' && /^[\w-]{11}$/.test(video.id))
    return '/api/artwork/youtube/' + video.id;
  return video.image || '/afterparty-mark.svg';
}

/** Fixed-host public images only. No arbitrary URL, redirects, cookies or tokens. */
export async function youtubeArtwork(request: Request, id: string): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, {status:405});
  if (!/^[\w-]{11}$/.test(id)) return new Response(null, {status:400});
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const upstream = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, {
      signal, redirect:'manual', credentials:'omit', headers:{Accept:'image/jpeg'},
    });
    if (!upstream.ok || upstream.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') {
      await upstream.body?.cancel();
      return new Response(null, {status:404});
    }
    const reader = upstream.body?.getReader();
    if (!reader) return new Response(null, {status:502});
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256 * 1024) { await reader.cancel(); return new Response(null, {status:502}); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {body.set(chunk,offset);offset += chunk.length;}
    if (size < 3 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) return new Response(null,{status:502});
    return new Response(request.method === 'HEAD' ? null : body, {headers:{
      'Content-Type':'image/jpeg', 'Content-Length':String(size),
      'Cache-Control':'public, max-age=3600, s-maxage=86400', 'X-Content-Type-Options':'nosniff',
    }});
  } catch { return new Response(null, {status:502}); }
}
