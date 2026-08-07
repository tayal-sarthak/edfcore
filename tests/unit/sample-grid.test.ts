/**
 * Time to sample index.
 *
 * The tests that matter are the ones where `Math.round(seconds * sampleRateHz)` gives a DIFFERENT
 * answer: a record duration with no exact float representation, and a record duration of zero.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import {
  gridSampleIndexAt,
  gridSampleStartSeconds,
  gridSampleStartTicks,
} from '../../src/sample-grid.js';
import type { EdfHeader, EdfSignal } from '../../src/types.js';
import { minimalEdf } from '../support/writer.js';

async function fixture(
  recordDurationSeconds: number,
  samplesPerRecord: number,
): Promise<{ header: EdfHeader; signal: EdfSignal }> {
  const recording = await openEdf(
    byteSource(
      minimalEdf({
        recordCount: 200,
        recordDurationSeconds,
        signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord }],
      }),
    ),
  );
  const signal = recording.header.signals[0];
  if (signal === undefined) throw new Error('the fixture has no signal');
  return { header: recording.header, signal };
}

describe('gridSampleIndexAt', () => {
  it('agrees with the naive formula where the naive formula is exact', async () => {
    const { header, signal } = await fixture(1, 100);
    for (const seconds of [0, 0.5, 1, 3.33, 10]) {
      const naive = Math.floor(seconds * 100);
      expect(gridSampleIndexAt(signal, seconds, header.recordDurationTicks).sampleIndex).toBe(
        naive,
      );
    }
  });

  it('stays exact where the naive formula drifts', async () => {
    // 128 samples over 0.3 s is 426.666... per second, which has no exact float representation.
    // Multiplying it by a large `seconds` accumulates error until the index is off by one.
    const { header, signal } = await fixture(0.3, 128);
    const rate = signal.sampleRateHz;
    if (rate === undefined) throw new Error('the fixture has no sample rate');

    let drifted = 0;
    for (let record = 0; record < 200; record += 1) {
      const seconds = record * 0.3;
      // The exact answer: record `record` begins at sample `record * 128`, by definition.
      const exact = record * 128;
      const actual = gridSampleIndexAt(signal, seconds, header.recordDurationTicks).sampleIndex;
      expect(actual).toBe(exact);
      if (Math.floor(seconds * rate) !== exact) drifted += 1;
    }
    // The point of the test: the naive formula really does disagree somewhere in this range.
    expect(drifted).toBeGreaterThan(0);
  });

  it('floors rather than rounds, so a boundary is never a sample late', async () => {
    const { header, signal } = await fixture(1, 10);
    // Sample 3 covers [0.3, 0.4). Rounding would put 0.39 in sample 4.
    expect(gridSampleIndexAt(signal, 0.39, header.recordDurationTicks).sampleIndex).toBe(3);
    expect(gridSampleIndexAt(signal, 0.4, header.recordDurationTicks).sampleIndex).toBe(4);
  });

  it('splits an index into its record and its offset within it', async () => {
    const { header, signal } = await fixture(1, 10);
    expect(gridSampleIndexAt(signal, 3.7, header.recordDurationTicks)).toEqual({
      sampleIndex: 37,
      recordIndex: 3,
      sampleWithinRecord: 7,
    });
  });

  it('floors toward negative infinity for a time before the start', async () => {
    // Truncating toward zero would collide -0.05 with sample 0, which is a different instant.
    const { header, signal } = await fixture(1, 10);
    expect(gridSampleIndexAt(signal, -0.05, header.recordDurationTicks)).toEqual({
      sampleIndex: -1,
      recordIndex: -1,
      sampleWithinRecord: 9,
    });
  });

  it('refuses a zero record duration instead of returning NaN', async () => {
    // sampleRateHz is undefined here, so the naive formula yields NaN silently. This is legal
    // EDF and a real sleep-staging file relies on it.
    const { header, signal } = await fixture(0, 10);
    expect(signal.sampleRateHz).toBeUndefined();
    expect(() => gridSampleIndexAt(signal, 5, header.recordDurationTicks)).toThrow(RangeError);
  });
});

describe('gridSampleStartTicks', () => {
  it('inverts gridSampleIndexAt on the sample boundaries', async () => {
    const { header, signal } = await fixture(0.3, 128);
    for (const index of [0, 1, 127, 128, 5000]) {
      const ticks = gridSampleStartTicks(signal, index, header.recordDurationTicks);
      const seconds = gridSampleStartSeconds(signal, index, header.recordDurationTicks);
      expect(gridSampleIndexAt(signal, seconds, header.recordDurationTicks).sampleIndex).toBe(
        index,
      );
      // The first whole tick at or after the exact start, which is what keeps the inverse exact
      // when a boundary lands on a half-tick (128 samples over 0.3 s puts sample 1 at 23,437.5).
      const exact = BigInt(index) * header.recordDurationTicks;
      expect(ticks).toBe(exact % 128n === 0n ? exact / 128n : exact / 128n + 1n);
    }
  });

  it('rejects a fractional sample index', async () => {
    const { header, signal } = await fixture(1, 10);
    expect(() => gridSampleStartTicks(signal, 1.5, header.recordDurationTicks)).toThrow(RangeError);
  });
});
