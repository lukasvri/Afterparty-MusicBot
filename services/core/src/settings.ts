/** Persisted bot settings and browser-safe administration metadata. No runtime services. */
export type Settings = {
  playlistLimit: number;
  secondsToWaitAfterQueueEmpties: number;
  leaveIfNoListeners: boolean;
  queueAddResponseEphemeral: boolean;
  autoAnnounceNextSong: boolean;
  defaultVolume: number;
  defaultQueuePageSize: number;
  turnDownVolumeWhenPeopleSpeak: boolean;
  turnDownVolumeWhenPeopleSpeakTarget: number;
  crossfade: number;
  radio: boolean;
  audioBitrateKbps: number;
};

export const defaultSettings: Settings = {
  playlistLimit: 50,
  secondsToWaitAfterQueueEmpties: 300,
  leaveIfNoListeners: true,
  queueAddResponseEphemeral: true,
  autoAnnounceNextSong: false,
  defaultVolume: 100,
  defaultQueuePageSize: 10,
  turnDownVolumeWhenPeopleSpeak: false,
  turnDownVolumeWhenPeopleSpeakTarget: 30,
  crossfade: 6,
  radio: true,
  audioBitrateKbps: 192,
};

type NumericSettingKey = {
  [Key in keyof Settings]: Settings[Key] extends number ? Key : never;
}[keyof Settings];
type BooleanSettingKey = Exclude<keyof Settings, NumericSettingKey>;
type NumericBounds = { readonly min: number; readonly max: number };

export const numericSettingBounds = {
  playlistLimit: { min: 1, max: 1000 },
  secondsToWaitAfterQueueEmpties: { min: 0, max: 86400 },
  defaultVolume: { min: 0, max: 100 },
  defaultQueuePageSize: { min: 1, max: 30 },
  turnDownVolumeWhenPeopleSpeakTarget: { min: 0, max: 100 },
  crossfade: { min: 0, max: 12 },
  audioBitrateKbps: { min: 64, max: 384 },
} as const satisfies Record<NumericSettingKey, NumericBounds>;

/** The caller selects recognized persisted keys; omitted settings stay unchanged. */
export function validSettingValue(
  key: string,
  value: unknown,
): value is number | boolean {
  if (!Object.hasOwn(numericSettingBounds, key))
    return typeof value === "boolean";
  const { min, max } = numericSettingBounds[key as NumericSettingKey];
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

type SettingSurface = "classic" | "svelte";
type FieldText = {
  label: string;
  help: string;
  helpBySurface?: Partial<Record<SettingSurface, string>>;
};
export type SettingField = FieldText &
  (
    | { key: NumericSettingKey; min: number; max: number; toggle?: never }
    | { key: BooleanSettingKey; toggle: true; min?: never; max?: never }
  );
export type SettingGroup = {
  title: string;
  description: string;
  fields: readonly SettingField[];
};

function numericField(
  key: NumericSettingKey,
  label: string,
  help: string,
): SettingField {
  return { key, label, help, ...numericSettingBounds[key] };
}

// Keep the existing editable subset. Compatibility-only settings remain persisted
// without silently exposing new controls or resetting their saved values.
export const settingGroups: readonly SettingGroup[] = [
  {
    title: "Audio playback",
    description: "Playback defaults for this Discord server.",
    fields: [
      numericField(
        "defaultVolume",
        "Default volume",
        "0–100%. Current playback volume has its own control.",
      ),
      numericField(
        "audioBitrateKbps",
        "Audio bitrate",
        "64–384 kbit/s. Applies at the next playback start, capped by the voice channel.",
      ),
      numericField(
        "crossfade",
        "Crossfade",
        "0–12 seconds between tracks. Set 0 to turn crossfade off.",
      ),
      {
        key: "radio",
        label: "Radio when the queue is empty",
        toggle: true,
        help: "Prepare related music when the manual queue runs out.",
      },
    ],
  },
  {
    title: "Voice and listeners",
    description: "Connection behavior and volume while people speak.",
    fields: [
      numericField(
        "secondsToWaitAfterQueueEmpties",
        "Wait after the queue empties",
        "0–86400 seconds. Set 0 to stay connected indefinitely after the queue ends.",
      ),
      {
        key: "leaveIfNoListeners",
        label: "Leave when no listeners remain",
        toggle: true,
        help: "Disconnect when everyone else leaves the voice channel.",
      },
      {
        key: "turnDownVolumeWhenPeopleSpeak",
        label: "Lower volume while people speak",
        toggle: true,
        help: "Voice detection is enabled when joining. Reconnect after changing this option.",
        helpBySurface: {
          svelte:
            "Reconnect after changing this option to update voice detection.",
        },
      },
      numericField(
        "turnDownVolumeWhenPeopleSpeakTarget",
        "Volume while people speak",
        "0–100%. Used while voice volume reduction is enabled.",
      ),
    ],
  },
  {
    title: "Queue and playlists",
    description: "Import limits and the Discord queue display.",
    fields: [
      numericField(
        "playlistLimit",
        "Playlist limit",
        "1–1000 tracks imported from a playlist.",
      ),
      numericField(
        "defaultQueuePageSize",
        "Tracks per queue page",
        "1–30 tracks shown by the Discord queue command.",
      ),
    ],
  },
];

export function settingGroupsFor(
  surface: SettingSurface,
): readonly SettingGroup[] {
  return settingGroups.map((group) => ({
    ...group,
    fields: group.fields.map((field) => ({
      ...field,
      help: field.helpBySurface?.[surface] ?? field.help,
    })),
  }));
}
