/** Catalog extraction can outlast ordinary state reads. Keep the browser's
 * budget outside the Core bridge deadline so a slow successful result can arrive.
 * These are bounded reads only; they do not retry playback commands.
 */
export function browserRequestTimeoutMs(path: string): number {
  const pathname = path.split('?')[0];
  return pathname === '/api/search' || pathname === '/api/videos' ? 75000 : 12000;
}
export function coreRequestTimeoutMs(path: string): number {
  return path.split('?')[0] === '/v1/catalog' ? 60000 : 25000;
}
