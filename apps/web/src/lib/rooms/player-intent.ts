export type PlayerIntent = { action: 'play' | 'pause' | 'seek'; position?: number; local?: true };
export type PlayerIntentReceipt = { accepted: boolean; version?: number };
type Observation = {
  identity: string;
  state: number;
  position: number;
  now: number;
  gesture: boolean;
};
export const POSITION_ACK_TOLERANCE = 2.25;

/** A queued scrub may already be playing by the time the previous receipt arrives.
 * Keep its observed progress, but reject cached backward or unrelated jumps. */
export function refreshQueuedSeek(
  intent: PlayerIntent,
  position: number,
  elapsedMs: number,
  duration: number,
): PlayerIntent {
  if (
    intent.action !== 'seek' ||
    !Number.isFinite(intent.position) ||
    !Number.isFinite(position) ||
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(duration) ||
    elapsedMs < 0 ||
    intent.position! < 0 ||
    intent.position! >= duration ||
    position >= duration ||
    position < intent.position! ||
    position > intent.position! + elapsedMs / 1000 + POSITION_ACK_TOLERANCE
  )
    return intent;
  return { ...intent, position };
}

/** A receipt alone is not a fresh shared timeline. Allow playback progress
 * between the seek and the next authoritative sample, including a delayed start. */
export function confirmsPlayerIntent(
  intent: PlayerIntent,
  sample: {
    version: number;
    previousVersion: number;
    playing: boolean;
    position: number;
    elapsed: number;
  },
): boolean {
  if (sample.version <= sample.previousVersion) return false;
  if (intent.action !== 'seek') return sample.playing === (intent.action === 'play');
  if (!Number.isFinite(intent.position) || !Number.isFinite(sample.position)) return false;
  const progress = sample.playing ? Math.max(0, sample.elapsed) / 1000 : 0;
  return (
    sample.position >= intent.position! - 0.75 &&
    sample.position <= intent.position! + progress + 0.75
  );
}

/** Native iframe events carry no user-intent flag. Require recent browser activation,
 * a focused current iframe and an observed change, and suppress our own API writes. */
export function createPlayerIntent() {
  let identity = '',
    state = -1;
  let sample: { position: number; at: number; state: number } | null = null;
  let expected: { state: number; until: number } | null = null;
  let positionUntil = 0;
  let expectedPosition: {
    position: number;
    at: number;
    until: number;
    playing: boolean;
    kind: 'load' | 'cue' | 'seek';
  } | null = null;
  const reset = (key: string) => {
    identity = key;
    state = -1;
    sample = null;
    expected = null;
    positionUntil = 0;
    expectedPosition = null;
  };
  return {
    reset,
    command(
      key: string,
      action: 'load' | 'cue' | 'play' | 'pause' | 'seek',
      now: number,
      position?: number,
    ) {
      if (key !== identity) reset(key);
      if (action !== 'seek') {
        const target = action === 'cue' ? 5 : action === 'pause' ? 2 : 1;
        expected = target === state ? null : { state: target, until: now + 3000 };
      }
      if (action === 'load' || action === 'cue' || action === 'seek') {
        sample = null;
        expectedPosition = Number.isFinite(position)
          ? {
              position: position!,
              at: now,
              until: now + 15000,
              playing: action === 'load' || state === 1,
              kind: action,
            }
          : null;
        positionUntil = now + 1000;
      }
    },
    state(value: Observation): PlayerIntent | null {
      if (value.identity !== identity) {
        reset(value.identity);
        state = value.state;
        return null;
      }
      const previous = state;
      if (![1, 2, 5].includes(value.state)) return null;
      state = value.state;
      if (expected && value.now >= expected.until) expected = null;
      if (expected?.state === value.state) {
        expected = null;
        return null;
      }
      // A delayed PLAYING callback cannot defeat an outstanding shared pause.
      if (expected?.state === 2 && value.state === 1) return null;
      if (
        value.gesture &&
        value.state === 1 &&
        previous === 5 &&
        expectedPosition?.kind === 'cue' &&
        Number.isFinite(value.position) &&
        value.position >= 0 &&
        Math.abs(value.position - expectedPosition.position) > POSITION_ACK_TOLERANCE
      ) {
        expectedPosition = null;
        sample = { position: value.position, at: value.now, state: value.state };
        return { action: 'seek', position: value.position };
      }
      if (
        value.gesture &&
        value.state === 1 &&
        [2, 5].includes(previous) &&
        sample &&
        !expectedPosition &&
        Number.isFinite(value.position) &&
        value.position >= 0 &&
        Math.abs(value.position - sample.position) > 1.5
      ) {
        sample = { position: value.position, at: value.now, state: value.state };
        return { action: 'seek', position: value.position };
      }
      if (previous === value.state || ![1, 2].includes(value.state)) return null;
      // Browser/media-key pauses without provable iframe activation still stop
      // this device. They can never control the room or cause an automatic resume.
      if (!value.gesture) return value.state === 2 ? { action: 'pause', local: true } : null;
      return { action: value.state === 1 ? 'play' : 'pause' };
    },
    time(value: Observation): PlayerIntent | null {
      if (value.identity !== identity) {
        reset(value.identity);
        return null;
      }
      const previous = sample;
      if (!Number.isFinite(value.position) || value.position < 0 || !Number.isFinite(value.now))
        return null;
      if (expectedPosition) {
        const target =
          expectedPosition.position +
          (expectedPosition.playing ? Math.max(0, value.now - expectedPosition.at) / 1000 : 0);
        const acknowledged =
          Math.min(
            Math.abs(value.position - expectedPosition.position),
            Math.abs(value.position - target),
          ) < POSITION_ACK_TOLERANCE;
        if (acknowledged || value.now >= expectedPosition.until) expectedPosition = null;
        sample = { position: value.position, at: value.now, state: value.state };
        return null;
      }
      if (value.now < positionUntil) {
        if (previous && Math.abs(value.position - previous.position) < 1.5) {
          sample = { position: value.position, at: value.now, state: value.state };
          positionUntil = 0;
        }
        return null;
      }
      sample = { position: value.position, at: value.now, state: value.state };
      if (
        !previous ||
        !value.gesture ||
        !Number.isFinite(value.position) ||
        value.position < 0 ||
        value.now - previous.at > (positionUntil ? 3000 : 1000) ||
        ![1, 2, 3].includes(value.state)
      )
        return null;
      const elapsed = previous.state === 1 ? Math.max(0, value.now - previous.at) / 1000 : 0;
      if (Math.abs(value.position - previous.position - elapsed) < 1.5) return null;
      return { action: 'seek', position: value.position };
    },
  };
}
