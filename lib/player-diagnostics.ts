/** Browser-local, bounded and anonymous. No track IDs, URLs or user data. */
const events: {
  at: number;
  reason: "buffer-start" | "buffer-end" | "correction";
  durationMs: number;
}[] = [];
let corrections = 0,
  interruptions = 0,
  maxBufferMs = 0;
export function notePlayerEvent(
  reason: "buffer-start" | "buffer-end" | "correction",
  durationMs = 0,
) {
  if (reason === "correction") corrections++;
  if (reason === "buffer-start") interruptions++;
  if (reason === "buffer-end") maxBufferMs = Math.max(maxBufferMs, durationMs);
  events.push({
    at: Date.now(),
    reason,
    durationMs: Math.max(0, Math.round(durationMs)),
  });
  if (events.length > 50) events.shift();
}
export function playerDiagnostics() {
  return {
    corrections,
    interruptions,
    maxBufferMs: Math.round(maxBufferMs),
    events: [...events],
  };
}
