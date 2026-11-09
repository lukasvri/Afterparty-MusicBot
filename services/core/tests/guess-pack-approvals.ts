import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getGuessPack } from '../src/guess-packs.ts';

export function guessPackApprovals(expiresAt = Date.now() + 3_600_000) {
  return getGuessPack('edm-festival-hits').tracks.map(({ videoId }) => ({
    videoId,
    permission: { approved: true, reference: 'https://approval.example.test/fixture', expiresAt },
  }));
}

export async function writeGuessPackApprovals(directory: string) {
  const path = join(directory, 'guess-pack-approvals.json');
  await writeFile(path, JSON.stringify(guessPackApprovals()), { mode: 0o600 });
  return path;
}
