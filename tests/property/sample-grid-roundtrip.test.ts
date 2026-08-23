/**
 * Flooring a sample's published start names the same sample again — including before t = 0.
 *
 * `gridSampleStartTicks` rounds a sample's start UP to a whole tick, on purpose. A boundary need
 * not fall on one: 256 samples in a one-second record puts sample 1 at 39,062.5 ticks, published
 * as 39,063. The rounding exists so that flooring the published value back names the sample it
 * came from, and `time/window.ts` records what happens when a bound uses the other rounding —
 * half of all indices excluded from a window beginning at their own published start, and a
 * one-sample window coming back empty at 128 samples per 0.29 s (0.3.56).
 *
 * The rule is stated in `sample-grid.ts` and demonstrated by example. Examples are where this kind
 * of arithmetic hides: a geometry whose boundaries land on whole ticks — 100 samples per second,
 * 256 per second — cannot tell the two roundings apart at all, and those are the geometries anyone
 * writing a test reaches for first.
 *
 * NEGATIVE indices are the half with a branch of its own. A time before the recording starts gives
 * a negative index rather than truncating toward zero and colliding with sample 0 — a pre-stimulus
 * window in an ERP analysis is exactly that — and for a negative numerator, bigint division
 * already truncates toward positive infinity, so the ceiling is the quotient itself and stepping
 * would be wrong. One `?:` separates the two, and nothing had ever asked it for a negative index.
 *
 * The property is the round trip, over arbitrary geometries and indices on both sides of zero,
 * with the fractional-boundary geometries generated deliberately.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import {
  gridSampleIndexAt,
  gridSampleStartSeconds,
  gridSampleStartTicks,
} from '../../src/sample-grid.js';
import type { EdfHeader, EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x6a55;

/** Rates and durations that put most boundaries off a whole tick. */
const geometry = fc.record({
  samplesPerRecord: fc.constantFrom(1, 3, 7, 13, 128, 250, 256, 512),
  recordDurationSeconds: fc.constantFrom(0.29, 0.5, 1, 2, 30),
});

interface Grid {
  readonly header: EdfHeader;
  readonly signal: EdfSignal;
}

const gridFor = (of: { samplesPerRecord: number; recordDurationSeconds: number }): Grid => {
  const bytes = buildEdf({
    recordCount: 2,
    recordDurationSeconds: of.recordDurationSeconds,
    signals: [{ label: 'Fp1', samplesPerRecord: of.samplesPerRecord }],
  });
  const header = parseHeader(bytes, bytes.byteLength);
  return { header, signal: header.signals[0] as EdfSignal };
};

/** Indices on both sides of zero, so the negative branch is not an afterthought. */
const index = fc.integer({ min: -5000, max: 5000 });

describe('a sample start, put back through the grid', () => {
  it('names the sample it came from', async () => {
    await fc.assert(
      fc.property(geometry, index, (of, at) => {
        const { header, signal } = gridFor(of);
        const start = gridSampleStartSeconds(signal, at, header.recordDurationTicks);
        const found = gridSampleIndexAt(signal, start, header.recordDurationTicks);
        expect(
          found.sampleIndex,
          `${of.samplesPerRecord}/${of.recordDurationSeconds} at ${at}`,
        ).toBe(at);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it('does so at the tick, not only at the second', () => {
    // Seconds are a float64 view of the ticks. The identity is about the ticks, so it is asked of
    // them directly as well — a round trip through seconds could pass on rounding luck.
    fc.assert(
      fc.property(geometry, index, (of, at) => {
        const { header, signal } = gridFor(of);
        const ticks = gridSampleStartTicks(signal, at, header.recordDurationTicks);
        const found = gridSampleIndexAt(signal, Number(ticks) / 1e7, header.recordDurationTicks);
        expect(found.sampleIndex).toBe(at);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe('the grid itself', () => {
  it('advances, so no two samples share a start', () => {
    fc.assert(
      fc.property(geometry, index, (of, at) => {
        const { header, signal } = gridFor(of);
        const duration = header.recordDurationTicks;
        expect(gridSampleStartTicks(signal, at + 1, duration)).toBeGreaterThan(
          gridSampleStartTicks(signal, at, duration),
        );
      }),
      { seed: SEED, numRuns: 200 },
    );
  });

  it('puts sample 0 at zero and every sample before it below zero', () => {
    fc.assert(
      fc.property(geometry, fc.integer({ min: 1, max: 5000 }), (of, before) => {
        const { header, signal } = gridFor(of);
        const duration = header.recordDurationTicks;
        expect(gridSampleStartTicks(signal, 0, duration)).toBe(0n);
        // A pre-stimulus index is a time before the recording, not a wrap around zero.
        expect(gridSampleStartTicks(signal, -before, duration)).toBeLessThan(0n);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });

  it('never lands more than a tick from the exact boundary, on either side of zero', () => {
    // What "rounded up to a whole tick" bounds: the published start is the exact rational or the
    // next tick above it, and never further.
    fc.assert(
      fc.property(geometry, index, (of, at) => {
        const { header, signal } = gridFor(of);
        const duration = header.recordDurationTicks;
        const perRecord = BigInt(signal.samplesPerRecord);
        const exactNumerator = BigInt(at) * duration;
        const published = gridSampleStartTicks(signal, at, duration) * perRecord;
        expect(published).toBeGreaterThanOrEqual(exactNumerator);
        expect(published - exactNumerator).toBeLessThan(perRecord);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});
