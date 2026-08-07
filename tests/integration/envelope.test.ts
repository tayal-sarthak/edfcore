/**
 * Min/max envelope decimation.
 *
 * The property that matters is not "it returns numbers" but "it returns the SAME numbers an
 * exhaustive reduction would". Every test here builds the expectation independently — by
 * decoding the window in full and reducing it by hand — rather than comparing edfcore's output
 * to edfcore's output.
 */

import { describe, expect, it } from 'vitest';
import {
  envelopeOfSamples,
  readEnvelope,
  readEnvelopeAtResolution,
  toPhysicalEnvelope,
} from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfChunkSignal, EdfRecording } from '../../src/types.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const RECORDS = 40;
const SAMPLES_PER_RECORD = 25;
const SECONDS = RECORDS;

async function recording(): Promise<EdfRecording> {
  return openEdf(
    byteSource(
      minimalEdfPlus({
        recordCount: RECORDS,
        recordDurationSeconds: 1,
        signals: [
          {
            label: 'EEG Fpz-Cz',
            samplesPerRecord: SAMPLES_PER_RECORD,
            physicalMinimum: -500,
            physicalMaximum: 500,
            digitalMinimum: -32768,
            digitalMaximum: 32767,
            // A deterministic saw with occasional spikes: subsampling misses the spikes, an
            // envelope cannot.
            sample: (i: number) => (i % 97 === 0 ? 30000 : ((i * 137) % 2001) - 1000),
          },
        ],
      }),
    ),
  );
}

/** The reduction, done exhaustively, with no reference to the implementation under test. */
function reduceByHand(
  samples: ArrayLike<number>,
  buckets: number,
): { min: number[]; max: number[]; counts: number[] } {
  const total = samples.length;
  const min = new Array<number>(buckets).fill(Number.POSITIVE_INFINITY);
  const max = new Array<number>(buckets).fill(Number.NEGATIVE_INFINITY);
  const counts = new Array<number>(buckets).fill(0);
  for (let i = 0; i < total; i += 1) {
    const bucket = Math.min(buckets - 1, Math.floor((i * buckets) / total));
    const value = samples[i] as number;
    min[bucket] = Math.min(min[bucket] as number, value);
    max[bucket] = Math.max(max[bucket] as number, value);
    counts[bucket] = (counts[bucket] as number) + 1;
  }
  return { min, max, counts };
}

describe('readEnvelope reduces a window without losing its extremes', () => {
  it('equals an exhaustive reduction of the same samples', async () => {
    const edf = await recording();
    const buckets = 97;

    const [chunk] = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
    });
    const samples = chunk?.signals[0]?.digital;
    if (samples === undefined) throw new Error('the fixture produced no samples');

    const [envelope] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
      buckets,
    });
    const actual = envelope?.signals[0];
    if (actual === undefined) throw new Error('the envelope produced no signal');

    const expected = reduceByHand(samples, envelope?.bucketCount ?? buckets);
    expect([...actual.min]).toEqual(expected.min);
    expect([...actual.max]).toEqual(expected.max);
    expect([...actual.counts]).toEqual(expected.counts);
    expect(actual.sampleCount).toBe(samples.length);
  });

  it('keeps the isolated spikes that subsampling would miss', async () => {
    // The whole reason min/max beats "every Nth sample": the spike is one sample in 97.
    const edf = await recording();
    const [envelope] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
      buckets: 50,
    });
    const signal = envelope?.signals[0];
    if (signal === undefined) throw new Error('the envelope produced no signal');
    expect(Math.max(...signal.max)).toBe(30000);
  });

  it('gives the same answer whatever the read chunk size', async () => {
    // Chunking bounds memory. It must not move a sample from one bucket to another, which is why
    // the bucket is computed on the run's grid rather than the chunk's.
    const edf = await recording();
    const selection = {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
      buckets: 64,
    };
    const [wide] = await readEnvelope(edf, selection);
    const [narrow] = await readEnvelope(edf, selection, { maxMaterializeBytes: 4096 });

    expect([...(narrow?.signals[0]?.min ?? [])]).toEqual([...(wide?.signals[0]?.min ?? [])]);
    expect([...(narrow?.signals[0]?.max ?? [])]).toEqual([...(wide?.signals[0]?.max ?? [])]);
  });

  it('clamps buckets to the samples actually available', async () => {
    const edf = await recording();
    const [envelope] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 1,
      buckets: 100_000,
    });
    expect(envelope?.bucketCount).toBe(SAMPLES_PER_RECORD);
  });

  it('rejects a bad bucket count and a bad selection', async () => {
    const edf = await recording();
    const base = { signalIndices: [0], startSeconds: 0, durationSeconds: SECONDS };
    await expect(readEnvelope(edf, { ...base, buckets: 0 })).rejects.toThrow(RangeError);
    await expect(readEnvelope(edf, { ...base, buckets: 1.5 })).rejects.toThrow(RangeError);
    await expect(readEnvelope(edf, { ...base, signalIndices: [99], buckets: 10 })).rejects.toThrow(
      RangeError,
    );
    await expect(
      readEnvelope(edf, {
        ...base,
        signalIndices: edf.header.annotationSignalIndices,
        buckets: 10,
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('toPhysicalEnvelope', () => {
  it('never returns a min above its max', async () => {
    const edf = await recording();
    const [envelope] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
      buckets: 32,
    });
    const signal = edf.header.signals[0];
    const envelopeSignal = envelope?.signals[0];
    if (signal === undefined || envelopeSignal === undefined) throw new Error('missing fixture');

    const physical = toPhysicalEnvelope(signal, envelopeSignal);
    for (let i = 0; i < physical.min.length; i += 1) {
      expect(physical.min[i] as number).toBeLessThanOrEqual(physical.max[i] as number);
    }
  });

  it('swaps the bounds when the gain is negative', async () => {
    // bitValue < 0 makes the affine transform decreasing, so the smallest digital value maps to
    // the LARGEST physical one. Mapping min to min would draw the envelope inside out.
    const edf = await openEdf(
      byteSource(
        minimalEdfPlus({
          recordCount: 2,
          recordDurationSeconds: 1,
          signals: [
            {
              label: 'EEG Fpz-Cz',
              samplesPerRecord: 8,
              // Inverted physical range: physicalMinimum > physicalMaximum gives a negative gain.
              physicalMinimum: 500,
              physicalMaximum: -500,
              digitalMinimum: -32768,
              digitalMaximum: 32767,
              sample: (i: number) => (i % 2 === 0 ? -1000 : 1000),
            },
          ],
        }),
      ),
    );
    const signal = edf.header.signals[0];
    if (signal?.scale === undefined) throw new Error('the fixture has no usable scale');
    expect(signal.scale.bitValue).toBeLessThan(0);

    const [envelope] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
      buckets: 4,
    });
    const envelopeSignal = envelope?.signals[0];
    if (envelopeSignal === undefined) throw new Error('the envelope produced no signal');

    const physical = toPhysicalEnvelope(signal, envelopeSignal);
    for (let i = 0; i < physical.min.length; i += 1) {
      expect(physical.min[i] as number).toBeLessThanOrEqual(physical.max[i] as number);
    }
  });
});

describe('envelopeOfSamples', () => {
  it('agrees with readEnvelope over the same samples', async () => {
    const edf = await recording();
    const buckets = 41;
    const [chunk] = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
    });
    const [envelope] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
      buckets,
    });
    const chunkSignal = chunk?.signals[0];
    const fromRead = envelope?.signals[0];
    if (chunkSignal === undefined || fromRead === undefined) throw new Error('missing fixture');

    const inHand = envelopeOfSamples(chunkSignal, buckets);
    expect([...inHand.min]).toEqual([...fromRead.min]);
    expect([...inHand.max]).toEqual([...fromRead.max]);
  });
});

describe('envelope chunks report gaps the way readWindow chunks do', () => {
  it('carries precededByGap once the index knows where the gaps are', async () => {
    // An envelope promises to mirror readWindow. At one bucket per pixel a gap is invisible in
    // the data itself, so a viewer needs this more here than it does for raw samples.
    const edf = await openEdf(
      byteSource(
        minimalEdfPlus({
          plus: 'D',
          recordCount: 6,
          recordDurationSeconds: 1,
          // A two-second hole after record 2.
          recordOnsetSeconds: (record: number) => (record < 3 ? record : record + 2),
          signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 4 }],
        }),
      ),
    );

    const located = { ...edf, index: await buildRecordIndex(edf) };
    expect(located.index.gaps?.length).toBe(1);

    const chunks = await readEnvelope(located, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 100,
      buckets: 8,
    });
    const windows = await readWindow(located, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 100,
    });

    expect(chunks).toHaveLength(windows.length);
    expect(chunks.map((c) => c.precededByGap?.durationSeconds)).toEqual(
      windows.map((c) => c.precededByGap?.durationSeconds),
    );
    expect(chunks[1]?.precededByGap).toBeDefined();
  });
});

describe('toPhysicalEnvelope reuses a caller buffer', () => {
  it('writes into out and allocates nothing', async () => {
    const edf = await recording();
    const [envelope] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
      buckets: 16,
    });
    const signal = edf.header.signals[0];
    const envelopeSignal = envelope?.signals[0];
    if (signal === undefined || envelopeSignal === undefined) throw new Error('missing fixture');

    const fresh = toPhysicalEnvelope(signal, envelopeSignal);
    const out = { min: new Float64Array(16), max: new Float64Array(16) };
    const reused = toPhysicalEnvelope(signal, envelopeSignal, out);

    expect([...reused.min]).toEqual([...fresh.min]);
    expect([...reused.max]).toEqual([...fresh.max]);
    // Same memory, not a copy: that is the whole point of passing it.
    expect(reused.min.buffer).toBe(out.min.buffer);
  });

  it('narrows a longer out rather than reporting the wrong length', async () => {
    const edf = await recording();
    const [envelope] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
      buckets: 16,
    });
    const signal = edf.header.signals[0];
    const envelopeSignal = envelope?.signals[0];
    if (signal === undefined || envelopeSignal === undefined) throw new Error('missing fixture');

    const roomy = { min: new Float64Array(64), max: new Float64Array(64) };
    expect(toPhysicalEnvelope(signal, envelopeSignal, roomy).min).toHaveLength(16);
  });

  it('refuses an out that is too short instead of writing fewer values than will be read', async () => {
    const edf = await recording();
    const [envelope] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
      buckets: 16,
    });
    const signal = edf.header.signals[0];
    const envelopeSignal = envelope?.signals[0];
    if (signal === undefined || envelopeSignal === undefined) throw new Error('missing fixture');

    const small = { min: new Float64Array(4), max: new Float64Array(4) };
    expect(() => toPhysicalEnvelope(signal, envelopeSignal, small)).toThrow(RangeError);
  });
});

describe('readEnvelopeAtResolution', () => {
  it('ceils rather than rounds, so the tail of the window is never dropped', async () => {
    // 40 s at 30 s per bucket needs two buckets. Rounding down to one would silently lose 10 s
    // off the end of the picture.
    const edf = await recording();
    const [chunk] = await readEnvelopeAtResolution(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 40,
      secondsPerBucket: 30,
    });
    expect(chunk?.bucketCount).toBe(2);
  });

  it('agrees with readEnvelope given the equivalent bucket count', async () => {
    const edf = await recording();
    const [byResolution] = await readEnvelopeAtResolution(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
      secondsPerBucket: 4,
    });
    const [byCount] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
      buckets: Math.ceil(SECONDS / 4),
    });
    expect([...(byResolution?.signals[0]?.min ?? [])]).toEqual([
      ...(byCount?.signals[0]?.min ?? []),
    ]);
  });

  it('rejects a non-positive resolution', async () => {
    const edf = await recording();
    const base = { signalIndices: [0], startSeconds: 0, durationSeconds: SECONDS };
    await expect(readEnvelopeAtResolution(edf, { ...base, secondsPerBucket: 0 })).rejects.toThrow(
      RangeError,
    );
    await expect(
      readEnvelopeAtResolution(edf, { ...base, secondsPerBucket: Number.NaN }),
    ).rejects.toThrow(RangeError);
  });
});

describe('envelopeOfSamples treats sampleCount as authoritative', () => {
  it('ignores a padded tail on a caller-built chunk signal', async () => {
    // No edfcore read path produces this: `decodeDigital` narrows an oversized reused buffer with
    // `subarray` before it escapes, and every internal producer sets `sampleCount` from
    // `digital.length`. But a caller can build an `EdfChunkSignal`, and `mergeChunks` and
    // `trimToWindow` already bound themselves by `sampleCount` — so this one does too, rather than
    // leaving two helpers defending and one not.
    const padded = new Int32Array(8);
    padded.set([10, -10, 20, -20], 0);
    padded.fill(30000, 4); // The tail: never part of the signal.

    const signal: EdfChunkSignal = {
      signalIndex: 0,
      sampleCount: 4,
      digital: padded,
      firstSampleIndex: 0,
      startSeconds: 0,
      outOfDigitalRangeCount: 0,
    };

    const envelope = envelopeOfSamples(signal, 2);
    expect(envelope.sampleCount).toBe(4);
    expect(Array.from(envelope.counts)).toEqual([2, 2]);
    // 30000 appears nowhere: the tail was not folded in.
    expect(Array.from(envelope.max)).toEqual([10, 20]);
    expect(Array.from(envelope.min)).toEqual([-10, -20]);
  });

  it('is unchanged for every chunk edfcore itself produces', async () => {
    // The equal-length case is the only one a read can produce, and it must be untouched.
    const edf = await recording();
    const [chunk] = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SECONDS,
    });
    const signal = chunk?.signals[0];
    if (signal === undefined) throw new Error('setup failed');
    expect(signal.sampleCount).toBe(signal.digital.length);

    const envelope = envelopeOfSamples(signal, 37);
    expect(envelope.sampleCount).toBe(signal.sampleCount);
    expect(Array.from(envelope.counts).reduce((a, b) => a + b, 0)).toBe(signal.sampleCount);
  });
});

describe('readEnvelopeAtResolution delivers the resolution it was asked for', () => {
  // A chunk covers one record-aligned contiguous RUN, and a run is not the window. Before 0.2.31
  // one bucket count was computed from the window and handed to every chunk, so a single call
  // returned chunks at 0.27 s and 0.09 s per bucket when asked for 1 s — widths that are not
  // commensurable, so the two cannot go on one axis, which is the entire promise of this function.
  const actualResolution = (chunk: { durationSeconds: number; bucketCount: number }) =>
    chunk.durationSeconds / chunk.bucketCount;

  it('gives every chunk of an EDF+D window the same bucket width', async () => {
    const bytes = buildEdf({
      plus: 'D',
      recordCount: 4,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (r: number) => (r < 3 ? r : r + 7),
      signals: [{ label: 'Fp1', samplesPerRecord: 40 }],
      annotationSignals: [{ samplesPerRecord: 60 }],
    });
    const opened = await openEdf(byteSource(bytes));
    const edf = { ...opened, index: await buildRecordIndex(opened) };

    const chunks = await readEnvelopeAtResolution(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 11,
      secondsPerBucket: 1,
    });

    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) expect(actualResolution(chunk)).toBe(1);
    // Each run gets the buckets its own span needs: 3 s and 1 s.
    expect(chunks.map((c) => c.bucketCount)).toEqual([3, 1]);
  });

  it('honours it for a window that does not start on a record boundary', async () => {
    // The record-aligned run is 4 s wide while the window asked for 3 s, so a window-derived
    // count gave 1.33 s per bucket on an ordinary contiguous file.
    const edf = await recording();
    const [chunk] = await readEnvelopeAtResolution(edf, {
      signalIndices: [0],
      startSeconds: 0.5,
      durationSeconds: 3,
      secondsPerBucket: 1,
    });
    if (chunk === undefined) throw new Error('setup failed');
    expect(actualResolution(chunk)).toBe(1);
  });

  it('does not add a bucket to a run whose length is not a binary fraction', async () => {
    // The second route to the same failure, and the one no chunking or window offset is involved
    // in. 3 x 0.1 s is 0.30000000000000004 in float64, so `Math.ceil(runSeconds / 0.1)` was FOUR
    // over a 0.3 s run. The extra bucket is not empty — the samples are spread over whatever
    // count is asked for — so every bucket came out 0.075 s wide against a request for 0.1 s.
    // The record count is an integer and the record duration is exact in ticks, so the product is
    // computed there (fixed in 0.3.5).
    const bytes = buildEdf({
      recordCount: 3,
      recordDurationSeconds: 0.1,
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
    });
    const edf = await openEdf(byteSource(bytes));
    const [chunk] = await readEnvelopeAtResolution(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 0.3,
      secondsPerBucket: 0.1,
    });
    if (chunk === undefined) throw new Error('setup failed');
    expect(chunk.bucketCount).toBe(3);
    expect(actualResolution(chunk)).toBeCloseTo(0.1, 12);
    // The premise: the float product really does overshoot, so this test is testing something.
    expect(3 * 0.1).toBeGreaterThan(0.3);
  });

  it('still ceils, so the tail of a window is never dropped', async () => {
    // The 0.2.5 rule, unchanged: 40 s at 30 s per bucket is two buckets, not one.
    const edf = await recording();
    const [chunk] = await readEnvelopeAtResolution(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 40,
      secondsPerBucket: 30,
    });
    expect(chunk?.bucketCount).toBe(2);
  });
});
