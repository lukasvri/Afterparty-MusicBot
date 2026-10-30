import type { RadioContentVerifier } from '../src/youtube-content.ts';

/** Synthetic recording fixtures have declared content evidence, not live pages. */
export const fixtureRadioContent: RadioContentVerifier = async () => 'not-observed';
export function fixtureRadioOwner<T extends { verifyRadioContent: RadioContentVerifier }>(owner: T): T {
  owner.verifyRadioContent = fixtureRadioContent;
  return owner;
}
