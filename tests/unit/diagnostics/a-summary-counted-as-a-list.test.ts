/**
 * The counting sibling of the function 0.6.160 taught to refuse a by-code summary.
 *
 * That release stopped `formatDiagnostics(summary.byCode)` — the compact summary handed to the
 * compact formatter, two functions in one directory — and its argument was that "a caller mistake
 * between two functions in one directory surfaced as an internal field name with no `Next:`
 * clause". It threw, because rendering reads a third field a row does not carry.
 *
 * `summarizeDiagnostics` reads exactly the two fields a row DOES carry, `code` and `severity`, so
 * the same argument reached the end of the loop and came back as a summary. Not an obviously
 * damaged one: `total` is the number of distinct codes, every `count` is 1, `worst` is right, and
 * the shape is a `EdfDiagnosticSummary` in every respect. There is nothing on it to test.
 *
 * That is the failure this package spends itself on — a silent answer that is also one of the
 * function's real answers. The number it gets wrong is the number the call exists to produce: a
 * file where `TIMEKEEPING_TAL_MISSING` fired four hundred times summarises, on the second pass, as
 * a file with one thing wrong with it.
 *
 * Re-summarising is not a contrived call. `byCode` is what a caller keeps when they want the
 * counts without the list — it is why the type exists — so the summary is the array still in hand
 * when the next call is written.
 */

import { describe, expect, it } from 'vitest';
import { summarizeDiagnostics } from '../../../src/diagnostics/summary.js';
import type { EdfDiagnostic } from '../../../src/types.js';

function diagnostic(code: string): EdfDiagnostic {
  return { code, severity: 'warning', message: `${code} happened` } as EdfDiagnostic;
}

/** One code, many times: the shape `byCode` exists to compress, and the one it misreports. */
const REPEATED = [diagnostic('A'), diagnostic('A'), diagnostic('A'), diagnostic('B')];

const summarize = (value: unknown): ReturnType<typeof summarizeDiagnostics> =>
  (summarizeDiagnostics as unknown as (v: unknown) => ReturnType<typeof summarizeDiagnostics>)(
    value,
  );

describe('a by-code summary counted as a diagnostics list', () => {
  it('is refused rather than counted', () => {
    const summary = summarizeDiagnostics(REPEATED);
    expect(summary.total).toBe(4);
    expect(summary.byCode).toHaveLength(2);
    expect(() => summarize(summary.byCode)).toThrow(RangeError);
  });

  it('says why a row is not a diagnostic, and what the wrong count would have been', () => {
    const summary = summarizeDiagnostics(REPEATED);
    try {
      summarize(summary.byCode);
      expect.unreachable('a by-code summary must not be counted as a diagnostics list');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('counts a code rather than being one');
      expect(message).toContain('the number of distinct codes as the number of diagnostics');
      expect(message).toContain('Next:');
    }
  });

  it('names the position, so the element is findable in a long list', () => {
    expect(() => summarize([diagnostic('A'), { code: 'B', severity: 'error', count: 1 }])).toThrow(
      /the value at 1\b/,
    );
  });

  it('still counts a real list, element by element', () => {
    // The guard runs per element rather than on the first one, so a list that goes wrong halfway
    // is refused too — and a good list is unaffected.
    const summary = summarizeDiagnostics(REPEATED);
    expect(summary.byCode[0]).toEqual({ code: 'A', severity: 'warning', count: 3 });
    expect(summary.worst).toBe('warning');
  });
});
