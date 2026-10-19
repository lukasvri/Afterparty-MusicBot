type SafariDocument = Document & {webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void};
type SafariElement = HTMLElement & {webkitRequestFullscreen?: () => void};

export function fullscreenElement(doc: Document): Element | null {
  return doc.fullscreenElement ?? (doc as SafariDocument).webkitFullscreenElement ?? null;
}

export async function enterFullscreen(element: HTMLElement, viewportOnly = false): Promise<boolean> {
  if (viewportOnly) return false;
  const doc = element.ownerDocument;
  if (fullscreenElement(doc) === element) return true;
  try {
    if (typeof element.requestFullscreen === 'function' && doc.fullscreenEnabled !== false) {
      await element.requestFullscreen();
      return true;
    }
    const safari = element as SafariElement;
    if (typeof safari.webkitRequestFullscreen === 'function') {
      safari.webkitRequestFullscreen();
      return true;
    }
  } catch {
    // The calling UI can fill the viewport when the browser refuses native fullscreen.
  }
  return false;
}

export async function leaveFullscreen(element: HTMLElement): Promise<void> {
  const doc = element.ownerDocument;
  if (fullscreenElement(doc) !== element) return;
  if (typeof doc.exitFullscreen === 'function') await doc.exitFullscreen();
  else (doc as SafariDocument).webkitExitFullscreen?.();
}
