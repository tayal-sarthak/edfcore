/**
 * The column table on the CLI page is the order `edfcore signals` actually emits.
 *
 * `signals` exists to be piped into `awk`, so its columns are a positional contract — the whole
 * point of the command is that field 6 is always `samplesPerRecord`. Two things state that order:
 * the table on `cli.md`, and `cli.test.ts`, which pins it against a hard-coded array. Neither
 * knows about the other, so a column inserted rather than appended could be made to pass by
 * editing the test, and the page would go on describing the old layout to everyone parsing it.
 *
 * That is not hypothetical here. Column 6 was added in 0.2.42 and deliberately APPENDED so
 * nothing parsing the first five by position would move — and the page had claimed for some time
 * before that that the command emitted samples per record where it emitted `kind`, with the
 * authoritative field in no column at all.
 *
 * So the expectation is read from the page. The fixture gives every column a distinct value —
 * a two-second record with fifty samples, so the rate is 25 and the count is 50 — because two
 * columns holding the same number would let a swap pass.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { minimalEdfPlus } from '../support/writer.js';

const CLI_PAGE = readFileSync(
  new URL('../../website/src/content/docs/cli.md', import.meta.url),
  'utf8',
);

/** `| 4 | \`sampleRateHz\` | … |` -> `sampleRateHz`, in the order the table lists them. */
const DOCUMENTED_COLUMNS: readonly string[] = [...CLI_PAGE.matchAll(/^\| (\d+) \| `(\w+)` \|/gm)]
  .sort((a, b) => Number(a[1]) - Number(b[1]))
  .map((row) => row[2] as string);

/**
 * One signal whose every field is a different string, so a transposition cannot pass.
 * `recordDurationSeconds: 2` with 50 samples makes the rate 25 and the count 50.
 */
const FIXTURE = minimalEdfPlus({
  recordCount: 2,
  recordDurationSeconds: 2,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 50, physicalDimension: 'uV' }],
});

const EXPECTED: ReadonlyMap<string, string> = new Map([
  ['index', '0'],
  ['label', 'EEG Fpz-Cz'],
  ['kind', 'data'],
  ['sampleRateHz', '25'],
  ['physicalDimension', 'uV'],
  ['samplesPerRecord', '50'],
]);

async function signalsRow(): Promise<readonly string[]> {
  let out = '';
  const io: CliIo = {
    readFile: () => Promise.resolve(FIXTURE),
    out: (text) => {
      out += text;
    },
    err: () => {},
  };
  const code = await runCli(parseArgs(['signals', 'a.edf']), io);
  expect(code).toBe(0);
  return (out.trim().split('\n')[0] ?? '').split('\t');
}

describe('the documented column table', () => {
  it('was read, so a passing run is not a vacuous one', () => {
    expect(DOCUMENTED_COLUMNS.length).toBeGreaterThan(4);
    expect(DOCUMENTED_COLUMNS[0]).toBe('index');
  });

  it('names only columns this test knows a value for', () => {
    // A new column on the page without a value here would otherwise be skipped silently, which
    // is the failure this file exists to prevent one level down.
    const unknown = DOCUMENTED_COLUMNS.filter((name) => !EXPECTED.has(name));
    expect(unknown, 'columns on cli.md with no expected value in this test').toEqual([]);
  });
});

describe('`edfcore signals` emits what the page says', () => {
  it('has one field per documented column', async () => {
    expect((await signalsRow()).length).toBe(DOCUMENTED_COLUMNS.length);
  });

  it('puts each documented column at the position the page gives it', async () => {
    const row = await signalsRow();
    const wrong = DOCUMENTED_COLUMNS.map((name, index) => ({
      name,
      index,
      got: row[index],
      want: EXPECTED.get(name),
    }))
      .filter(({ got, want }) => got !== want)
      .map(
        ({ name, index, got, want }) => `column ${index + 1} (${name}): got ${got}, want ${want}`,
      );
    expect(wrong).toEqual([]);
  });
});
