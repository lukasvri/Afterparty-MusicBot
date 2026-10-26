import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  confirmsPlayerIntent,
  createPlayerIntent,
  refreshQueuedSeek,
} from '../src/lib/rooms/player-intent.ts';
const observation = (extra = {}) => ({
  identity: 'room:track:instance',
  state: 1,
  position: 10,
  now: 2000,
  gesture: true,
  ...extra,
});
test('command confirmation waits for a fresh timeline and tolerates progressed seeks', () => {
  const sample = { version: 2, previousVersion: 1, playing: true, position: 45, elapsed: 3500 };
  assert.equal(confirmsPlayerIntent({ action: 'seek', position: 42 }, sample), true);
  assert.equal(
    confirmsPlayerIntent({ action: 'seek', position: 42 }, { ...sample, version: 1, position: 42 }),
    false,
  );
  assert.equal(
    confirmsPlayerIntent({ action: 'seek', position: 42 }, { ...sample, position: 12 }),
    false,
  );
  assert.equal(
    confirmsPlayerIntent(
      { action: 'seek', position: 42 },
      { ...sample, playing: false, position: 45 },
    ),
    false,
  );
  assert.equal(
    confirmsPlayerIntent(
      { action: 'seek', position: 42 },
      { ...sample, playing: false, position: 42 },
    ),
    true,
  );
  assert.equal(confirmsPlayerIntent({ action: 'pause' }, sample), false);
  assert.equal(confirmsPlayerIntent({ action: 'pause' }, { ...sample, playing: false }), true);
});
test('native state changes require a current user gesture and never echo programmatic playback', () => {
  const bridge = createPlayerIntent(),
    key = observation().identity;
  bridge.command(key, 'load', 0);
  assert.equal(bridge.state(observation()), null);
  assert.equal(bridge.state(observation({ state: 2, gesture: false })), null);
  assert.deepEqual(bridge.time(observation({ state: 2, gesture: false, now: 2750 })), {
    action: 'pause',
    local: true,
  });
  assert.deepEqual(bridge.state(observation({ state: 1, now: 3000 })), { action: 'play' });
  assert.deepEqual(bridge.state(observation({ state: 2, now: 4000 })), { action: 'pause' });
  assert.equal(bridge.state(observation({ state: 2, now: 4100 })), null);
});

test('a short provider pause may recover without pinning this device as user-paused', () => {
  const bridge = createPlayerIntent();
  bridge.state(observation({ now: 0 }));
  assert.equal(bridge.state(observation({ state: 2, gesture: false, now: 100 })), null);
  assert.equal(bridge.hasPendingLocalPause(), true);
  assert.equal(bridge.time(observation({ state: 2, gesture: false, now: 500 })), null);
  assert.equal(bridge.state(observation({ state: 1, gesture: false, now: 600 })), null);
  assert.equal(bridge.hasPendingLocalPause(), false);
  assert.equal(bridge.time(observation({ state: 1, gesture: false, now: 1000 })), null);
});

test('a persistent media-key pause stays local and an explicit iframe pause stays immediate', () => {
  const bridge = createPlayerIntent();
  bridge.state(observation({ now: 0 }));
  assert.equal(bridge.state(observation({ state: 2, gesture: false, now: 100 })), null);
  assert.equal(bridge.time(observation({ state: 2, gesture: false, now: 500 })), null);
  assert.deepEqual(bridge.time(observation({ state: 2, gesture: false, now: 850 })), {
    action: 'pause',
    local: true,
  });
  assert.equal(bridge.time(observation({ state: 2, gesture: false, now: 1100 })), null);
  bridge.state(observation({ state: 1, now: 1200 }));
  assert.deepEqual(bridge.state(observation({ state: 2, now: 1300 })), { action: 'pause' });
});

test('buffering, source replacement and programmatic transport retire a pending local pause', () => {
  for (const recovery of ['buffer', 'source', 'command'] as const) {
    const bridge = createPlayerIntent();
    bridge.state(observation({ now: 0 }));
    bridge.state(observation({ state: 2, gesture: false, now: 100 }));
    if (recovery === 'buffer') bridge.state(observation({ state: 3, gesture: false, now: 200 }));
    if (recovery === 'source') bridge.reset(observation().identity);
    if (recovery === 'command') bridge.command(observation().identity, 'pause', 200);
    assert.equal(bridge.time(observation({ state: 2, gesture: false, now: 1000 })), null);
  }
});
test('a delayed playing event cannot override an expected shared pause or another playback instance', () => {
  const bridge = createPlayerIntent(),
    key = observation().identity;
  bridge.command(key, 'pause', 1000);
  assert.equal(bridge.state(observation()), null);
  assert.equal(bridge.state(observation({ state: 2 })), null);
  assert.equal(bridge.state(observation({ identity: 'another-instance' })), null);
});
test('native seeks use local discontinuity rather than normal network drift and require activation', () => {
  const bridge = createPlayerIntent();
  bridge.reset(observation().identity);
  assert.equal(bridge.time(observation()), null);
  assert.equal(bridge.time(observation({ now: 2250, position: 10.25 })), null);
  assert.equal(bridge.time(observation({ now: 2500, position: 10.25, state: 3 })), null);
  assert.deepEqual(bridge.time(observation({ now: 2750, position: 42, state: 3 })), {
    action: 'seek',
    position: 42,
  });
  assert.equal(bridge.time(observation({ now: 4000, position: 0, gesture: false })), null);
});
test('shared corrections, long background gaps and source loading never become user seeks', () => {
  const bridge = createPlayerIntent(),
    key = observation().identity;
  bridge.command(key, 'load', 1000);
  bridge.time(observation({ now: 1100, position: 0 }));
  assert.equal(bridge.time(observation({ now: 1500, position: 42 })), null);
  bridge.command(key, 'seek', 2000);
  assert.equal(bridge.time(observation({ now: 2200, position: 60 })), null);
  assert.equal(bridge.time(observation({ now: 10000, position: 120 })), null);
});

test('rapid deliberate pause/resume is not blocked by a redundant pause with no callback', () => {
  const bridge = createPlayerIntent(),
    key = observation().identity;
  bridge.reset(key);
  bridge.state(observation());
  assert.deepEqual(bridge.state(observation({ state: 2, now: 2100 })), { action: 'pause' });
  bridge.command(key, 'pause', 2200);
  assert.deepEqual(bridge.state(observation({ state: 1, now: 2300 })), { action: 'play' });
});
test('a slow programmatic seek is acknowledged without becoming a shared seek', () => {
  const bridge = createPlayerIntent(),
    key = observation().identity;
  bridge.reset(key);
  bridge.time(observation({ now: 0, position: 10 }));
  bridge.command(key, 'seek', 10, 42);
  assert.equal(bridge.time(observation({ now: 250, position: 10 })), null);
  assert.equal(bridge.time(observation({ now: 1250, position: 10 })), null);
  assert.equal(bridge.time(observation({ now: 1500, position: 42 })), null);
  assert.equal(bridge.time(observation({ now: 1750, position: 42.25 })), null);
  assert.deepEqual(bridge.time(observation({ now: 2000, position: 80 })), {
    action: 'seek',
    position: 80,
  });
});
test('invalid current-time samples cannot poison the next valid sample', () => {
  const bridge = createPlayerIntent();
  bridge.reset(observation().identity);
  bridge.time(observation());
  assert.equal(bridge.time(observation({ now: 2250, position: NaN })), null);
  assert.equal(bridge.time(observation({ now: 2500, position: 10.5 })), null);
});

test('scrubbing a cued paused video changes position without implicitly resuming the room', () => {
  const bridge = createPlayerIntent(),
    key = observation().identity;
  bridge.command(key, 'cue', 0, 12);
  bridge.state(observation({ state: 5, now: 100, position: 12, gesture: false }));
  bridge.time(observation({ state: 5, now: 250, position: 12, gesture: false }));
  assert.deepEqual(bridge.state(observation({ state: 1, now: 500, position: 42 })), {
    action: 'seek',
    position: 42,
  });
});
test('scrubbing immediately after cue does not resume before the first position sample', () => {
  const bridge = createPlayerIntent(),
    key = observation().identity;
  bridge.command(key, 'cue', 0, 12);
  bridge.state(observation({ state: 5, now: 50, position: 12, gesture: false }));
  assert.deepEqual(bridge.state(observation({ state: 1, now: 100, position: 42 })), {
    action: 'seek',
    position: 42,
  });
  bridge.command(key, 'cue', 200, 12);
  bridge.state(observation({ state: 5, now: 250, position: 10, gesture: false }));
  assert.deepEqual(
    bridge.state(observation({ state: 1, now: 300, position: 10 })),
    { action: 'play' },
    'normal keyframe rounding is not a native scrub',
  );
});
test('a deliberate resume after a paused seek acknowledgement does not wait for a position poll', () => {
  const bridge = createPlayerIntent(),
    key = observation().identity;
  bridge.reset(key);
  bridge.state(observation({ state: 2, now: 0, position: 12, gesture: false }));
  bridge.command(key, 'seek', 10, 42);
  assert.equal(
    bridge.state(observation({ state: 2, now: 50, position: 42, gesture: false })),
    null,
  );
  assert.deepEqual(bridge.state(observation({ state: 1, now: 100, position: 42 })), {
    action: 'play',
  });
});

test('consecutive native scrubs are not swallowed by an automatic-correction cooldown', () => {
  const bridge = createPlayerIntent();
  bridge.reset(observation().identity);
  bridge.time(observation({ now: 2000, position: 10 }));
  assert.deepEqual(bridge.time(observation({ now: 2250, position: 42 })), {
    action: 'seek',
    position: 42,
  });
  assert.deepEqual(bridge.time(observation({ now: 2400, position: 80 })), {
    action: 'seek',
    position: 80,
  });
  assert.equal(bridge.time(observation({ now: 2500, position: 80.1 })), null);
});

test('queued scrubs follow observed progress without trusting stale or unrelated player reads', () => {
  const intent = { action: 'seek', position: 120 } as const;
  assert.deepEqual(refreshQueuedSeek(intent, 121.2, 1200, 180), {
    action: 'seek',
    position: 121.2,
  });
  for (const [position, elapsed] of [
    [42, 1200],
    [150, 1200],
    [NaN, 1200],
    [121, NaN],
    [121, -1],
  ])
    assert.equal(refreshQueuedSeek(intent, position, elapsed, 180), intent);
  assert.deepEqual(
    refreshQueuedSeek(intent, 120, 1200, 180),
    intent,
    'a paused/buffering scrub does not invent progress',
  );
  assert.equal(
    refreshQueuedSeek(intent, 180, 60000, 180),
    intent,
    'an ended source does not cancel the original valid target',
  );
  const invalid = { action: 'seek', position: 180 } as const;
  assert.equal(
    refreshQueuedSeek(invalid, 179, 1200, 180),
    invalid,
    'an invalid original target is never repaired into a valid control',
  );
  const pause = { action: 'pause' } as const;
  assert.equal(refreshQueuedSeek(pause, 121.2, 1200, 180), pause);
});
