import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultSettings,
  numericSettingBounds,
  settingGroups,
  settingGroupsFor,
  validSettingValue,
} from "../src/settings.ts";
import { defaultSettings as compatibilityDefaults } from "../src/types.ts";

test("persisted defaults and the types compatibility export use the same settings contract", () => {
  assert.equal(compatibilityDefaults, defaultSettings);
  for (const [key, value] of Object.entries(defaultSettings))
    assert(
      validSettingValue(key, value),
      `${key} has a valid persisted default`,
    );
  assert.equal(Object.keys(defaultSettings).length, 12);
});

test("all numeric settings accept integer endpoints and reject out-of-range or coerced inputs", () => {
  for (const [key, { min, max }] of Object.entries(numericSettingBounds)) {
    for (const value of [min, max, Math.floor((min + max) / 2)])
      assert(validSettingValue(key, value), `${key} accepts ${value}`);
    for (const value of [
      min - 1,
      max + 1,
      min + 0.5,
      String(min),
      true,
      false,
      null,
      undefined,
      NaN,
      Infinity,
      -Infinity,
    ])
      assert.equal(
        validSettingValue(key, value),
        false,
        `${key} rejects ${String(value)}`,
      );
  }
});

test("boolean settings require booleans and never accept numeric or text coercion", () => {
  for (const [key, initial] of Object.entries(defaultSettings)) {
    if (typeof initial !== "boolean") continue;
    assert(validSettingValue(key, true));
    assert(validSettingValue(key, false));
    for (const value of [0, 1, "true", "false", "", null, undefined])
      assert.equal(
        validSettingValue(key, value),
        false,
        `${key} rejects ${String(value)}`,
      );
  }
});

test("both administration interfaces share the ten editable fields and server validation bounds", () => {
  const classic = settingGroupsFor("classic"),
    svelte = settingGroupsFor("svelte");
  const fields = settingGroups.flatMap((group) => group.fields);
  assert.deepEqual(
    fields.map((field) => field.key),
    [
      "defaultVolume",
      "audioBitrateKbps",
      "crossfade",
      "radio",
      "secondsToWaitAfterQueueEmpties",
      "leaveIfNoListeners",
      "turnDownVolumeWhenPeopleSpeak",
      "turnDownVolumeWhenPeopleSpeakTarget",
      "playlistLimit",
      "defaultQueuePageSize",
    ],
  );
  assert.equal(new Set(fields.map((field) => field.key)).size, fields.length);
  for (const field of fields) {
    assert.equal(
      typeof defaultSettings[field.key],
      field.toggle ? "boolean" : "number",
    );
    if (!field.toggle)
      assert.deepEqual(
        { min: field.min, max: field.max },
        numericSettingBounds[field.key],
      );
  }
  const withoutHelp = (groups: typeof classic) =>
    groups.map((group) => ({
      ...group,
      fields: group.fields.map((field) => ({ ...field, help: "" })),
    }));
  assert.deepEqual(withoutHelp(classic), withoutHelp(svelte));
  assert.equal(
    classic
      .flatMap((group) => group.fields)
      .find((field) => field.key === "turnDownVolumeWhenPeopleSpeak")?.help,
    "Voice detection is enabled when joining. Reconnect after changing this option.",
  );
  assert.equal(
    svelte
      .flatMap((group) => group.fields)
      .find((field) => field.key === "turnDownVolumeWhenPeopleSpeak")?.help,
    "Reconnect after changing this option to update voice detection.",
  );
});
