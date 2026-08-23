/**
 * `trimToWindow`, against the rule it states rather than the examples it was written from.
 *
 * The source says which samples belong in a window, in one line: "Sample j is in the window when
 * `ceil(j * D / S)` is in `[R, Rend)`" — D the record duration in ticks, S the samples per record,
 * R and Rend the window's bounds relative to the chunk's own start. What the code then does is a
 * closed form derived from that, two `floorDiv`s over bigint products, with the derivation written
 * above it. A closed form is exactly where an off-by-one lives, and the derivation is the part a
 * reader has to take on trust.
 *
 * So the rule is implemented here the obvious way — ask every sample — and the two are required to
 * select the same set for arbitrary geometries and arbitrary windows. The naive version is too
 * slow for a library and is obviously right, which is the only pairing worth testing a closed form
 * against.
 *
 * The rounding it turns on is not incidental. A sample boundary need not fall on a whole tick:
 * 256 samples in a one-second record — the commonest EEG geometry there is — puts sample 1 at
 * 39,062.5 ticks, published as 39,063. Selecting on the exact start rather than the published one
 * excluded that sample from a window beginning at its own published start, for half of all indices
 * at that rate; at 128 samples per 0.29 s a one-sample-wide window aligned to a sample start came
 * back EMPTY (fixed in 0.3.56). Geometries whose boundaries do not land on whole ticks are
 * generated deliberately, because the ones that do cannot tell the two rules apart.
 *
 * Three other properties come with it, each an obligation the docblock states and none of them
 * checked in general: adjacent windows partition a chunk exactly, a window covering the whole
 * chunk is the identity, and the result is a view rather than a copy — "trimming allocates
 * nothing and the two share memory".
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { secondsToTicks } from '../../src/tal/ticks.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfChunkSignal, EdfHeader } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x4e12;

interface Shape {
  readonly samplesPerRecord: number;
  readonly recordCount: number;
  readonly recordDurationSeconds: number;
}

const shape = fc.record({
  // 3, 7, 128 and 256 put sample boundaries off whole ticks against the durations below, which
  // is the case the published-start rounding exists for.
  samplesPerRecord: fc.constantFrom(1, 3, 4, 7, 8, 128, 256),
  recordCount: fc.integer({ min: 1, max: 8 }),
  recordDurationSeconds: fc.constantFrom(0.29, 0.5, 1, 2),
});

async function chunkOf(of: Shape): Promise<{ header: EdfHeader; signal: EdfChunkSignal }> {
  const recording = await openEdf(
    byteSource(
      buildEdf({
        recordCount: of.recordCount,
        recordDurationSeconds: of.recordDurationSeconds,
        signals: [{ label: 'Fp1', samplesPerRecord: of.samplesPerRecord }],
      }),
    ),
  );
  const chunk = await readRecords(recording, {
    records: { start: 0, count: of.recordCount },
    signalIndices: [0],
  });
  return { header: recording.header, signal: chunk.signals[0] as EdfChunkSignal };
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** The rule as written, asked of every sample. */
function selectedByTheRule(
  header: EdfHeader,
  signal: EdfChunkSignal,
  startSeconds: number,
  durationSeconds: number,
): readonly number[] {
  const duration = header.recordDurationTicks;
  const perRecord = BigInt(header.signals[signal.signalIndex]?.samplesPerRecord ?? 0);
  const relativeStart = secondsToTicks(startSeconds) - signal.startTicks;
  const relativeEnd = relativeStart + secondsToTicks(durationSeconds);
  const available = Math.min(signal.sampleCount, signal.digital.length);

  const chosen: number[] = [];
  for (let j = 0; j < available; j += 1) {
    const start = ceilDiv(BigInt(j) * duration, perRecord);
    if (start >= relativeStart && start < relativeEnd) chosen.push(j);
  }
  return chosen;
}

describe('the samples a window selects', () => {
  it('are the ones the rule names, for any geometry and any window', async () => {
    await fc.assert(
      fc.asyncProperty(
        shape,
        fc.double({ min: -1, max: 8, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 8, noNaN: true, noDefaultInfinity: true }),
        async (of, startSeconds, durationSeconds) => {
          const { header, signal } = await chunkOf(of);
          const wanted = selectedByTheRule(header, signal, startSeconds, durationSeconds);
          const got = trimToWindow(header, signal, startSeconds, durationSeconds);

          expect(got.sampleCount, `${startSeconds}+${durationSeconds}`).toBe(wanted.length);
          // The rule selects a contiguous run, so naming the first index pins the whole set.
          const first = wanted[0];
          if (first !== undefined) {
            expect([...got.digital]).toEqual(wanted.map((j) => signal.digital[j] as number));
          }
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
  });
});

describe('and the obligations that come with them', () => {
  it('partition a chunk exactly when the windows are adjacent', async () => {
    await fc.assert(
      fc.asyncProperty(
        shape,
        fc.double({ min: 0.05, max: 4, noNaN: true, noDefaultInfinity: true }),
        async (of, cut) => {
          const { header, signal } = await chunkOf(of);
          const span = of.recordCount * of.recordDurationSeconds;
          fc.pre(cut < span);
          const before = trimToWindow(header, signal, 0, cut);
          const after = trimToWindow(header, signal, cut, span - cut);
          const whole = trimToWindow(header, signal, 0, span);
          expect(before.sampleCount + after.sampleCount).toBe(whole.sampleCount);
          expect([...before.digital, ...after.digital]).toEqual([...whole.digital]);
        },
      ),
      { seed: SEED, numRuns: 120 },
    );
  });

  it('are every sample when the window covers the chunk', async () => {
    await fc.assert(
      fc.asyncProperty(shape, async (of) => {
        const { header, signal } = await chunkOf(of);
        const whole = trimToWindow(header, signal, 0, of.recordCount * of.recordDurationSeconds);
        expect(whole.sampleCount).toBe(signal.sampleCount);
        expect(whole.startTicks).toBe(signal.startTicks);
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('are a view into the chunk, not a copy of it', async () => {
    await fc.assert(
      fc.asyncProperty(
        shape,
        fc.double({ min: 0, max: 4, noNaN: true, noDefaultInfinity: true }),
        async (of, startSeconds) => {
          const { header, signal } = await chunkOf(of);
          const trimmed = trimToWindow(header, signal, startSeconds, 1);
          fc.pre(trimmed.sampleCount > 0);
          // Same backing store, so trimming a 64-channel window allocates nothing.
          expect(trimmed.digital.buffer).toBe(signal.digital.buffer);
        },
      ),
      { seed: SEED, numRuns: 80 },
    );
  });
});
