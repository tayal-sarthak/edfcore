/**
 * A sample outside the declared digital range comes back as it was stored — over arbitrary
 * ranges, in both storage widths.
 *
 * `design-decisions.md` states the rule and the reason:
 *
 * > A sample outside the declared digital range is returned as it was stored. edfcore counts them
 * > for free during decode (`chunkSignal.outOfDigitalRangeCount`) and does not modify them. The
 * > affine map extrapolates correctly past the declared range, so an out-of-range sample converts
 * > to a physical value that is exactly what the amplifier reported. Clamping instead flat-tops
 * > real peaks, and the resulting waveform looks like saturation that the hardware did not
 * > produce.
 *
 * Clamping is available and is a separate function you call on purpose, because EDFlib clamps on
 * read and reproducing its output during cross-validation needs the same operation.
 *
 * The unit tests check that with chosen values against chosen ranges. What examples cannot say is
 * that nothing clamps for some *combination* — a negative gain, a range that does not straddle
 * zero, a 24-bit signal whose digital span is narrower than a 16-bit one's. Those are the shapes
 * where a stray `Math.min` looks correct in review.
 *
 * Four properties, over generated ranges and generated samples:
 *
 *  - the decoded integers are the integers written, whatever the declared range says;
 *  - `outOfDigitalRangeCount` is the count an independent pass finds;
 *  - the physical map stays affine THROUGH the boundary — the step per digital unit outside the
 *    range is the step inside it, which is what "extrapolates" means and what flat-topping breaks;
 *  - `clampToDigitalRange` moves exactly the samples outside the range and nothing else.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clampToDigitalRange, toPhysical } from '../../src/decode/physical.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x0b19;

interface Shape {
  readonly format: 'EDF' | 'BDF';
  readonly digitalMinimum: number;
  readonly digitalSpan: number;
  readonly physicalMinimum: number;
  readonly physicalSpan: number;
  readonly samples: readonly number[];
}

/** Storage limits, which are what a sample may be — the declared range is a claim about it. */
const STORAGE = {
  EDF: { min: -32_768, max: 32_767 },
  BDF: { min: -8_388_608, max: 8_388_607 },
} as const;

const shape = fc.record({
  format: fc.constantFrom<'EDF' | 'BDF'>('EDF', 'BDF'),
  digitalMinimum: fc.integer({ min: -4_000, max: 0 }),
  digitalSpan: fc.integer({ min: 100, max: 8_000 }),
  // A range that need not straddle zero, and a span that may run downwards — a negative gain is
  // legal EDF and is how a polarity convention gets written down.
  physicalMinimum: fc.integer({ min: -500, max: 500 }),
  physicalSpan: fc.oneof(fc.integer({ min: 1, max: 1_000 }), fc.integer({ min: -1_000, max: -1 })),
  samples: fc.array(fc.integer({ min: -40_000, max: 40_000 }), { minLength: 8, maxLength: 32 }),
});

function build(of: Shape): Uint8Array {
  const limits = STORAGE[of.format];
  const samples = of.samples.map((value) => Math.max(limits.min, Math.min(limits.max, value)));
  return buildEdf({
    format: of.format,
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'Fp1',
        samplesPerRecord: samples.length,
        digitalMinimum: of.digitalMinimum,
        digitalMaximum: of.digitalMinimum + of.digitalSpan,
        physicalMinimum: of.physicalMinimum,
        physicalMaximum: of.physicalMinimum + of.physicalSpan,
        sample: (_record, at) => samples[at] ?? 0,
      },
    ],
  });
}

const stored = (of: Shape): readonly number[] => {
  const limits = STORAGE[of.format];
  return of.samples.map((value) => Math.max(limits.min, Math.min(limits.max, value)));
};

async function read(of: Shape) {
  const recording = await openEdf(byteSource(build(of)));
  const chunk = await readRecords(recording, {
    records: { start: 0, count: 1 },
    signalIndices: [0],
  });
  const signal = recording.header.signals[0];
  const series = chunk.signals[0];
  if (signal === undefined || series === undefined) throw new Error('no signal came back');
  return { signal, series };
}

describe('a sample outside the declared digital range', () => {
  it('comes back as it was stored', async () => {
    await fc.assert(
      fc.asyncProperty(shape, async (of) => {
        const { series } = await read(of);
        expect([...series.digital]).toEqual([...stored(of)]);
      }),
      { seed: SEED, numRuns: 80 },
    );
  });

  it('is counted, exactly', async () => {
    await fc.assert(
      fc.asyncProperty(shape, async (of) => {
        const { signal, series } = await read(of);
        const low = Math.min(signal.digitalMinimum, signal.digitalMaximum);
        const high = Math.max(signal.digitalMinimum, signal.digitalMaximum);
        const expected = stored(of).filter((value) => value < low || value > high).length;
        expect(series.outOfDigitalRangeCount).toBe(expected);
      }),
      { seed: SEED, numRuns: 80 },
    );
  });

  it('converts on the same affine map as one inside it', async () => {
    await fc.assert(
      fc.asyncProperty(shape, async (of) => {
        const { signal } = await read(of);
        fc.pre(signal.scale !== undefined);

        // The step per digital unit, measured across the declared range…
        const inside = toPhysical(
          signal,
          Int32Array.from([signal.digitalMinimum, signal.digitalMaximum]),
        );
        const span = signal.digitalMaximum - signal.digitalMinimum;
        const step = ((inside[1] ?? 0) - (inside[0] ?? 0)) / span;

        // …and again from a pair well outside it, in both directions.
        const outside = Int32Array.from([
          signal.digitalMinimum - 3 * span,
          signal.digitalMaximum + 3 * span,
        ]);
        const converted = toPhysical(signal, outside);
        const stepOutside =
          ((converted[1] ?? 0) - (converted[0] ?? 0)) / ((outside[1] ?? 0) - (outside[0] ?? 0));

        // Flat-topping would make this step zero at the ends; a clamp anywhere would make it
        // smaller than the step inside.
        expect(stepOutside).toBeCloseTo(step, 9);
        // And the extrapolation really leaves the declared physical range, in the direction the
        // gain points — the peak the hardware reported rather than the ceiling the header claims.
        const beyondHigh = converted[1] ?? 0;
        if (step > 0) expect(beyondHigh).toBeGreaterThan(inside[1] ?? 0);
        else expect(beyondHigh).toBeLessThan(inside[1] ?? 0);
      }),
      { seed: SEED, numRuns: 80 },
    );
  });

  it('is what clampToDigitalRange moves, and the only thing it moves', async () => {
    await fc.assert(
      fc.asyncProperty(shape, async (of) => {
        const { signal, series } = await read(of);
        const clamped = clampToDigitalRange(signal, series.digital);
        const low = Math.min(signal.digitalMinimum, signal.digitalMaximum);
        const high = Math.max(signal.digitalMinimum, signal.digitalMaximum);

        expect(clamped.length).toBe(series.digital.length);
        for (const [at, value] of [...series.digital].entries()) {
          const got = clamped[at];
          if (value >= low && value <= high) expect(got).toBe(value);
          else expect(got).toBe(value < low ? low : high);
        }
        // The point of the function: nothing is left outside afterwards.
        expect([...clamped].every((value) => value >= low && value <= high)).toBe(true);
      }),
      { seed: SEED, numRuns: 80 },
    );
  });
});
