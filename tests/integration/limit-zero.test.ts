/**
 * `--limit 0`, and the blank line that belongs to the rows rather than to the notice.
 *
 * A truncated listing has to say so — a silently shortened one reads as a complete one, and the
 * whole point of the cap is that a caller can tell the difference. So every capped command prints
 * a notice naming what it withheld, separated from the rows above it by a blank line.
 *
 * That blank line belongs to the rows. With `--limit 0` there are none, and emitting it anyway
 * left two blank lines and a notice hanging under the count, as though the rows had failed rather
 * than been asked for (fixed in 0.4.181). It is one ternary, and the only thing that distinguishes
 * it from a stray `\n` nobody would defend is knowing what the blank line is for.
 *
 * `--limit 0` is not a contrived argument. It is what a script passes to ask "how many are there?"
 * without paying to print them, and what a `--limit "$N"` becomes when `N` is empty or zero. The
 * count line and the notice are then the entire useful output.
 *
 * `cli-limit-default.test.ts` pins the number the cap defaults to and the four places that state
 * it. This is the other end of the range.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { minimalEdfPlus } from '../support/writer.js';

const EVENTS = 6;

/** Six one-second records, one annotation each. */
const FILE = minimalEdfPlus({
  recordCount: EVENTS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [
    {
      samplesPerRecord: 60,
      tals: (record: number) => [{ onset: record + 0.5, texts: [`event ${record}`] }],
    },
  ],
});

async function invoke(argv: readonly string[]): Promise<{ out: string; code: number }> {
  let out = '';
  const io: CliIo = {
    readFile: () => Promise.resolve(FILE),
    out: (text) => {
      out += text;
    },
    err: () => undefined,
  };
  const code = await runCli(parseArgs(argv), io);
  return { out, code };
}

const rowsIn = (out: string): readonly string[] =>
  out.split('\n').filter((line) => line.includes('\tevent '));

describe('a listing capped at nothing', () => {
  it('prints the count and the notice, and no rows between them', async () => {
    const { out, code } = await invoke(['events', 'night.edf', '--list', '--limit', '0']);
    expect(code).toBe(0);
    expect(out).toContain(`${EVENTS} annotations`);
    expect(rowsIn(out)).toEqual([]);
    expect(out).toContain(`... ${EVENTS} more (raise --limit to see them)`);
  });

  it('leaves no blank line hanging where the rows would have been', async () => {
    const { out } = await invoke(['events', 'night.edf', '--list', '--limit', '0']);
    // Two consecutive blank lines is the shape 0.4.181 removed: it reads as rows that failed
    // rather than rows that were not asked for.
    expect(out).not.toContain('\n\n\n');
  });
});

describe('a listing capped part way', () => {
  it('prints that many rows, then the blank line, then the notice', async () => {
    const { out } = await invoke(['events', 'night.edf', '--list', '--limit', '2']);
    expect(rowsIn(out)).toHaveLength(2);
    expect(out).toContain(`\n\n... ${EVENTS - 2} more`);
    expect(out).not.toContain('\n\n\n');
  });

  it('names what it withheld rather than how much it showed', async () => {
    for (const limit of [1, 3, 5]) {
      const { out } = await invoke(['events', 'night.edf', '--list', '--limit', String(limit)]);
      expect(rowsIn(out)).toHaveLength(limit);
      expect(out, `--limit ${limit}`).toContain(`... ${EVENTS - limit} more`);
    }
  });
});

describe('a listing that fits', () => {
  it('says nothing about a remainder there is none of', async () => {
    const { out } = await invoke(['events', 'night.edf', '--list', '--limit', String(EVENTS)]);
    expect(rowsIn(out)).toHaveLength(EVENTS);
    expect(out).not.toContain('more (raise --limit');
  });

  it('is the same for a limit past the end', async () => {
    const { out } = await invoke(['events', 'night.edf', '--list', '--limit', '1000']);
    expect(rowsIn(out)).toHaveLength(EVENTS);
    expect(out).not.toContain('more (raise --limit');
  });
});

describe('the header command, which caps its diagnostics the same way', () => {
  it('withholds them all at zero and still says how many', async () => {
    const { out, code } = await invoke(['header', 'night.edf', '--limit', '0']);
    expect(code).toBe(0);
    expect(out).toMatch(/\d+ diagnostics?:/);
    expect(out).toMatch(/\.\.\. and \d+ more/);
    expect(out).toContain('Raise --limit to see the rest.');
    expect(out).not.toContain('\n\n\n');
  });

  it('says nothing about a remainder when the limit covers them', async () => {
    const { out } = await invoke(['header', 'night.edf', '--limit', '50']);
    expect(out).not.toContain('... and');
    expect(out).not.toContain('Raise --limit to see the rest.');
  });
});
