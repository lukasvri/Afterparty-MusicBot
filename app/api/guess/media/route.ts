import { api, fail } from '@/lib/server';
import { coreGuessAudio } from '@/lib/core-server';
import { guessInput } from '@/lib/guess-server';
export async function POST(request: Request) {
  try { const input = await guessInput(request); if (input.action !== 'media') fail(400, 'Invalid preview request.'); return await coreGuessAudio(input, request.signal); }
  catch (error) { return api(async () => { throw error; }); }
}
