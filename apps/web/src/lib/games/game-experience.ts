import { guessAvailability } from '../../../../../lib/guess-availability.ts';
import type { GuessCategorySummary } from '../../../../../services/core/src/guess-catalog.ts';
import type {
  GuessPublicState,
  GuessSettings,
} from '../../../../../services/core/src/guess-game.ts';

export const gamePresets = [
  {
    id: 'quick',
    name: 'Quickfire',
    description: 'Fast guesses. No time to overthink.',
    seconds: 15,
    rounds: 5,
  },
  {
    id: 'party',
    name: 'House party',
    description: 'A little time to find your rhythm.',
    seconds: 30,
    rounds: 5,
  },
  {
    id: 'encore',
    name: 'The encore',
    description: 'More songs. A longer rivalry.',
    seconds: 30,
    rounds: 10,
  },
] as const;
export function presetSettings(
  id: string,
  category: GuessCategorySummary | undefined,
  previous: GuessSettings,
): GuessSettings | null {
  const preset = gamePresets.find((item) => item.id === id);
  if (!preset) return null;
  const capacity = guessAvailability(category, preset.seconds, 1);
  if (!capacity.canStart || (id === 'encore' && capacity.eligibleRounds <= 5)) return null;
  return {
    ...previous,
    durationSeconds: preset.seconds,
    roundCount: Math.min(preset.rounds, capacity.maxRounds, capacity.eligibleRounds),
  };
}
export function rankPlayers(players: GuessPublicState['scoreboard']) {
  const ordered = [...players].sort(
    (a, b) => b.total - a.total || a.nickname.localeCompare(b.nickname) || a.id.localeCompare(b.id),
  );
  return ordered.map((player, index) => ({
    ...player,
    rank:
      index && ordered[index - 1].total === player.total
        ? ordered.findIndex((item) => item.total === player.total) + 1
        : index + 1,
  }));
}

export function validGameSettings(settings: GuessSettings): boolean {
  return (
    Number.isInteger(settings.durationSeconds) &&
    settings.durationSeconds >= 15 &&
    settings.durationSeconds <= 90 &&
    Number.isInteger(settings.roundCount) &&
    settings.roundCount >= 1 &&
    settings.roundCount <= 20 &&
    Number.isInteger(settings.maxPoints) &&
    settings.maxPoints >= 100 &&
    settings.maxPoints <= 2000 &&
    Number.isInteger(settings.minPoints) &&
    settings.minPoints >= 0 &&
    settings.minPoints <= settings.maxPoints &&
    typeof settings.hints === 'boolean' &&
    (settings.answerMode === undefined || ['title', 'artist'].includes(settings.answerMode))
  );
}

/** A participant or catalog refresh can advance the revision without changing host settings. */
export function sameGameConfiguration(
  previous: Pick<GuessPublicState, 'sessionId' | 'categoryId' | 'settings'>,
  current: Pick<GuessPublicState, 'sessionId' | 'categoryId' | 'settings'>,
): boolean {
  return (
    previous.sessionId === current.sessionId &&
    previous.categoryId === current.categoryId &&
    previous.settings.durationSeconds === current.settings.durationSeconds &&
    previous.settings.roundCount === current.settings.roundCount &&
    previous.settings.maxPoints === current.settings.maxPoints &&
    previous.settings.minPoints === current.settings.minPoints &&
    previous.settings.hints === current.settings.hints &&
    (previous.settings.answerMode ?? 'title') === (current.settings.answerMode ?? 'title')
  );
}
