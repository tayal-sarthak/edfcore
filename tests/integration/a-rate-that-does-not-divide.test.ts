/**
 * A derived rate does not blow the column it is printed in.
 *
 * `sampleRateHz` is `samplesPerRecord / recordDurationSeconds`, and that division does not have to
 * come out. A 0.29 s record holding 20 samples is 68.96551724137932 Hz — seventeen digits, in a
 * column nine characters wide. `formatHeader` interpolated it raw, so `range` moved off its
 * position on that row and no other, and a reader comparing two rows found the last column of one
 * of them somewhere else.
 *
 * It is the defect 0.3.96 fixed for the heading, arriving by a different route: that one was a
 * hand-spaced literal disagreeing with the widths beneath it, this one is a value wider than the
 * width. So the check here is the property rather than the site — every row's `range` starts at
 * the same column as every other row's and as the heading's, over every shape in the matrix.
 *
 * The rounding is marked with `~` because this module promises never to invent a value: the exact
 * rate is on `signal.sampleRateHz`, `edfcore signals` prints it unrounded for scripts, `edfcore
 * json` carries it in full, and `samplesPerRecord` is the authoritative field either way. A table
 * for a person is the one place where four significant figures is more use than seventeen.
 *
 * The matrix reaches this because 0.6.20 put a 0.29 s record in it. Before that every shape had a
 * duration of 1 s or 0 s, and every rate was a whole number.
 *
 * The index column is here too (0.6.24). It was three characters wide whatever the file, so signal
 * 1000 sat one column to the right of signal 999 in the middle of the same table — and EDF's
 * signal-count field is four characters, so a thousand-channel file is legal and a high-density
 * recording is not exotic. The property below is read off the heading rather than from a constant,
 * which is what lets it cover a width that now depends on the file.
 */

import { describe, expect, it } from 'vitest';
import { formatHeader } from '../../src/format-header.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

/** Where `range` begins, taken from the heading rather than assumed. */
const rangeColumn = (heading: string): number => heading.indexOf('range');

function tableRows(printed: string): readonly string[] {
  const lines = printed.split('\n');
  const heading = lines.findIndex((line) => /^ *# {2}label/.test(line));
  if (heading === -1) throw new Error('formatHeader stopped printing a signal table');
  const rows: string[] = [lines[heading] as string];
  for (const line of lines.slice(heading + 1)) {
    if (line === '') break;
    rows.push(line);
  }
  return rows;
}

describe('the matrix this file sweeps', () => {
  it('is the seventeen shapes it was written against', () => {
    expect(AWKWARD).toHaveLength(17);
  });
});

describe.each(AWKWARD)('$name', ({ bytes }) => {
  it('starts the range column at the same place on every row', async () => {
    const { header } = await openEdf(byteSource(bytes));
    const rows = tableRows(formatHeader(header));
    expect(rows.length).toBe(header.signals.length + 1);
    const at = rangeColumn(rows[0] as string);
    expect(at).toBeGreaterThan(40);
    for (const row of rows) {
      // Everything before the range column is padding or a padded field, so the character before
      // the boundary is a space on every row, including the heading's own.
      expect({ row, before: row.length <= at ? ' ' : row[at - 1] }).toEqual({ row, before: ' ' });
    }
  });

  it('prints a rate that fits, or says it rounded one', async () => {
    const { header } = await openEdf(byteSource(bytes));
    for (const [position, row] of tableRows(formatHeader(header)).slice(1).entries()) {
      const rate = header.signals[position]?.sampleRateHz;
      const heading = tableRows(formatHeader(header))[0] as string;
      const cell = row.slice(heading.indexOf('rate'), rangeColumn(heading) - 1).trimEnd();
      if (rate === undefined) {
        expect(cell).toBe('—');
        continue;
      }
      if (cell.startsWith('~')) {
        expect(Math.abs(Number(cell.slice(1, -3)) - rate)).toBeLessThan(0.005);
      } else {
        expect(cell).toBe(`${rate} Hz`);
      }
      expect(cell.length).toBeLessThanOrEqual(9);
    }
  });
});

describe('the shape that made this necessary', () => {
  const shape = AWKWARD.find((one) => one.name === 'a record duration with no exact binary form');

  it('really has a rate no decimal can hold', async () => {
    if (shape === undefined) throw new Error('the matrix lost the inexact-duration shape');
    const { header } = await openEdf(byteSource(shape.bytes));
    const rates = header.signals.map((one) => `${one.sampleRateHz}`);
    // Seventeen characters, in a nine-character column.
    expect(rates.some((one) => one.length > 9)).toBe(true);
  });

  it('prints it as an approximation, and says so', async () => {
    if (shape === undefined) throw new Error('the matrix lost the inexact-duration shape');
    const printed = formatHeader((await openEdf(byteSource(shape.bytes))).header);
    expect(printed).toContain('~68.97 Hz');
    expect(printed).not.toContain('68.96551724137932');
  });

  it('leaves the exact value where a script reads it', async () => {
    if (shape === undefined) throw new Error('the matrix lost the inexact-duration shape');
    const { header } = await openEdf(byteSource(shape.bytes));
    // The field itself is untouched. The rounding belongs to one table, for one reader.
    expect(header.signals[1]?.sampleRateHz).toBe(68.96551724137932);
  });
});

describe('the index column, which is the same story one column over', () => {
  const wide = (count: number): Uint8Array =>
    buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: Array.from({ length: count }, (_, index) => ({
        label: `S${index}`,
        samplesPerRecord: 1,
      })),
    });

  it('keeps a thousand-channel table in line, where three characters could not', async () => {
    const { header } = await openEdf(byteSource(wide(1200)));
    const rows = tableRows(formatHeader(header));
    const at = rangeColumn(rows[0] as string);
    // Signal 999 and signal 1000 are the pair that used to disagree.
    for (const row of rows) {
      expect({ row: row.slice(0, 12), before: row[at - 1] }).toEqual({
        row: row.slice(0, 12),
        before: ' ',
      });
    }
    expect(rows).toHaveLength(1201);
  });

  it('leaves a file with fewer than a thousand signals exactly as it was', async () => {
    // The width is `max(3, …)`, so every ordinary file prints what it printed before.
    const { header } = await openEdf(byteSource(wide(999)));
    const rows = tableRows(formatHeader(header));
    expect(rows[0]).toBe(`  #  ${'label'.padEnd(21)}${'kind'.padEnd(12)}${'rate'.padEnd(9)} range`);
    expect(rows[999]).toMatch(/^998 {2}S998 /);
  });
});

describe('an ordinary rate', () => {
  it('is printed exactly, so the tilde means something when it appears', async () => {
    const plain = AWKWARD.find((one) => one.name === 'plain EDF, one signal');
    if (plain === undefined) throw new Error('the matrix lost its plain file');
    const printed = formatHeader((await openEdf(byteSource(plain.bytes))).header);
    expect(printed).toContain('8 Hz');
    expect(printed).not.toContain('~');
  });
});
