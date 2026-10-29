import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const template = readFileSync(new URL('./template.sh', import.meta.url), 'utf8');
const marker = template.lastIndexOf('# STAGES');
assert.ok(marker > 0);
const library = template.slice(0, template.lastIndexOf('\n', marker));
const bash = process.env.BASH_EXECUTABLE || 'bash';
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const values = ["O'Brien", 'plain', 'with "quotes"', "both '\" quotes", "O'Brien\\n", '$HOME # literal', '', ' spaces ', 'back`tick'];
const dir = mkdtempSync(join(tmpdir(), 'wizard-dotenv-'));
try {
  for (const value of values) {
    execFileSync(bash, ['-s'], {
      cwd: dir,
      input: library + `\nENV_FILE=.env\nwrite_env TEST_PASSWORD ${quote(value)} >/dev/null\n_existing TEST_PASSWORD > readback\n`,
      encoding: 'utf8',
    });
    assert.equal(parseEnv(readFileSync(join(dir, '.env'), 'utf8')).TEST_PASSWORD, value);
    assert.equal(readFileSync(join(dir, 'readback'), 'utf8'), value);
    const actual = execFileSync(process.execPath, ['--env-file=.env', '-p', 'JSON.stringify(process.env.TEST_PASSWORD)'], {
      cwd: dir, env: { ...process.env, TEST_PASSWORD: undefined }, encoding: 'utf8',
    });
    assert.equal(JSON.parse(actual), value);
  }
  const before = readFileSync(join(dir, '.env'), 'utf8');
  execFileSync(bash, ['-s'], { cwd: dir, input: library + `\nENV_FILE=.env\nif write_env TEST_PASSWORD ${quote("all '\"` quotes")}; then exit 1; fi\n`, encoding: 'utf8' });
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), before);
  console.log(`${values.length} dotenv and Node --env-file round trips passed; unsafe value rejected without file changes`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
