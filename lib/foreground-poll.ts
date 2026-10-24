/** Poll only while a browser view can use the result, with one request at a time. */
export function startForegroundPolling(refresh: () => Promise<void>, interval = 3000) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => !stopped && !document.hidden && navigator.onLine !== false;
  const poll = async () => {
    clearTimeout(timer);
    if (!active() || running) return;
    running = true;
    try {
      await refresh();
    } finally {
      running = false;
      if (active()) timer = setTimeout(() => void poll(), interval);
    }
  };
  const wake = () => {
    clearTimeout(timer);
    if (active()) void poll();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  window.addEventListener("offline", wake);
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("online", wake);
    window.removeEventListener("offline", wake);
  };
}
