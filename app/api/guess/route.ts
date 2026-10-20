import { api } from '@/lib/server';
import { coreRequest } from '@/lib/core-server';
import { guessInput } from '@/lib/guess-server';
export const POST = (request: Request) => api(async () => coreRequest('/v1/guess', 'POST', await guessInput(request), {}, request.signal));
