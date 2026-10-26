import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canDJSeek,
  djCuePosition,
  djSettingsPatch,
  djTrackIdentity,
  readDJSettings,
} from '../src/lib/admin/dj-controls.ts';
import type { AdminDetail } from '../src/lib/admin/admin-client.ts';

test('DJ settings submit only edited keys and use canonical crossfade bounds', () => {
  const previous = { crossfade: 6, radio: true };
  assert.deepEqual(djSettingsPatch(previous, { ...previous, crossfade: 0 }), { crossfade: 0 });
  assert.deepEqual(djSettingsPatch(previous, { ...previous, radio: false }), { radio: false });
  assert.deepEqual(djSettingsPatch(previous, previous), {});
  for (const crossfade of [-1, 13, 2.5, NaN])
    assert.throws(() => djSettingsPatch(previous, { ...previous, crossfade }));
  assert.deepEqual(readDJSettings({ crossfade: 12, radio: false, defaultVolume: 40 }), {
    crossfade: 12,
    radio: false,
  });
});
test('DJ cue targets remain inside a known recording and never accept unknown positions', () => {
  assert.equal(djCuePosition(-15, 200), 0);
  assert.equal(djCuePosition(300, 200), 199.9);
  assert.equal(djCuePosition(50, 200), 50);
  for (const duration of [0, -1, NaN, Infinity]) assert.equal(djCuePosition(10, duration), null);
  assert.equal(djCuePosition(NaN, 200), null);
});
test('DJ marked cue identity follows the server and playback instance rather than just a reused video', () => {
  const detail = {
    guildId: 'server-a',
    state: {
      current: { id: 'same-video', live: false, duration: 200 },
      queueRevision: 'queue-a',
      playbackKey: 'instance-a',
    },
  } as unknown as AdminDetail;
  assert(canDJSeek(detail));
  const first = djTrackIdentity(detail);
  assert.equal(
    djTrackIdentity({ ...detail, state: { ...detail.state, queueRevision: 'queue-b' } }),
    first,
  );
  assert.notEqual(djTrackIdentity({ ...detail, guildId: 'server-b' }), first);
  assert.notEqual(
    djTrackIdentity({
      ...detail,
      state: { ...detail.state, playbackKey: 'instance-b' },
    } as AdminDetail),
    first,
  );
  assert.equal(
    canDJSeek({
      ...detail,
      state: { ...detail.state, current: { ...detail.state.current!, live: true } },
    }),
    false,
  );
  assert.equal(canDJSeek({ ...detail, state: { ...detail.state, current: null } }), false);
});
