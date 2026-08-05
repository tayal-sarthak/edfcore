/**
 * Min/max envelope decimation.
 *
 * The property that matters is not "it returns numbers" but "it returns the SAME numbers an
 * exhaustive reduction would". Every test here builds the expectation independently — by
 * decoding the window in full and reducing it by hand — rather than comparing edfcore's output
 * to edfcore's output.
 */

import { describe, expect, it } from 'vitest';
import { envelopeOfSamples, readEnvelope, toPhysicalEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

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
