'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { browserStorage } from '@/lib/browser-storage';

/** A stable server snapshot keeps hydration consistent with saved browser state. */
export function useBrowserValue(key: string, fallback: string | null = null) {
  const subscribe = useCallback((listener: () => void) => browserStorage.subscribe(key, listener), [key]);
  const snapshot = useCallback(() => browserStorage.get(key) ?? fallback, [key, fallback]);
  const serverSnapshot = useCallback(() => fallback, [fallback]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
export function useClientReady() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
