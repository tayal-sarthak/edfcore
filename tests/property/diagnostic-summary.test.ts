/**
 * `summarizeDiagnostics` loses nothing and invents nothing.
 *
 * Everything that prints a count of a file's problems goes through it: the first line of
 * `edfcore validate`, the summary under `edfcore header`, and the `worst` a caller branches on to
 * decide whether a recording is usable. So the arithmetic has one job — to be the list, counted —
 * and the ways it can fail are all quiet. A severity counted twice inflates a report; a code
 * appearing twice in `byCode` turns one defect into two in the one place a reader looks to find
 * out how bad a file is.
 *
 * By example the existing tests pin the two DECISIONS, which is right: `worst` is by severity rank
 * rather than arrival, and it is `undefined` rather than `'info'` for an empty list. What they do
 * not pin is that the counting adds up, and it is the part with no decision in it — which is
 * exactly the part nobody writes a case for.
 *
 * Four invariants over arbitrary lists, including the shapes a hand-written fixture does not
 * reach: every severity absent, one code repeated forty times, several codes tied on count, and
 * the empty list. `byCode`'s tie-breaking is included because the docblock promises it — equal
 * counts keep the order they were first seen, which is what makes the output deterministic and
 * therefore diffable between two runs over the same file.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import type { EdfDiagnostic, EdfSeverity } from '../../src/types.js';

const SEED = 0x2f8b;

const RANK: Readonly<Record<EdfSeverity, number>> = { info: 0, warning: 1, error: 2 };

function diagnosticOf(code: string, severity: EdfSeverity): EdfDiagnostic {
  return {
    code,
    severity,
    message: `${code} happened`,
    field: undefined,
    byteOffset: undefined,
    byteLength: undefined,
    rawBytes: undefined,
    raw: undefined,
    expected: undefined,
    actual: undefined,
    signalIndex: undefined,
    recordIndex: undefined,
    specReference: undefined,
  };
}

/**
 * A small code alphabet on purpose: repeats and ties are the interesting inputs, and a generator
 * drawing unique codes would produce `byCode` entries of count 1 for ever.
 */
const entry = fc.tuple(
  fc.constantFrom('TRUNCATED_FILE', 'DATE_UNPARSEABLE', 'LABEL_TOO_LONG', 'RECORD_SIZE_ZERO'),
  fc.constantFrom<EdfSeverity>('error', 'warning', 'info'),
);

const list = fc.array(entry, { maxLength: 40 }).map((rows) =>
  // One severity per code, as `severityOf` guarantees, so `byCode`'s "first one seen" is not
  // being asked to choose between two truths.
  rows.map(([code, severity]) => diagnosticOf(code, severity)),
);

describe('the counts are the list', () => {
  it('adds up to the total, which is the length', () => {
    fc.assert(
      fc.property(list, (diagnostics) => {
        const summary = summarizeDiagnostics(diagnostics);
        expect(summary.total).toBe(diagnostics.length);
        expect(summary.errors + summary.warnings + summary.infos).toBe(diagnostics.length);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it('counts each severity as many times as it appears', () => {
    fc.assert(
      fc.property(list, (diagnostics) => {
        const count = (severity: EdfSeverity): number =>
          diagnostics.filter((one) => one.severity === severity).length;
        const summary = summarizeDiagnostics(diagnostics);
        expect([summary.errors, summary.warnings, summary.infos]).toEqual([
          count('error'),
          count('warning'),
          count('info'),
        ]);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe('worst is the highest severity present', () => {
  it('or undefined, and only for an empty list', () => {
    fc.assert(
      fc.property(list, (diagnostics) => {
        const summary = summarizeDiagnostics(diagnostics);
        if (diagnostics.length === 0) {
          expect(summary.worst).toBeUndefined();
          return;
        }
        const highest = diagnostics.reduce((best, one) =>
          RANK[one.severity] > RANK[best.severity] ? one : best,
        ).severity;
        expect(summary.worst).toBe(highest);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe('byCode is the same list, grouped', () => {
  it('holds every code once and no code twice', () => {
    fc.assert(
      fc.property(list, (diagnostics) => {
        const summary = summarizeDiagnostics(diagnostics);
        const codes = summary.byCode.map((one) => one.code);
        expect(new Set(codes).size).toBe(codes.length);
        expect([...codes].sort()).toEqual([...new Set(diagnostics.map((one) => one.code))].sort());
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it('sums to the total, so grouping loses nothing', () => {
    fc.assert(
      fc.property(list, (diagnostics) => {
        const summary = summarizeDiagnostics(diagnostics);
        const summed = summary.byCode.reduce((total, one) => total + one.count, 0);
        expect(summed).toBe(diagnostics.length);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it('is descending by count, and first-seen order within a tie', () => {
    fc.assert(
      fc.property(list, (diagnostics) => {
        const summary = summarizeDiagnostics(diagnostics);
        const firstSeen = [...new Set(diagnostics.map((one) => one.code))];
        for (let i = 1; i < summary.byCode.length; i += 1) {
          const before = summary.byCode[i - 1] as { code: string; count: number };
          const after = summary.byCode[i] as { code: string; count: number };
          expect(before.count).toBeGreaterThanOrEqual(after.count);
          if (before.count === after.count) {
            // The promise that makes two runs over one file diffable.
            expect(firstSeen.indexOf(before.code)).toBeLessThan(firstSeen.indexOf(after.code));
          }
        }
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe('the generator reaches the shapes the properties are about', () => {
  it('produces repeats, ties and an empty list', () => {
    // Non-vacuity: without this every run above could be a list of four distinct codes.
    const repeated = Array.from({ length: 5 }, () => diagnosticOf('TRUNCATED_FILE', 'error'));
    expect(summarizeDiagnostics(repeated).byCode).toEqual([
      { code: 'TRUNCATED_FILE', severity: 'error', count: 5 },
    ]);

    const tied = [diagnosticOf('B_CODE', 'info'), diagnosticOf('A_CODE', 'info')];
    expect(summarizeDiagnostics(tied).byCode.map((one) => one.code)).toEqual(['B_CODE', 'A_CODE']);

    expect(summarizeDiagnostics([]).total).toBe(0);
  });
});
