/**
 * The ELEMENTS of the array `formatDiagnostics` renders.
 *
 * 0.6.95 guarded the argument itself, and said why it matters more here than elsewhere: `''` is
 * this function's all-clear, so `formatDiagnostics(recording)` returned a clean bill of health for
 * a file nobody looked at. An ARRAY of the wrong thing walks straight past that guard — the same
 * gap 0.6.152 closed in `mergeChunks`, which had named one wrong argument and accepted an array of
 * it.
 *
 * The neighbour that supplies one sits in this directory. `summarizeDiagnostics(header.diagnostics)`
 * returns `byCode`, whose rows carry `code` and `severity` — two of the three fields the renderer
 * reads — so passing the compact summary to the compact formatter got most of the way through
 * building a diagnostic block and then threw V8's
 * `Cannot read properties of undefined (reading 'split')` on the third.
 *
 * It does not return `''` for this, so the 0.6.95 danger is not the one here; what was wrong is
 * that a caller mistake between two functions in one directory surfaced as an internal field name
 * with no `Next:` clause.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../../src/diagnostics/format.js';
import { summarizeDiagnostics } from '../../../src/diagnostics/summary.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf } from '../../../src/recording.js';
import type { EdfDiagnostic } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

/** A two-digit year, so every file carries at least one diagnostic to summarise. */
const FILE = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const diagnostics = async (): Promise<readonly EdfDiagnostic[]> =>
  (await openEdf(byteSource(FILE))).header.diagnostics;

const render = (value: unknown): string =>
  (formatDiagnostics as unknown as (v: unknown) => string)(value);

describe('the by-code summary passed to the formatter', () => {
  it('is refused rather than dereferenced', async () => {
    const summary = summarizeDiagnostics(await diagnostics());
    expect(summary.byCode.length).toBeGreaterThan(0);
    expect(() => render(summary.byCode)).toThrow(RangeError);
  });

  it('says what a summary row is, and never leaks the internal field', async () => {
    const summary = summarizeDiagnostics(await diagnostics());
    try {
      render(summary.byCode);
      expect.unreachable('a summary row must not be rendered as a diagnostic');
    } catch (error) {
      expect((error as Error).message).toContain('counts a code rather than being a diagnostic');
      expect((error as Error).message).toContain('Next:');
      expect((error as Error).message).not.toContain('Cannot read properties');
    }
  });

  it('names the position, since only one element may be wrong', async () => {
    const list = await diagnostics();
    const mixed = [...list, { code: 'X', severity: 'error', count: 1 }];
    expect(() => render(mixed)).toThrow(new RegExp(`the value at ${list.length} is`));
  });
});

describe('other things that are not diagnostics', () => {
  it.each([
    ['an empty object', {}],
    ['null', null],
    ['a string', 'DATE_CLIPPED_TO_1985_2084'],
  ])('is refused when it is %s', (_name, value) => {
    expect(() => render([value])).toThrow(/carries no message/);
  });
});

describe('the arrays it does render', () => {
  it('still renders a real diagnostics array', async () => {
    const text = formatDiagnostics(await diagnostics());
    expect(text).toContain('DATE_CLIPPED_TO_1985_2084');
  });

  it("still returns '' for a file with no problems", () => {
    expect(formatDiagnostics([])).toBe('');
  });

  it('still refuses an argument that is not an array at all', () => {
    expect(() => render({ diagnostics: [] })).toThrow(/not an array/);
  });
});
