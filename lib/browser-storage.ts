/** Migrate saved browser state lazily without losing room ownership or preferences. */
export function readBrowserValue(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
): string | null {
  const current = storage.getItem(key);
  if (current !== null) return current;
  // This is an input format only. New state always uses the Afterparty namespace.
  const previous = key.startsWith("afterparty-")
    ? storage.getItem(key.replace(/^afterparty-/, "muse-"))
    : null;
  if (previous !== null) {
    try {
      storage.setItem(key, previous);
    } catch {
      /* Return the saved value even when storage is read-only. */
    }
  }
  return previous;
}
const memory = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
export const browserStorage = {
  subscribe(key: string, listener: () => void) {
    const subscribers = listeners.get(key) ?? new Set<() => void>();
    listeners.set(key, subscribers);
    subscribers.add(listener);
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === key || event.key === key.replace(/^afterparty-/, 'muse-')) {
        memory.delete(key);
        listener();
      }
    };
    window.addEventListener('storage', changed);
    return () => {
      subscribers.delete(listener);
      if (!subscribers.size) listeners.delete(key);
      window.removeEventListener('storage', changed);
    };
  },
  get(key: string) {
    if (memory.has(key)) return memory.get(key)!;
    try {
      return readBrowserValue(localStorage, key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    memory.set(key, value);
    let saved = true;
    try {
      localStorage.setItem(key, value);
    } catch {
      saved = false;
    }
    listeners.get(key)?.forEach(listener => listener());
    return saved;
  },
};
