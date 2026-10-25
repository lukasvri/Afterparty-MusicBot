// Browser-safe social contracts shared by Core, Classic and the v3 candidate.
// Runtime authorization, scoped tokens and database writes stay in social.ts.
export type SocialPlayback = { playbackKey: string | null; videoId: string | null; position: number };
export type SocialState = {
  scope: 'room' | 'guild'; scopeId: string; playbackKey: string | null; revision: number; enabled: boolean;
  reactions: { id: string; emoji: string; at: number }[];
  highlights: { id: string; text: string; position: number; videoId: string; at: number }[];
  bingo: { cells: string[]; marked: number[]; active: boolean } | null;
};
export const SOCIAL_REACTIONS = ['🔥', '❤️', '👏', '🤘', '✨', '🎉'] as const;
export const SOCIAL_HOST_ACTIONS = ['configure', 'remove-highlight', 'bingo-start', 'bingo-mark', 'bingo-stop'] as const;
export const SOCIAL_ACTIONS = ['join', 'read', 'stream', 'reaction', 'highlight', ...SOCIAL_HOST_ACTIONS] as const;
export type SocialAction = 'reaction' | 'highlight' | typeof SOCIAL_HOST_ACTIONS[number];

const cleanText = (value: unknown, length: number) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= length &&
  // eslint-disable-next-line no-control-regex -- Reject or strip control characters at the input boundary.
  !/[\u0000-\u001f\u007f]/.test(value);
export function validSocial(value: SocialState): boolean {
  return Boolean(
    value &&
    ['room', 'guild'].includes(value.scope) &&
    typeof value.scopeId === 'string' &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    typeof value.enabled === 'boolean' &&
    Array.isArray(value.reactions) &&
    value.reactions.length <= 20 &&
    value.reactions.every(
      (reaction) =>
        reaction &&
        typeof reaction.id === 'string' &&
        reaction.id.length <= 128 &&
        SOCIAL_REACTIONS.some((emoji) => emoji === reaction.emoji) &&
        Number.isFinite(reaction.at),
    ) &&
    Array.isArray(value.highlights) &&
    value.highlights.length <= 30 &&
    value.highlights.every(
      (highlight) =>
        highlight &&
        typeof highlight.id === 'string' &&
        highlight.id.length <= 128 &&
        cleanText(highlight.text, 160) &&
        /^[\w-]{11}$/.test(highlight.videoId) &&
        Number.isFinite(highlight.position) &&
        highlight.position >= 0 &&
        Number.isFinite(highlight.at),
    ) &&
    (value.bingo === null ||
      (value.bingo &&
        typeof value.bingo.active === 'boolean' &&
        Array.isArray(value.bingo.cells) &&
        value.bingo.cells.length === 9 &&
        value.bingo.cells.every((cell) => cleanText(cell, 60)) &&
        new Set(value.bingo.cells.map((cell) => cell.trim().toLowerCase())).size === 9 &&
        Array.isArray(value.bingo.marked) &&
        value.bingo.marked.length <= 9 &&
        value.bingo.marked.every((cell) => Number.isInteger(cell) && cell >= 0 && cell < 9))),
  );
}
