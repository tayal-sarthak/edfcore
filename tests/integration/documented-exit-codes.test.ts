/**
 * The exit-code table on the CLI page is the code the CLI returns.
 *
 * `edfcore validate` exiting non-zero is the documented way to gate a CI job on file conformance,
 * so these three numbers are an interface — a script branches on them without parsing a word of
 * the output. The page states them; `cli.test.ts` asserts them against literals it holds itself.
 * Neither knows about the other, which is the shape 0.4.267 found in the `signals` column table
 * one release earlier: two statements of one contract, kept in step by hand.
 *
 * Producing each one has to go through the same two pieces the real binary does. `runCli` returns
 * 0 and 2; it never returns 1, because an unreadable file THROWS and `src/cli.ts` is what turns
 * that into an exit code — `error instanceof CliUsageError ? 2 : 1`. A check that only drove
 * `runCli` would quietly never test the row about a file that could not be read, which is the row
 * a CI gate depends on most.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CliIo, CliUsageError, parseArgs, runCli } from '../../src/cli-run.js';
import { minimalEdfPlus } from '../support/writer.js';

const CLI_PAGE = readFileSync(
  new URL('../../website/src/content/docs/cli.md', import.meta.url),
  'utf8',
);

/** `| \`2\` | bad usage — … |` from the exit-code table. */
const DOCUMENTED: ReadonlyMap<number, string> = new Map(
  [...CLI_PAGE.matchAll(/^\| `(\d)` \| ([^|]+) \|$/gm)].map((row) => [
    Number(row[1]),
    (row[2] as string).trim(),
  ]),
);

const FIXTURE = minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 });

/**
 * One invocation, through both halves of the CLI.
 *
 * `src/cli.ts` is a shell around `runCli` that cannot be imported without a process, so its one
 * decision — which code a thrown error becomes — is reproduced here from the same rule, and
 * `cli.test.ts` covers the shell itself.
 */
async function exitCodeOf(argv: readonly string[], files: Record<string, Uint8Array>) {
  const io: CliIo = {
    readFile: (path) =>
      files[path] === undefined
        ? Promise.reject(new Error(`ENOENT: no such file, open '${path}'`))
        : Promise.resolve(files[path] as Uint8Array),
    out: () => {},
    err: () => {},
  };
  try {
    return await runCli(parseArgs(argv), io);
  } catch (error) {
    return error instanceof CliUsageError ? 2 : 1;
  }
}

describe('the documented table', () => {
  it('was read, so a passing run is not a vacuous one', () => {
    expect(DOCUMENTED.size).toBe(3);
    expect(DOCUMENTED.get(0)).toBe('success');
  });

  it('documents every code and no code that cannot happen', () => {
    expect([...DOCUMENTED.keys()].sort()).toEqual([0, 1, 2]);
  });
});

describe('each documented code is one the CLI produces', () => {
  it('0, for a file that reads cleanly', async () => {
    expect(DOCUMENTED.get(0)).toContain('success');
    expect(await exitCodeOf(['header', 'a.edf'], { 'a.edf': FIXTURE })).toBe(0);
  });

  it('1, for a file that could not be read', async () => {
    // The row a CI gate depends on, and the one `runCli` alone never returns.
    expect(DOCUMENTED.get(1)).toContain('could not be read');
    expect(await exitCodeOf(['header', 'missing.edf'], {})).toBe(1);
  });

  it('2, for every kind of bad usage the row lists', async () => {
    const row = DOCUMENTED.get(2) ?? '';
    expect(row).toContain('unknown command');
    expect(row).toContain('missing file');
    expect(row).toContain('extra files');
    expect(row).toContain('bad flag value');

    expect(await exitCodeOf(['nonsense', 'a.edf'], { 'a.edf': FIXTURE })).toBe(2);
    expect(await exitCodeOf(['header'], {})).toBe(2);
    expect(await exitCodeOf(['header', 'a.edf', '--patinet'], { 'a.edf': FIXTURE })).toBe(2);
    expect(await exitCodeOf(['validate', 'a.edf', 'b.edf'], { 'a.edf': FIXTURE })).toBe(2);
    expect(await exitCodeOf(['header', 'a.edf', '--limit', 'all'], { 'a.edf': FIXTURE })).toBe(2);
  });
});
