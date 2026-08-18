/**
 * Every `npx edfcore …` the documentation shows is one the CLI accepts.
 *
 * The commands are checked two ways already and neither covers this. `api-surface.test.ts` counts
 * the commands the `--help` text offers against the README's table, and `cli-command-list.test.ts`
 * asserts `--help` offers exactly what the dispatch switch handles. Both compare the CLI with
 * itself. What nobody checked is the sixteen invocations written out across the README, the CLI
 * page and the guides — the lines a reader copies into a terminal.
 *
 * A wrong one fails in the worst way for a first impression: `edfcore summary study.edf` exits 2
 * with a usage block, and the reader concludes the tool is broken rather than the page. That is
 * also the likeliest kind of rot here, because renaming a command touches `cli-run.ts` and the
 * `--help` text, and the checks above would both stay green while every page still named the old
 * one.
 *
 * Driven through `runCli`, not `parseArgs`. An unknown COMMAND is not a parse error — `parseArgs`
 * puts any non-flag word in the command slot quite happily — so checking the parser would pass on
 * `edfcore summary`. Exit code 2 is the contract for bad usage, and that is what this asserts
 * against.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { minimalEdfPlus } from '../support/writer.js';

const ROOT = new URL('../../', import.meta.url);

const TEXTS: ReadonlyArray<{ readonly name: string; readonly text: string }> = [
  ...[...DOCS_PAGES].map(([name, text]) => ({ name, text })),
  { name: 'README.md', text: readFileSync(new URL('README.md', ROOT), 'utf8') },
  { name: 'AGENTS.md', text: readFileSync(new URL('AGENTS.md', ROOT), 'utf8') },
];

interface Invocation {
  readonly page: string;
  readonly line: string;
  readonly argv: readonly string[];
}

/** `npx edfcore …` up to a trailing `#` comment, with `<file>` standing in for a real path. */
const INVOCATIONS: readonly Invocation[] = TEXTS.flatMap(({ name, text }) =>
  [...text.matchAll(/^\s*npx edfcore ([^\n#]*)/gm)].map((match) => {
    const line = (match[1] as string).trim();
    return {
      page: name,
      line: `npx edfcore ${line}`,
      argv: line.split(/\s+/).map((word) => (word === '<file>' ? 'study.edf' : word)),
    };
  }),
);

const FIXTURE = minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 });

/** Runs one invocation against a real file and returns its exit code. */
async function exitCodeOf(argv: readonly string[]): Promise<number> {
  const io: CliIo = {
    readFile: (path) =>
      path.endsWith('.edf') || path.endsWith('.bdf') || path.endsWith('.rec')
        ? Promise.resolve(FIXTURE)
        : Promise.reject(new Error(`no such file: ${path}`)),
    out: () => {},
    err: () => {},
  };
  return runCli(parseArgs(argv), io);
}

describe('the documented invocations were found', () => {
  it('read enough of them that a passing run is not a vacuous one', () => {
    expect(INVOCATIONS.length).toBeGreaterThan(12);
    const pages = new Set(INVOCATIONS.map((one) => one.page));
    expect(pages).toContain('README.md');
    expect(pages).toContain('cli.md');
    // Both spellings appear: a placeholder on the reference page, a real filename in the guides.
    expect(INVOCATIONS.some((one) => one.line.includes('<file>'))).toBe(true);
    expect(INVOCATIONS.some((one) => one.line.includes('overnight.edf'))).toBe(true);
  });

  it('can tell an accepted invocation from a refused one', async () => {
    await expect(exitCodeOf(['header', 'study.edf'])).resolves.not.toBe(2);
    // The failure this exists to catch: a command no page should be naming.
    await expect(exitCodeOf(['summary', 'study.edf'])).resolves.toBe(2);
    await expect(exitCodeOf(['header', 'study.edf', '--patinet'])).rejects.toThrow();
  });
});

describe('every documented invocation is accepted', () => {
  it('exits with something other than the bad-usage code', async () => {
    const refused: string[] = [];
    for (const invocation of INVOCATIONS) {
      try {
        if ((await exitCodeOf(invocation.argv)) === 2) {
          refused.push(`${invocation.page}: ${invocation.line}`);
        }
      } catch (error) {
        // A usage mistake throws from `parseArgs` — an unknown flag, a bad `--limit` value.
        refused.push(`${invocation.page}: ${invocation.line} -> ${(error as Error).message}`);
      }
    }
    expect(refused, 'documented commands the CLI does not accept').toEqual([]);
  });
});
