import type { SocialState } from "../services/core/src/social-protocol.ts";

/** Device-local receipt time prevents repeated snapshots restarting an animation. */
export function createReactionWindow(now: () => number) {
  const received = new Map<string, number>();
  return {
    merge(previous: SocialState["reactions"], next: SocialState["reactions"]) {
      const at = now();
      for (const reaction of next)
        if (!received.has(reaction.id)) received.set(reaction.id, at);
      const merged = [...new Map(
        [...previous, ...next]
          .filter(reaction => at - (received.get(reaction.id) ?? -Infinity) < 6000)
          .map(reaction => [reaction.id, reaction]),
      ).values()].slice(-20);
      // Keep expired IDs long enough that a repeated frame cannot revive them.
      for (const [id, seen] of received) if (at - seen > 60000) received.delete(id);
      while (received.size > 200) received.delete(received.keys().next().value!);
      return merged;
    },
    clear() { received.clear(); },
  };
}
