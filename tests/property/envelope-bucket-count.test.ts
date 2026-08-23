/**
 * `bucketCount` is the field to read before indexing, over arbitrary windows rather than one.
 *
 * `api-helpers.md` says it in as many words, and says why it needs saying: "it is not always the
 * `buckets` you asked for." A caller who sizes a canvas to 800 pixels, asks for 800 buckets and
 * then loops `for (let b = 0; b < 800; b += 1)` reads past the end of `counts` on any run shorter
 * than 800 samples — which is every run near the end of a recording, and every run between two
 * gaps.
 *
 * The two calls answer differently and both answers are deliberate. `readEnvelope` clamps to the
 * densest signal's sample count, because a grid with more buckets than samples has empty columns
 * that mean nothing. `readEnvelopeAtResolution` does not clamp, because its contract is the WIDTH
 * of a bucket: shortening the count would shorten the grid rather than coarsen it, and a time axis
 * asked for 30 s per bucket has to keep getting 30 s per bucket. The page's own example is a
 * 4-second run of a 2 Hz signal at 0.25 s per bucket — 16 buckets, 8 of them filled.
 *
 * `envelope-buckets.test.ts` works that example through. What it cannot say is that the two rules
 * hold for every window, and the rules are exactly the kind that hold for the case someone checked:
 * a run long enough for the clamp never to bite, and a resolution that divides the span exactly.
 *
 * The invariant underneath both is the one a caller actually indexes on: every signal's `counts`,
 * `min` and `max` are `bucketCount` long. Whatever the count turns out to be, the arrays agree
 * with it — otherwise the field to read before indexing is not the field to read before indexing.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfEnvelopeChunk, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x8c14;

interface Shape {
  readonly samplesPerRecord: number;
  readonly recordCount: number;
  readonly recordDurationSeconds: number;
}

const shape = fc.record({
  samplesPerRecord: fc.constantFrom(1, 2, 4, 16, 64),
  recordCount: fc.integer({ min: 1, max: 12 }),
  recordDurationSeconds: fc.constantFrom(0.25, 0.5, 1, 2),
});

const open = (of: Shape): Promise<EdfRecording> =>
  openEdf(
    byteSource(
      buildEdf({
        recordCount: of.recordCount,
        recordDurationSeconds: of.recordDurationSeconds,
        signals: [{ label: 'Fp1', samplesPerRecord: of.samplesPerRecord }],
      }),
    ),
  );

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

describe('every envelope chunk', () => {
  it('has arrays exactly as long as the bucketCount it publishes', async () => {
    await fc.assert(
      fc.asyncProperty(shape, fc.integer({ min: 1, max: 400 }), async (of, buckets) => {
        const recording = await open(of);
        const span = of.recordCount * of.recordDurationSeconds;
        const chunks = await readEnvelope(recording, {
          signalIndices: [0],
          startSeconds: 0,
          durationSeconds: span,
          buckets,
        });
        for (const chunk of chunks) {
          for (const signal of chunk.signals) {
            // The field to read before indexing, and the arrays that have to agree with it.
            expect(signal.counts).toHaveLength(chunk.bucketCount);
            expect(signal.min).toHaveLength(chunk.bucketCount);
            expect(signal.max).toHaveLength(chunk.bucketCount);
          }
        }
      }),
      { seed: SEED, numRuns: 120 },
    );
  });
});

describe('readEnvelope, which clamps', () => {
  it('never returns more buckets than the caller asked for', async () => {
    await fc.assert(
      fc.asyncProperty(shape, fc.integer({ min: 1, max: 400 }), async (of, buckets) => {
        const recording = await open(of);
        const span = of.recordCount * of.recordDurationSeconds;
        const chunks = await readEnvelope(recording, {
          signalIndices: [0],
          startSeconds: 0,
          durationSeconds: span,
          buckets,
        });
        for (const chunk of chunks) expect(chunk.bucketCount).toBeLessThanOrEqual(buckets);
      }),
      { seed: SEED, numRuns: 120 },
    );
  });

  it('never returns more buckets than the densest signal has samples', async () => {
    // The clamp itself: a grid with more buckets than samples has columns that mean nothing.
    await fc.assert(
      fc.asyncProperty(shape, fc.integer({ min: 1, max: 400 }), async (of, buckets) => {
        const recording = await open(of);
        const span = of.recordCount * of.recordDurationSeconds;
        const chunks = await readEnvelope(recording, {
          signalIndices: [0],
          startSeconds: 0,
          durationSeconds: span,
          buckets,
        });
        for (const chunk of chunks) {
          const densest = Math.max(...chunk.signals.map((signal) => signal.sampleCount));
          expect(chunk.bucketCount).toBeLessThanOrEqual(Math.max(1, densest));
        }
      }),
      { seed: SEED, numRuns: 120 },
    );
  });
});

describe('readEnvelopeAtResolution, which does not', () => {
  it('returns the grid its bucket width implies, however few samples fall in it', async () => {
    await fc.assert(
      fc.asyncProperty(
        shape,
        fc.constantFrom(0.05, 0.1, 0.25, 0.5, 1, 3),
        async (of, secondsPerBucket) => {
          const recording = await open(of);
          const span = of.recordCount * of.recordDurationSeconds;
          const chunks = await readEnvelopeAtResolution(recording, {
            signalIndices: [0],
            startSeconds: 0,
            durationSeconds: span,
            secondsPerBucket,
          });
          const bucketTicks = BigInt(Math.round(secondsPerBucket * 1e7));
          for (const chunk of chunks as readonly EdfEnvelopeChunk[]) {
            // `ceil(runTicks / bucketTicks)`, verbatim from the page.
            expect(BigInt(chunk.bucketCount)).toBe(ceilDiv(chunk.durationTicks, bucketTicks));
          }
        },
      ),
      { seed: SEED, numRuns: 120 },
    );
  });

  it('accounts for every sample, and leaves a column empty rather than dropping it', async () => {
    // The page's example generalised. Whether the grid outruns the samples depends on the
    // geometry — 64 samples in 0.25 s is denser than 0.01 s buckets — so the empty-column claim is
    // made only where the grid really is finer, and the accounting claim is made everywhere.
    await fc.assert(
      fc.asyncProperty(shape, async (of) => {
        const recording = await open(of);
        const span = of.recordCount * of.recordDurationSeconds;
        const chunks = await readEnvelopeAtResolution(recording, {
          signalIndices: [0],
          startSeconds: 0,
          durationSeconds: span,
          // Finer than any geometry above, so the grid outruns the samples.
          secondsPerBucket: 0.01,
        });
        for (const chunk of chunks) {
          for (const signal of chunk.signals) {
            const total = [...signal.counts].reduce((sum, one) => sum + one, 0);
            expect(total).toBe(signal.sampleCount);
            if (chunk.bucketCount > signal.sampleCount) {
              // More columns than samples: the extra ones are reported as empty, which is what
              // makes the bucket WIDTH honest instead of the grid being quietly shortened.
              expect([...signal.counts].filter((one) => one === 0).length).toBeGreaterThan(0);
            }
          }
        }
      }),
      { seed: SEED, numRuns: 80 },
    );
  });
});
