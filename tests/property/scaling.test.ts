/**
 * How far the pinned conversion lands from a signal's own declared bounds.
 *
 * `physical-values.md` used to say the EDFlib form and the textbook one "agree at the endpoints",
 * which is true of the one range it tabulates and false of most declarations (corrected in
 * 0.4.342). The textbook form returns `physicalMinimum` at `digitalMinimum` by construction —
 * `physicalMinimum + 0 * gain`. The EDFlib form detours through
 * `physicalMaximum / bitValue - digitalMaximum` and multiplies back, and nothing in that round
 * trip has to land on the declared bound.
 *
 * The page now states a bound instead of claiming exactness, and this file is where the bound
 * comes from. It matters because a reader plotting a fixed axis is the person most likely to call
 * `toPhysical` at an extreme, and "exact" and "a fraction of a quantisation step" lead to
 * different code: the first invites an equality check.
 *
 * MEASURED IN QUANTISATION STEPS, which took two wrong units to arrive at.
 *
 * ULP distance was the first, and is the mistake `mne-parity.test.ts` records: a declaration whose
 * bounds are 0.0002 and -4827 lands 5.4 million ULP from the smaller one while being physically
 * indistinguishable from it. Relative error was the second, and fails the same way at the other
 * end — a bound of 0.001 beside a bound of 99999 shows a relative error of 1.3e-3 for an absolute
 * error far below anything the file can express. `bitValue` is the smallest difference the
 * amplifier can express, so a fraction of it is the only unit in which "you could not notice this"
 * is a statement about the recording. It is the unit the page already uses for the float32 cost
 * and for the difference between the two forms.
 *
 * The comparison is against the bounds the PARSED signal reports, never the numbers handed to the
 * writer. A physical bound lives in an eight-character ASCII field, so `1e-6` is written
 * `0.000000` and comes back as zero — the first run of this file failed on exactly that, with a
 * `DEGENERATE_PHYSICAL_RANGE` for a range that was fine until it was written down. Reading the
 * bounds back off the header makes this a property about declarations a file can actually hold,
 * which is the only kind there is.
 *
 * Every `fc.assert` passes a constant seed, so a failure is reproducible from the output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { physicalRangeOf, toPhysical } from '../../src/decode/physical.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

/** Reproducible, and printed by fast-check on a failure. */
const SEED = 0x5ca1e;

/**
 * A thousandth of one quantisation step. Comfortably above the worst observed — about 2.4e-5 of a
 * step over 800,000 random declarations — and far below the smallest difference any amplifier can
 * express, so this fails on a change in the expression rather than on the weather.
 */
const MAX_ENDPOINT_ERROR_IN_STEPS = 1e-3;

interface Range {
  readonly physicalMinimum: number;
  readonly physicalMaximum: number;
  readonly digitalMinimum: number;
  readonly digitalMaximum: number;
}

interface Endpoints {
  readonly low: number;
  readonly high: number;
  /** The worse of the two endpoint errors, in quantisation steps. */
  readonly worstInSteps: number;
}

/**
 * Both endpoints of `range` through the real read path, measured against what the FILE declares.
 *
 * `undefined` when the range did not survive being written into eight-character fields: a
 * declaration the format cannot express is not a case this property is about.
 */
async function endpoints(range: Range): Promise<Endpoints | undefined> {
  const bytes = buildEdf({
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [{ label: 'A', samplesPerRecord: 2, physicalDimension: 'uV', ...range }],
  });
  const { header } = await openEdf(byteSource(bytes));
  const signal = getSignal(header, 'A');
  const bitValue = signal.scale?.bitValue;
  if (bitValue === undefined || bitValue === 0) return undefined;

  const converted = toPhysical(
    signal,
    Int32Array.from([signal.digitalMinimum, signal.digitalMaximum]),
  );
  const low = converted[0] ?? Number.NaN;
  const high = converted[1] ?? Number.NaN;
  return {
    low,
    high,
    worstInSteps: Math.max(
      Math.abs(low - signal.physicalMinimum) / Math.abs(bitValue),
      Math.abs(high - signal.physicalMaximum) / Math.abs(bitValue),
    ),
  };
}

const bound = fc.double({ min: -1e5, max: 1e5, noNaN: true, noDefaultInfinity: true });
const belowZero = fc.integer({ min: -8_388_608, max: -1 });
const aboveZero = fc.integer({ min: 1, max: 8_388_607 });

describe('the endpoints of an arbitrary declaration', () => {
  it('stay within a thousandth of one quantisation step', async () => {
    // A whole file is built and parsed per run, so the run count stays low the way
    // `roundtrip.test.ts` keeps its own.
    await fc.assert(
      fc.asyncProperty(
        bound,
        bound,
        belowZero,
        aboveZero,
        async (physicalMinimum, physicalMaximum, digitalMinimum, digitalMaximum) => {
          const measured = await endpoints({
            physicalMinimum,
            physicalMaximum,
            digitalMinimum,
            digitalMaximum,
          });
          fc.pre(measured !== undefined);
          expect(measured?.worstInSteps).toBeLessThan(MAX_ENDPOINT_ERROR_IN_STEPS);
        },
      ),
      { seed: SEED, numRuns: 120 },
    );
  });

  it('never produces NaN or an infinity from four finite fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        bound,
        bound,
        belowZero,
        aboveZero,
        async (physicalMinimum, physicalMaximum, digitalMinimum, digitalMaximum) => {
          const measured = await endpoints({
            physicalMinimum,
            physicalMaximum,
            digitalMinimum,
            digitalMaximum,
          });
          fc.pre(measured !== undefined);
          expect(Number.isFinite(measured?.low) && Number.isFinite(measured?.high)).toBe(true);
        },
      ),
      { seed: SEED, numRuns: 120 },
    );
  });
});

describe('the cases a random search is unlikely to reach', () => {
  /**
   * Bounds many orders of magnitude apart, and bounds far from zero with a narrow span. Both put
   * pressure on `offset = physicalMaximum / bitValue - digitalMaximum`, where a quotient large
   * beside `digitalMaximum` loses the low bits that the multiply back then needs.
   */
  const ADVERSARIAL: readonly Range[] = [
    {
      physicalMinimum: 0.001,
      physicalMaximum: 99_999,
      digitalMinimum: -32_768,
      digitalMaximum: 32_767,
    },
    {
      physicalMinimum: 86_302.6,
      physicalMaximum: 86_310.4,
      digitalMinimum: -32_768,
      digitalMaximum: 32_767,
    },
    {
      physicalMinimum: -70_645.9,
      physicalMaximum: 0.045_83,
      digitalMinimum: -2_342_912,
      digitalMaximum: 678_843,
    },
    {
      physicalMinimum: 99_999,
      physicalMaximum: -99_999,
      digitalMinimum: -8_388_608,
      digitalMaximum: 8_388_607,
    },
  ];

  it('stays under the same bound on every one of them', async () => {
    for (const range of ADVERSARIAL) {
      const measured = await endpoints(range);
      expect(measured, JSON.stringify(range)).toBeDefined();
      expect(measured?.worstInSteps, JSON.stringify(range)).toBeLessThan(
        MAX_ENDPOINT_ERROR_IN_STEPS,
      );
    }
  });

  it('misses the declared bound on at least one of them, which is why the page has a note', async () => {
    const misses = [];
    for (const range of ADVERSARIAL) {
      const measured = await endpoints(range);
      if ((measured?.worstInSteps ?? 0) > 0) misses.push(range);
    }
    expect(misses.length).toBeGreaterThan(0);
  });

  it('leaves physicalRangeOf exact on every one of them', async () => {
    // Which is the whole reason the page sends an axis there instead.
    for (const range of ADVERSARIAL) {
      const bytes = buildEdf({
        recordCount: 1,
        recordDurationSeconds: 1,
        signals: [{ label: 'A', samplesPerRecord: 2, ...range }],
      });
      const { header } = await openEdf(byteSource(bytes));
      const signal = getSignal(header, 'A');
      // Against the parsed fields, for the same reason `endpoints` uses them.
      expect(physicalRangeOf(signal)).toEqual({
        low: Math.min(signal.physicalMinimum, signal.physicalMaximum),
        high: Math.max(signal.physicalMinimum, signal.physicalMaximum),
      });
    }
  });
});
