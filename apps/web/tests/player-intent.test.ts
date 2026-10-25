import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmsPlayerIntent, createPlayerIntent } from '../src/lib/rooms/player-intent.ts';
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
  assert.deepEqual(bridge.state(observation({ state: 2, gesture: false })), {
    action: 'pause',
    local: true,
  });
  assert.deepEqual(bridge.state(observation({ state: 1, now: 3000 })), { action: 'play' });
  assert.deepEqual(bridge.state(observation({ state: 2, now: 4000 })), { action: 'pause' });
  assert.equal(bridge.state(observation({ state: 2, now: 4100 })), null);
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
});
test('a playing event caused by an unacknowledged API seek cannot resume a paused room', () => {
  const bridge = createPlayerIntent(),
    key = observation().identity;
  bridge.reset(key);
  bridge.state(observation({ state: 2, now: 0, position: 12, gesture: false }));
  bridge.command(key, 'seek', 10, 42);
  assert.equal(bridge.state(observation({ state: 1, now: 100, position: 42 })), null);
});
