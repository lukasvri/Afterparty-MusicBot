import type { Track } from './types.ts';

export type ContentDisclosure = 'disclosed' | 'not-observed' | 'unknown';
export type RadioContentVerifier = (track: Pick<Track, 'id' | 'source'>) => Promise<ContentDisclosure>;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const field = (value: unknown, ...keys: string[]): unknown => {
  for (const key of keys) value = object(value)?.[key];
  return value;
};

/** Parse data, never scripts. A changed/partial/foreign watch page is unknown. */
export function youtubeDisclosure(html: string, id: string): ContentDisclosure {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id) || html.length > MAX_PAGE_BYTES ||
    !/<html\b[^>]*\blang=["']en(?:-[A-Za-z]+)?["']/i.test(html)) return 'unknown';
  const marker = /<script\b[^>]*>\s*(?:var\s+)?ytInitialData\s*=\s*(\{)/i.exec(html);
  if (!marker) return 'unknown';
  const start = marker.index + marker[0].length - 1;
  let depth = 0, quoted = false, escaped = false;
  try {
    for (let end = start; end < html.length; end++) {
      const char = html[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        const data = object(JSON.parse(html.slice(start, end + 1)));
        if (field(data, 'currentVideoEndpoint', 'watchEndpoint', 'videoId') !== id) return 'unknown';
        const contents = field(data, 'contents', 'twoColumnWatchNextResults', 'results', 'results', 'contents');
        if (!Array.isArray(contents)) return 'unknown';
        const primary = contents.slice(0, 20).map(item => object(field(item, 'videoPrimaryInfoRenderer')))
          .find(value => typeof field(value, 'title', 'simpleText') === 'string' || Array.isArray(field(value, 'title', 'runs')));
        if (!primary) return 'unknown';
        if (primary.badges !== undefined && !Array.isArray(primary.badges)) return 'unknown';
        for (const badge of Array.isArray(primary.badges) ? primary.badges.slice(0, 20) : []) {
          const renderer = object(field(badge, 'metadataBadgeRenderer'));
          if (renderer?.label === 'AI') return field(renderer, 'accessibilityData', 'label') === 'AI: Content was made with AI'
            ? 'disclosed' : 'unknown';
        }
        const panels = field(data, 'engagementPanels');
        if (panels !== undefined && !Array.isArray(panels)) return 'unknown';
        for (const panel of Array.isArray(panels) ? panels.slice(0, 30) : []) {
          const items = field(panel, 'engagementPanelSectionListRenderer', 'content', 'structuredDescriptionContentRenderer', 'items');
          for (const item of Array.isArray(items) ? items.slice(0, 50) : []) {
            const section = object(field(item, 'howThisWasMadeSectionViewModel'));
            const header = field(section, 'bodyHeader', 'content');
            if (header === 'Made with AI' || header === 'Altered or synthetic content') return 'disclosed';
            if (section && header !== 'Captured with a camera') return 'unknown';
          }
        }
        return 'not-observed';
      }
    }
  } catch { /* malformed upstream data cannot approve automatic playback */ }
  return 'unknown';
}

/** Shared across rooms. Bounded work/cache; unavailable checks are never approval. */
export class YouTubeContent {
  private cached = new Map<string, { at: number; value: ContentDisclosure }>();
  private pending = new Map<string, Promise<ContentDisclosure>>();
  private active = 0;
  private waiting: (() => void)[] = [];
  private request: typeof fetch;
  private now: () => number;
  constructor(request: typeof fetch = (...args) => fetch(...args), now = Date.now) {
    this.request = request; this.now = now;
  }
  check: RadioContentVerifier = async track => {
    if (track.source === 'soundcloud') return 'not-observed';
    if (!/^[A-Za-z0-9_-]{11}$/.test(track.id)) return 'unknown';
    const cached = this.cached.get(track.id);
    if (cached && this.now() - cached.at < (cached.value === 'disclosed' ? 86400000 : 3600000)) return cached.value;
    const pending = this.pending.get(track.id);
    if (pending) return pending;
    if (this.pending.size >= 16) return 'unknown';
    const work = this.read(track.id).then(value => {
      if (value !== 'unknown') {
        this.cached.delete(track.id);
        if (this.cached.size >= 256) this.cached.delete(this.cached.keys().next().value!);
        this.cached.set(track.id, { at: this.now(), value });
      }
      return value;
    }).finally(() => this.pending.delete(track.id));
    this.pending.set(track.id, work);
    return work;
  };
  private acquire(signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', abort);
        this.active++;
        resolve(() => { this.active--; this.waiting.shift()?.(); });
      };
      const abort = () => {
        const index = this.waiting.indexOf(start);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new Error('Radio content check expired.'));
      };
      if (signal.aborted) abort();
      else if (this.active < 2) start();
      else { this.waiting.push(start); signal.addEventListener('abort', abort, { once: true }); }
    });
  }
  private async read(id: string): Promise<ContentDisclosure> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    let release: (() => void) | undefined;
    try {
      release = await this.acquire(controller.signal);
      controller.signal.throwIfAborted();
      const response = await this.request(`https://www.youtube.com/watch?v=${id}&hl=en`, {
        signal: controller.signal, redirect: 'error', headers: { 'Accept-Language': 'en' },
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        return 'unknown';
      }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let bytes = 0, html = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_PAGE_BYTES || controller.signal.aborted) return 'unknown';
          html += decoder.decode(chunk.value, { stream: true });
        }
        html += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
      return controller.signal.aborted ? 'unknown' : youtubeDisclosure(html, id);
    } catch { return 'unknown'; }
    finally { clearTimeout(timer); release?.(); }
  }
}
export const youtubeContent = new YouTubeContent();
export const verifyRadioContent: RadioContentVerifier = track => youtubeContent.check(track);
