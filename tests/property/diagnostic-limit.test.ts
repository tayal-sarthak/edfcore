/**
 * `formatDiagnostics` shows what it kept and accounts for what it dropped.
 *
 * `maxItems` is what stops a file with four hundred defects filling a terminal, and the "... and N
 * more" line under the output is the only thing telling a reader that a cap was applied at all.
 * Get the arithmetic wrong in either direction and the failure is silent: too small an N and a
 * reader believes they have seen more of the file than they have; a missing line and they believe
 * they have seen all of it.
 *
 * By example that is a handful of cases at round numbers, and the rounding is where the cases are
 * not round. `requireItemLimit` floors a fractional `maxItems`, clamps a negative one to zero,
 * reads `undefined` and `Infinity` as "no cap", and refuses `NaN` — five behaviours reachable from
 * a CLI flag, a config file or a caller's arithmetic, and each one changes what N should be.
 *
 * `NaN` is the one that is not a number of items at all. It used to be folded in with `Infinity`
 * by a single `!Number.isFinite`, which meant a limit computed from an absent config key printed
 * the whole list; it throws now (0.6.1), and the generator still produces it so that the refusal
 * is part of this property rather than a case it stopped covering.
 *
 * Three invariants, and the third is what makes the other two mean anything: the blocks shown are
 * the resolved limit, the notice appears exactly when something was withheld, and shown plus
 * hidden is the number that went in. Without the third, showing nothing and claiming everything
 * was hidden satisfies the first two.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import type { EdfDiagnostic } from '../../src/types.js';

const SEED = 0x4c17;

/** A block starts at column 0 with `severity [CODE]`; every continuation is indented. */
const BLOCKS = /^(?:error|warning|info) \[[A-Z0-9_]+\]/gm;

function diagnosticAt(index: number): EdfDiagnostic {
  return {
    code: `SYNTHETIC_${index}`,
    severity: index % 3 === 0 ? 'error' : index % 3 === 1 ? 'warning' : 'info',
    message: `diagnostic number ${index}`,
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

/** What `requireItemLimit` promises for the values it accepts. `NaN` is not one of them. */
function expectedShown(maxItems: number | undefined, total: number): number {
  if (maxItems === undefined) return total;
  return Math.max(0, Math.min(total, Math.floor(maxItems)));
}

/** The shapes a `maxItems` arrives in, including the ones a flag or a division produces. */
const maxItems = fc.oneof(
  fc.constant(undefined),
  fc.integer({ min: -5, max: 45 }),
  fc.double({ min: -2, max: 45, noNaN: true }),
  fc.constantFrom(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN),
);

describe('however many there are and however many are asked for', () => {
  it('shows the resolved limit and accounts for the rest', () => {
    fc.assert(
      fc.property(fc.nat({ max: 40 }), maxItems, (total, limit) => {
        const diagnostics = Array.from({ length: total }, (_, index) => diagnosticAt(index));
        if (limit !== undefined && Number.isNaN(limit)) {
          expect(() => formatDiagnostics(diagnostics, { maxItems: limit })).toThrow(RangeError);
          return;
        }
        const out = formatDiagnostics(diagnostics, limit === undefined ? {} : { maxItems: limit });

        const shown = out.match(BLOCKS)?.length ?? 0;
        expect(shown).toBe(expectedShown(limit, total));

        const notice = /^\.\.\. and (\d+) more$/m.exec(out);
        const hidden = notice === null ? 0 : Number(notice[1]);

        // The notice is there exactly when something was withheld, and never otherwise.
        expect(notice !== null).toBe(total - shown > 0);
        // And the two numbers are the whole list, which is what stops either being invented.
        expect(shown + hidden).toBe(total);
      }),
      { seed: SEED, numRuns: 400 },
    );
  });

  it('shows the first n, not an arbitrary n', () => {
    // Order is the other half of "you have seen part of it": a reader who raises the cap expects
    // the lines they already read to still be there, above the new ones.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 0, max: 20 }), (total, n) => {
        const diagnostics = Array.from({ length: total }, (_, index) => diagnosticAt(index));
        const out = formatDiagnostics(diagnostics, { maxItems: n });

        const codes = [...out.matchAll(/\[(SYNTHETIC_\d+)\]/g)].map((match) => match[1]);
        const wanted = diagnostics.slice(0, Math.min(n, total)).map((one) => one.code);
        expect(codes).toEqual(wanted);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });
});

describe('the generator reaches the cases the property is about', () => {
  it('produces a cap that hides some, a cap that hides none, and no cap at all', () => {
    // Non-vacuity: without this the property could be passing on four hundred runs that all had
    // nothing to hide.
    const diagnostics = Array.from({ length: 5 }, (_, index) => diagnosticAt(index));
    expect(formatDiagnostics(diagnostics, { maxItems: 2 })).toContain('... and 3 more');
    expect(formatDiagnostics(diagnostics, { maxItems: 5 })).not.toContain('more');
    expect(formatDiagnostics(diagnostics)).not.toContain('more');
    expect(formatDiagnostics(diagnostics, { maxItems: 0 })).toBe('... and 5 more');
    // And the two non-finite spellings, which are no longer the same answer.
    expect(formatDiagnostics(diagnostics, { maxItems: Number.POSITIVE_INFINITY })).not.toContain(
      'more',
    );
    expect(() => formatDiagnostics(diagnostics, { maxItems: Number.NaN })).toThrow(RangeError);
  });
});
