/**
 * The buckets partition the samples, and `counts` is what says which is which.
 *
 * `readEnvelope` reduces a window to a min and a max per bucket, and the whole value of it is that
 * nothing is lost: a spike between two sampled points is what subsampling misses and an envelope
 * does not. `envelope.test.ts` states that as "equals an exhaustive reduction of the same samples",
 * on one fixture at one bucket count. The general form — that the buckets are a PARTITION, in
 * order, covering every sample exactly once — is what makes the reduction exhaustive, and it was
 * never written down.
 *
 * It is checked here against `counts`, which is the field that says how many samples each bucket
 * reduced. Walking the window's samples in order and taking `counts[b]` at a time, every bucket's
 * `min` and `max` must be the exact minimum and maximum of the slice it took — at six bucket counts
 * from one to one-per-sample, and over arbitrary windows and counts with a constant seed.
 *
 * The last block is the case `readEnvelopeAtResolution` has and `readEnvelope` does not: asked for
 * a bucket width finer than the sample interval, it returns the grid its width implies and leaves
 * the columns with nothing in them empty rather than dropping them — 200 buckets over 32 samples,
 * 168 of them empty. In the digital domain an empty bucket reads `min: 0, max: 0`, which is a
 * perfectly ordinary reading, so `counts` is the only field that tells it from a channel that
 * really was flat at zero. That is asserted by building the flat channel and comparing.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x0e0e_0001;
const RECORDS = 12;
const PER_RECORD = 16;

const BYTES = buildEdf({
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [
    {
      label: 'Fp1',
      samplesPerRecord: PER_RECORD,
      sample: (record, index) => ((record * 7 + index * 3) % 97) - 48,
    },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function samplesOf(startRecord: number, count: number): Promise<readonly number[]> {
  const recording = await openEdf(byteSource(BYTES));
  const chunk = await readRecords(recording, {
    records: { start: startRecord, count },
    signalIndices: [0],
  });
  const series = chunk.signals[0];
  return [...(series?.digital.subarray(0, series.sampleCount) ?? [])];
}

/** Walks `counts` over the samples and reports every bucket that does not bound its own slice. */
function mismatches(
  samples: readonly number[],
  counts: readonly number[],
  min: readonly number[],
  max: readonly number[],
): readonly string[] {
  const wrong: string[] = [];
  let at = 0;
  for (const [bucket, size] of counts.entries()) {
    if (size === 0) continue;
    const slice = samples.slice(at, at + size);
    at += size;
    if (min[bucket] !== Math.min(...slice) || max[bucket] !== Math.max(...slice)) {
      wrong.push(`bucket ${bucket}: [${min[bucket]}, ${max[bucket]}] over ${slice.length} samples`);
    }
  }
  if (at !== samples.length) wrong.push(`counts covered ${at} of ${samples.length} samples`);
  return wrong;
}

describe('at every bucket count', () => {
  it.each([1, 3, 5, 8, 40, RECORDS * PER_RECORD])(
    'the %d buckets partition the window and bound their own samples',
    async (buckets) => {
      const recording = await openEdf(byteSource(BYTES));
      const [envelope] = await readEnvelope(recording, {
        startSeconds: 0,
        durationSeconds: RECORDS,
        buckets,
        signalIndices: [0],
      });
      const series = envelope?.signals[0];
      if (envelope === undefined || series === undefined) throw new Error('no envelope');

      const samples = await samplesOf(0, RECORDS);
      const counts = [...series.counts];
      expect(counts).toHaveLength(envelope.bucketCount);
      expect(counts.reduce((total, size) => total + size, 0)).toBe(samples.length);
      expect(mismatches(samples, counts, [...series.min], [...series.max])).toEqual([]);
    },
  );

  it('over arbitrary windows and counts', async () => {
    const recording = await openEdf(byteSource(BYTES));
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: RECORDS - 1 }),
        fc.integer({ min: 1, max: RECORDS }),
        fc.integer({ min: 1, max: 64 }),
        async (startRecord, span, buckets) => {
          const count = Math.min(span, RECORDS - startRecord);
          const [envelope] = await readEnvelope(recording, {
            startSeconds: startRecord,
            durationSeconds: count,
            buckets,
            signalIndices: [0],
          });
          const series = envelope?.signals[0];
          if (envelope === undefined || series === undefined) return;

          const samples = await samplesOf(startRecord, count);
          const counts = [...series.counts];
          expect(counts.reduce((total, size) => total + size, 0)).toBe(samples.length);
          expect(mismatches(samples, counts, [...series.min], [...series.max])).toEqual([]);
        },
      ),
      { seed: SEED, numRuns: 80 },
    );
  });
});

describe('a bucket width finer than the sample interval', () => {
  it('leaves the columns with nothing in them empty rather than dropping them', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const [envelope] = await readEnvelopeAtResolution(recording, {
      startSeconds: 0,
      durationSeconds: 2,
      secondsPerBucket: 0.01,
      signalIndices: [0],
    });
    const series = envelope?.signals[0];
    if (envelope === undefined || series === undefined) throw new Error('no envelope');

    const counts = [...series.counts];
    expect(envelope.bucketCount).toBe(200);
    expect(counts.reduce((total, size) => total + size, 0)).toBe(2 * PER_RECORD);
    expect(counts.filter((size) => size === 0).length).toBeGreaterThan(150);
    // And the buckets that did take samples still bound them exactly.
    expect(mismatches(await samplesOf(0, 2), counts, [...series.min], [...series.max])).toEqual([]);
  });

  it('and counts is the only field that tells an empty bucket from a flat one', async () => {
    const flat = buildEdf({
      plus: 'C',
      recordCount: RECORDS,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: PER_RECORD, sample: () => 0 }],
      annotationSignals: [{ samplesPerRecord: 40 }],
    });

    const sparse = await openEdf(byteSource(BYTES));
    const [thin] = await readEnvelopeAtResolution(sparse, {
      startSeconds: 0,
      durationSeconds: 2,
      secondsPerBucket: 0.01,
      signalIndices: [0],
    });
    const empty = [...(thin?.signals[0]?.counts ?? [])].findIndex((size) => size === 0);
    expect(empty).toBeGreaterThan(-1);

    const zeroed = await openEdf(byteSource(flat));
    const [flatEnvelope] = await readEnvelope(zeroed, {
      startSeconds: 0,
      durationSeconds: 2,
      buckets: 4,
      signalIndices: [0],
    });

    // The empty bucket and the flat one read the same in the digital domain.
    expect(thin?.signals[0]?.min[empty]).toBe(0);
    expect(thin?.signals[0]?.max[empty]).toBe(0);
    expect(flatEnvelope?.signals[0]?.min[0]).toBe(0);
    expect(flatEnvelope?.signals[0]?.max[0]).toBe(0);

    // And are told apart by `counts`, which is what it is for.
    expect(thin?.signals[0]?.counts[empty]).toBe(0);
    expect(flatEnvelope?.signals[0]?.counts[0]).toBeGreaterThan(0);
  });
});
