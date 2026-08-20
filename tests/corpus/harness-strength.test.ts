/**
 * The three cross-implementation harnesses claim, on the page, exactly what they assert in code.
 *
 * `physical-values.md` publishes a table of them and its whole point is that they are NOT equally
 * strong: pyEDFlib physical values are matched bit for bit, pyEDFlib annotation onsets exactly to
 * the tick, and MNE only to 1e-12 relative — "**not** bit-exact", because MNE returns SI units and
 * the division by 1e6 that produces them is lossy.
 *
 * That distinction is the reason the table exists, and it is a claim about the tests rather than
 * about the library, so no test could previously be wrong in a way that showed. The MNE bound is
 * one constant in one file. Loosening it to 1e-9 for a flaky run would leave the page publishing a
 * parity claim a thousand times stronger than the one being made, and every check in the suite
 * would still pass — including the ones that read this page.
 *
 * So the published bound is read out of the harness, and the two exact rows are checked for the
 * absence of a tolerance rather than the presence of one: `Object.is` and `toBe`, no `toBeCloseTo`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeOnly } from '../support/code-only.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const source = (name: string): string =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const PAGE = DOCS_PAGES.get('physical-values.md') ?? '';

/** The `| … | … | … |` rows of the harness table, in page order. */
const ROWS: readonly (readonly string[])[] = (() => {
  const at = PAGE.indexOf('Three harnesses, and they do not all claim the same strength:');
  if (at === -1) throw new Error('physical-values.md no longer tabulates the harnesses');
  const rows: string[][] = [];
  for (const line of PAGE.slice(at).split('\n')) {
    // The page has more tables below this one, so the first line that is not a row ends it.
    if (!line.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    rows.push(
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
  }
  // Drop the header row and the `|---|` separator.
  return rows.slice(2);
})();

describe('the harness strength table', () => {
  it('has one row per harness in the repository', () => {
    expect(ROWS.map((cells) => cells[0])).toEqual([
      'pyEDFlib physical values',
      'pyEDFlib annotation onsets',
      'MNE',
    ]);
  });

  it('quotes the bound the MNE harness actually applies', () => {
    const published = /([\d.e-]+) relative/.exec(ROWS[2]?.[2] ?? '')?.[1];
    const applied = /const MAX_RELATIVE_DIFFERENCE = ([\d.e-]+);/.exec(
      source('mne-parity.test.ts'),
    );
    expect(applied).not.toBeNull();
    expect(Number(published)).toBe(Number(applied?.[1]));
  });

  it('says of MNE that it is not bit-exact, which is the row that carries a tolerance', () => {
    expect(ROWS[2]?.[2]).toContain('**not** bit-exact');
    // The tolerance is applied to a relative difference, not to an absolute one or an ULP count:
    // MNE reports volts, so the same rounding spans a different number of floats near 1e-6.
    expect(source('mne-parity.test.ts')).toContain('relative > worst');
  });

  it('claims bit-for-bit of the pyEDFlib values, and the harness compares with Object.is', () => {
    expect(ROWS[0]?.[2]).toBe('**bit for bit**');
    const harness = source('golden-values.test.ts');
    expect(harness).toContain('Object.is(got, want)');
    // A tolerance anywhere in that file would make the strongest row of the table untrue.
    // Comments are stripped first: that file explains, correctly, why it does NOT use one.
    expect(codeOnly(harness)).not.toContain('toBeCloseTo');
  });

  it('claims tick-exactness of the pyEDFlib onsets, and the harness compares exactly', () => {
    expect(ROWS[1]?.[2]).toBe('exact, to the tick');
    const harness = source('annotation-parity.test.ts');
    expect(harness).toContain('onsetTicksFromFirstRecord');
    expect(codeOnly(harness)).not.toContain('toBeCloseTo');
  });

  it('says why the weakest row cannot be strengthened', () => {
    // "MNE returns SI units, so a microvolt channel arrives divided by 1e6 and that division is
    //  lossy — the two cannot be bit-identical, and claiming otherwise would be claiming
    //  something false."
    expect(PAGE.replace(/\s+/g, ' ')).toContain('The MNE bound is weaker on purpose');
    // Demonstrated rather than quoted, with the very sample the page prints from the symmetric
    // fixture: it does not survive the trip through volts, so MNE cannot be matched bit for bit.
    const microvolts = -492.15686274509807;
    expect((microvolts / 1e6) * 1e6).not.toBe(microvolts);
  });
});
