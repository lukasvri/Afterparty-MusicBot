import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGuessPackInventory, listGuessPacks, type GuessPackSummary } from './guess-packs.ts';
import { UserError } from './types.ts';

const unavailable = () => new UserError('The private game playlist could not be generated.', 503);
function privatePath(value: string) {
  if (!isAbsolute(value) || value !== resolve(value) || value.length > 4096 || /[\p{Cc}\p{Cf}]/u.test(value)) throw unavailable();
  return value;
}
async function approvalsFile(path: string): Promise<unknown> {
  const file = await open(privatePath(path), constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !stat.size || stat.size > 32_768) throw unavailable();
    const bytes = Buffer.alloc(32_769); let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
      if (!bytesRead) break; size += bytesRead;
    }
    if (!size || size > 32_768) throw unavailable();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
  } finally { await file.close(); }
}
type PackResult = { packs: GuessPackSummary[] } | { packId: string; count: number; approved: boolean };
/** Private local CLI only: no network, public upload endpoint, activation or fabricated approval. */
export async function runGuessPack(args: readonly string[]): Promise<PackResult> {
  try {
    if (args.length === 1 && args[0] === '--list') return { packs: listGuessPacks() };
    if (args.length !== 4 && args.length !== 6) throw unavailable();
    const flags = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index], value = args[index + 1];
      if (!['--pack', '--out', '--approval-file'].includes(flag) || flags.has(flag) || !value || value.startsWith('--')) throw unavailable();
      flags.set(flag, value);
    }
    const id = flags.get('--pack'), output = flags.get('--out');
    if (!id || !output) throw unavailable();
    privatePath(output);
    const approvalPath = flags.get('--approval-file');
    const records = approvalPath === undefined ? buildGuessPackInventory(id)
      : buildGuessPackInventory(id, await approvalsFile(approvalPath));
    const bytes = JSON.stringify(records, null, 2) + '\n';
    const file = await open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(bytes, 'utf8'); } finally { await file.close(); }
    return { packId: id, count: records.length, approved: approvalPath !== undefined };
  } catch { throw unavailable(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await runGuessPack(process.argv.slice(2))) + '\n'); }
  catch { process.stderr.write('The private game playlist could not be generated.\n'); process.exitCode = 1; }
}
