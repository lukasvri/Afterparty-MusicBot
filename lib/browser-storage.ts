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
// Only observed keys use the snapshot cache, including missing preferences.
// Unobserved keys retain the existing storage and in-memory fallback behavior.
const snapshots = new Map<string, string | null>();
const subscriptions = new Map<string, {
  listeners: Set<() => void>;
  changed: (event: StorageEvent) => void;
}>();
export const browserStorage = {
  subscribe(key: string, listener: () => void) {
    let subscription = subscriptions.get(key);
    if (!subscription) {
      const listeners = new Set<() => void>();
      const changed = (event: StorageEvent) => {
        if (event.key === null || event.key === key || event.key === key.replace(/^afterparty-/, 'muse-')) {
          memory.delete(key);
          snapshots.delete(key);
          listeners.forEach(notify => notify());
        }
      };
      subscription = {listeners, changed};
      subscriptions.set(key, subscription);
      window.addEventListener('storage', changed);
    }
    subscription.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      subscription.listeners.delete(listener);
      if (!subscription.listeners.size) {
        subscriptions.delete(key);
        snapshots.delete(key);
        window.removeEventListener('storage', subscription.changed);
      }
    };
  },
  get(key: string) {
    if (memory.has(key)) return memory.get(key)!;
    if (snapshots.has(key)) return snapshots.get(key)!;
    try {
      const value = readBrowserValue(localStorage, key);
      if (subscriptions.has(key)) snapshots.set(key, value);
      return value;
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    let saved = true;
    try {
      localStorage.setItem(key, value);
      memory.delete(key);
      if (subscriptions.has(key)) snapshots.set(key, value);
    } catch {
      memory.set(key, value);
      saved = false;
    }
    subscriptions.get(key)?.listeners.forEach(listener => listener());
    return saved;
  },
};
