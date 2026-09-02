/**
 * Every column width in this package is measured, or bounded by something that cannot grow.
 *
 * Four releases in a row fixed the same defect in four formatters: a value wider than the space it
 * was given. A sample rate of `68.96551724137932` in a nine-character column (0.6.23), a signal
 * index of 1000 in three (0.6.24), a negative or hundred-hour clock in twelve (0.6.25), and an
 * observed range and sample count that were not padded at all (0.6.34). Each was found by looking
 * at output rather than by anything failing, and each was the same mistake made once more.
 *
 * So this is the census. Every `padStart` and `padEnd` in `src/` that lays out a column is listed
 * below with the reason its width is safe, and there are exactly three reasons:
 *
 * - MEASURED from the rows being printed, which is the fix the four releases converged on.
 * - Bounded by the FILE FORMAT: a label is 16 bytes and cannot be 22, `kind` is one of two words,
 *   and a rate is rounded to fit by `formatRate`.
 * - Bounded by an ARGUMENT no test can build. Two count columns are wide enough for any count a
 *   file could carry within reason, and the arithmetic is written out beside them — they are the
 *   two this file cannot demonstrate, which is exactly why they are named rather than assumed.
 *
 * A new width fails here until it says which of the three it is. That is the point: the four fixes
 * were reactive, and this is what makes the fifth one impossible to add by accident.
 *
 * Zero-padding is not a column and is excluded by pattern: `padStart(2, '0')` on a clock digit is
 * a number's own spelling, not a place in a table.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../src/', import.meta.url);

/** Every column-laying `pad*` call in `src/`, as `file:width-expression`. */
function columnPads(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: URL, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const source = readFileSync(new URL(entry.name, directory), 'utf8');
      for (const match of source.matchAll(/pad(?:Start|End)\(([^)]*)\)/g)) {
        const argument = (match[1] ?? '').trim();
        // A fill character makes it zero-padding: a number's own spelling, not a column.
        if (argument.includes(',')) continue;
        found.push(`${prefix}${entry.name}:${argument}`);
      }
    }
  };
  walk(SRC, '');
  return found.sort();
}

/**
 * Every one of them, with why its width is safe. Adding a row here is the moment to decide which
 * of the three reasons applies — which is the whole value of the list.
 */
const WIDTHS: Readonly<Record<string, string>> = {
  // Measured from the rows being printed.
  'format-header.ts:indexWidth': 'measured: max(3, widest signal index in this file) — 0.6.24',
  'format-annotations.ts:onsetWidth': 'measured: max(12, widest onset in this listing) — 0.6.25',
  'format-annotations.ts:durationWidth': 'measured: max(12, widest duration) — 0.6.25',
  'format-report.ts:rangeWidth': 'measured: widest observed range in this report — 0.6.34',
  'format-report.ts:countWidth': 'measured: widest sample count in this report — 0.6.34',

  // Bounded by the file format.
  'format-header.ts:21': 'format: a label is 16 bytes, and the heading uses the same width',
  'format-report.ts:21': 'format: the same 16-byte label, or `signal <index>` at 4 digits',
  'format-header.ts:12': "format: `kind` is 'data' or 'annotations', and 'annotations' is 11",
  'format-header.ts:9': 'format: formatRate rounds anything longer to `~nn.nn Hz`, which is 9',

  // Bounded by an argument rather than by a measurement, and named here for that reason.
  'format-report.ts:7':
    'argument: a per-code diagnostic count. Seven digits is 9,999,999 of one code; the record ' +
    'count field is 8 characters, so a per-record code on the largest file the format can ' +
    'describe would need 8. Not measured because no test can build the report that shows it.',
  'cli-run.ts:8':
    'argument: an event count. Eight digits is 99,999,999 events, which needs roughly a gigabyte ' +
    'of TAL text. Not measured for the same reason.',
};

describe('the census', () => {
  it('found the pads, so a passing run is not a vacuous one', () => {
    expect(columnPads().length).toBeGreaterThan(8);
    expect(columnPads()).toContain('format-header.ts:indexWidth');
  });

  it('accounts for every column width, and for no width that is gone', () => {
    // `format-header.ts:21` appears twice — the heading and the rows — which is the property
    // 0.3.96 established, so the set is compared rather than the list.
    expect([...new Set(columnPads())].sort()).toEqual(Object.keys(WIDTHS).sort());
  });

  it('gives each of them one of the three reasons', () => {
    for (const [where, reason] of Object.entries(WIDTHS)) {
      expect({ where, kind: reason.split(':')[0] }).toEqual({
        where,
        kind: expect.stringMatching(/^(measured|format|argument)$/) as unknown as string,
      });
    }
  });

  it('leaves most of them measured, which is where the four fixes landed', () => {
    const measured = Object.values(WIDTHS).filter((one) => one.startsWith('measured'));
    expect(measured.length).toBeGreaterThanOrEqual(5);
  });

  it('names exactly two that are neither measured nor bounded by the format', () => {
    const argued = Object.entries(WIDTHS).filter(([, one]) => one.startsWith('argument'));
    expect(argued.map(([where]) => where).sort()).toEqual(['cli-run.ts:8', 'format-report.ts:7']);
  });
});

describe('what the pattern excludes', () => {
  it('leaves zero-padding alone, which is a number spelling itself', () => {
    // `String(hour).padStart(2, '0')` is not a column, and a rule that swept it in would be
    // asking a clock digit to justify a width the format fixes.
    expect(columnPads().some((one) => one.endsWith(':2'))).toBe(false);
    const dates = readFileSync(new URL('header/dates.ts', SRC), 'utf8');
    expect(dates).toContain("padStart(width, '0')");
  });
});
