/**
 * Min/max envelope decimation.
 *
 * The property that matters is not "it returns numbers" but "it returns the SAME numbers an
 * exhaustive reduction would". Every test here builds the expectation independently — by
 * decoding the window in full and reducing it by hand — rather than comparing edfcore's output
 * to edfcore's output.
 */

import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import {
  envelopeOfSamples,
  readEnvelope,
  readEnvelopeAtResolution,
  toPhysicalEnvelope,
} from '../../src/envelope.js';
import { EdfChannelNotFoundError, type EdfScalingError, isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfChunkSignal, EdfRecording } from '../../src/types.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

/** The thrown error, or `undefined` when the call unexpectedly succeeded. */
function catchError(call: () => unknown): EdfScalingError | undefined {
  try {
    call();
    return undefined;
  } catch (error) {
    return error as EdfScalingError;
  }
}

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
    // `EdfChannelNotFoundError` since 0.3.35, matching what `readWindow` throws for the same
    // mistake. It was a bare `RangeError` here, so `isEdfError` answered differently depending on
    // which read the caller reached for.
    await expect(readEnvelope(edf, { ...base, signalIndices: [99], buckets: 10 })).rejects.toThrow(
      EdfChannelNotFoundError,
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

describe('the envelope refusals match the read path', () => {
  /**
   * `assertPositiveInteger` and `resolveEnvelopeSignals` are shared by `readEnvelope`,
   * `readEnvelopeAtResolution` and `envelopeOfSamples`, and all three hard-coded `readEnvelope():`
   * into their messages — so two of the three named the wrong function. `resolveSignals` on the
   * read path deliberately carries no prefix for exactly this reason.
   *
   * The sharper half: an index outside the file's signals threw `EdfChannelNotFoundError` from
   * `readWindow` and a bare `RangeError` from here, so `isEdfError` answered differently for the
   * identical mistake depending on which read the caller reached for (fixed in 0.3.35).
   */
  async function recording() {
    return openEdf(byteSource(minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 })));
  }

  it('throws the same typed error the read path throws for a bad signalIndex', async () => {
    const edf = await recording();
    const selection = { signalIndices: [99], startSeconds: 0, durationSeconds: 2 };

    const fromRead = await readWindow(edf, selection).catch((e: unknown) => e);
    const fromEnvelope = await readEnvelope(edf, { ...selection, buckets: 4 }).catch(
      (e: unknown) => e,
    );
    const fromResolution = await readEnvelopeAtResolution(edf, {
      ...selection,
      secondsPerBucket: 1,
    }).catch((e: unknown) => e);

    for (const error of [fromRead, fromEnvelope, fromResolution]) {
      expect(isEdfError(error)).toBe(true);
      expect((error as EdfChannelNotFoundError).edfErrorKind).toBe('channel');
      expect((error as EdfChannelNotFoundError).selector).toBe(99);
      expect((error as EdfChannelNotFoundError).availableLabels).toHaveLength(2);
    }
  });

  it('does not name readEnvelope when the caller called something else', async () => {
    const edf = await recording();
    const error = await readEnvelopeAtResolution(edf, {
      signalIndices: [99],
      startSeconds: 0,
      durationSeconds: 2,
      secondsPerBucket: 1,
    }).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('readEnvelope()');

    // `envelopeOfSamples` shares the bucket check.
    const bucketError = (() => {
      try {
        envelopeOfSamples(
          {
            signalIndex: 0,
            sampleCount: 1,
            digital: Int32Array.of(1),
            firstSampleIndex: 0,
            startSeconds: 0,
            startTicks: 0n,
            outOfDigitalRangeCount: 0,
          },
          0,
        );
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(bucketError?.message).toContain('buckets must be a positive whole number');
    expect(bucketError?.message).not.toContain('readEnvelope()');
  });

  it('still refuses the annotations channel as a plain RangeError, as the read path does', async () => {
    // Handing the annotations channel to a sample read can only ever be a caller's mistake, and
    // `resolveSignals` uses a plain RangeError for it too. That split is deliberate.
    const edf = await recording();
    const error = await readEnvelope(edf, {
      signalIndices: [1],
      startSeconds: 0,
      durationSeconds: 2,
      buckets: 4,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RangeError);
    expect(isEdfError(error)).toBe(false);
    expect((error as Error).message).toContain('annotations channel');
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

  it('gives an empty bucket NaN rather than a plausible reading', async () => {
    // `min` and `max` are Int32Arrays and cannot hold a sentinel outside the sample range, so an
    // empty bucket carries a digital 0 and `counts` is what distinguishes it. In digital units a
    // stray 0 looks like nothing. Through the affine transform it stops looking like nothing:
    // `bitValue * (offset + 0)` is mid-scale for any channel whose declared range is not centred
    // on zero, so a viewer that plots min/max without consulting `counts` drew a flat trace at a
    // completely believable value across a hole (fixed in 0.3.10).
    const edf = await openEdf(
      byteSource(
        minimalEdfPlus({
          recordCount: 2,
          recordDurationSeconds: 1,
          signals: [
            {
              label: 'SpO2',
              samplesPerRecord: 4,
              physicalDimension: '%',
              physicalMinimum: 0,
              physicalMaximum: 1000,
              digitalMinimum: -32768,
              digitalMaximum: 32767,
            },
          ],
        }),
      ),
    );
    const signal = edf.header.signals[0];
    if (signal === undefined) throw new Error('missing fixture');

    const [envelope] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
      buckets: 4,
    });
    const populated = envelope?.signals[0];
    if (populated === undefined) throw new Error('the envelope produced no signal');

    // Bucket 2, emptied: counts 0 and the digital sentinel the accumulator leaves behind.
    const withHole = {
      ...populated,
      counts: Int32Array.from(populated.counts, (c, i) => (i === 2 ? 0 : c)),
      min: Int32Array.from(populated.min, (v, i) => (i === 2 ? 0 : v)),
      max: Int32Array.from(populated.max, (v, i) => (i === 2 ? 0 : v)),
    };

    const physical = toPhysicalEnvelope(signal, withHole);
    expect(physical.min[2]).toBeNaN();
    expect(physical.max[2]).toBeNaN();
    // The value it used to produce, and why it was dangerous: dead centre of a 0..1000 channel.
    const scale = signal.scale;
    if (scale === undefined) throw new Error('the fixture has no usable scale');
    expect(scale.bitValue * scale.offset).toBeCloseTo(500, 1);
    // Every populated bucket is untouched.
    for (let i = 0; i < physical.min.length; i += 1) {
      if (i === 2) continue;
      expect(physical.min[i]).not.toBeNaN();
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
      startTicks: 0n,
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

  it('gives two runs of different length the SAME bucket width, not the same bucket count', async () => {
    // The promise, tested where it actually breaks. Buckets were an even division of each run, so
    // the width followed the run: a 100 s run at 30 s per bucket got 4 buckets of 25 s while a
    // 60 s run in the same call got 2 of 30 s. Two chunks of one call at incommensurable
    // resolutions — which is the failure 0.2.31 fixed for a different cause, reachable again
    // whenever a run's span is not a whole multiple of the requested width (fixed in 0.3.9).
    const bytes = buildEdf({
      plus: 'D',
      recordCount: 160,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      annotationSignals: [{ samplesPerRecord: 40 }],
      // Records 0-99 are 100 s; records 100-159 are 60 s, after a long gap.
      recordOnsetSeconds: (i: number) => (i < 100 ? i : i + 500),
    });
    const opened = await openEdf(byteSource(bytes));
    const edf = { ...opened, index: await buildRecordIndex(opened) };

    const chunks = await readEnvelopeAtResolution(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 1000,
      secondsPerBucket: 30,
    });

    expect(chunks.map((c) => c.durationSeconds)).toEqual([100, 60]);
    // The bucket COUNTS differ, because the runs differ. The widths must not.
    expect(chunks.map((c) => c.bucketCount)).toEqual([4, 2]);
    for (const chunk of chunks) expect(chunk.secondsPerBucket).toBe(30);

    // And the samples really are laid out at that width: 30 s of a 10 Hz signal is 300 samples,
    // with the last bucket of the 100 s run short by exactly the 10 s the division left over.
    expect(Array.from(chunks[0]?.signals[0]?.counts ?? [])).toEqual([300, 300, 300, 100]);
    expect(Array.from(chunks[1]?.signals[0]?.counts ?? [])).toEqual([300, 300]);
  });

  it('puts a sample in the same bucket however the read was chunked', async () => {
    // Chunking bounds memory and must never move a sample between buckets. The time-based rule
    // carries a cursor across chunk boundaries, so this is the assertion that the cursor is right.
    //
    // The file is deliberately larger than one scan block (4 MiB), which is the only way to get
    // more than one chunk: `scanChunkRecords` sizes a chunk from that block, not from an option.
    // 700 records of 8000 bytes is 5.6 MB, so the fold runs in two chunks and the boundary at
    // record 524 falls INSIDE bucket 17 rather than on its edge.
    const RECORDS = 700;
    const bytes = buildEdf({
      recordCount: RECORDS,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Fp1', samplesPerRecord: 4000, sample: (r, i) => ((r * 4000 + i) % 997) - 498 },
      ],
    });
    const edf = await openEdf(byteSource(bytes));
    const [chunk] = await readEnvelopeAtResolution(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: RECORDS,
      secondsPerBucket: 30,
    });
    if (chunk === undefined) throw new Error('setup failed');

    // 24 buckets: 23 full ones of 30 s and a last one of 10 s. Every count is derived from the
    // geometry, not from another call to the code under test.
    expect(chunk.bucketCount).toBe(24);
    expect(chunk.secondsPerBucket).toBe(30);
    const counts = Array.from(chunk.signals[0]?.counts ?? []);
    expect(counts).toEqual([...Array.from({ length: 23 }, () => 30 * 4000), 10 * 4000]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(RECORDS * 4000);
  });

  it('covers the whole run when the resolution is finer than the sample interval', async () => {
    /*
     * The densest-samples clamp belongs to the even-division rule. Under the fixed-width rule the
     * count is not a free parameter — it is `ceil(runTicks / bucketTicks)` — so reducing it
     * SHORTENS THE GRID. `bucketStartsFor` got the clamped count, so the boundaries covered only
     * `bucketCount * bucketTicks` of elapsed time and the cursor pinned every later sample into
     * the final bucket, while `secondsPerBucket` still reported the width asked for.
     *
     * A 4 s run of a 2 Hz signal at 0.25 s per bucket came back as 8 buckets covering 2 s, with
     * the entire second half of the run in the last one (fixed in 0.3.30).
     */
    const bytes = buildEdf({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
    });
    const edf = await openEdf(byteSource(bytes));
    const [chunk] = await readEnvelopeAtResolution(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
      secondsPerBucket: 0.25,
    });
    if (chunk === undefined) throw new Error('setup failed');

    expect(chunk.bucketCount).toBe(16);
    expect(chunk.secondsPerBucket).toBe(0.25);
    // The axis the caller is told to draw actually spans the run.
    expect(chunk.bucketCount * chunk.secondsPerBucket).toBe(chunk.durationSeconds);
    // 2 Hz into 0.25 s buckets: one sample every other bucket, and none crushed into the tail.
    const counts = Array.from(chunk.signals[0]?.counts ?? []);
    expect(counts).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(8);
  });

  it('leaves readEnvelope, whose contract is a pixel count, clamped as before', async () => {
    // The clamp is right there: more buckets than samples would leave holes that mean nothing,
    // and a smaller count is simply a coarser even division of the same run.
    const bytes = buildEdf({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
    });
    const edf = await openEdf(byteSource(bytes));
    const [chunk] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 100,
    });
    expect(chunk?.bucketCount).toBe(8);
    expect(Array.from(chunk?.signals[0]?.counts ?? [])).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('refuses an absurdly fine resolution by naming the budget, rather than truncating', async () => {
    // The clamp was also the only thing bounding the allocation. Removing it for the fixed-width
    // rule means the ceiling has to be stated: one microsecond over four seconds is four million
    // buckets, and a budget refusal names the option to change.
    const bytes = buildEdf({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
    });
    const edf = await openEdf(byteSource(bytes));
    await expect(
      readEnvelopeAtResolution(
        edf,
        { signalIndices: [0], startSeconds: 0, durationSeconds: 4, secondsPerBucket: 0.000001 },
        { maxMaterializeBytes: 1_000_000 },
      ),
    ).rejects.toThrow(/maxMaterializeBytes budget/);
  });

  it('reports the whole grid in bucketCount, empty buckets included', async () => {
    /*
     * The field's docblock said "buckets actually filled". That was true of `readEnvelope`, whose
     * count is clamped to the densest signal's sample count, and stopped being true of
     * `readEnvelopeAtResolution` in 0.3.30 — which removed the clamp precisely so that a
     * resolution finer than the data leaves buckets empty rather than shortening the grid
     * (fixed in 0.3.70).
     */
    const bytes = buildEdf({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
    });
    const edf = await openEdf(byteSource(bytes));
    const [chunk] = await readEnvelopeAtResolution(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
      secondsPerBucket: 0.25,
    });
    const counts = [...(chunk?.signals[0]?.counts ?? [])].slice(0, chunk?.bucketCount);

    // 4 s at 0.25 s per bucket is the grid; 2 Hz fills every other one.
    expect(chunk?.bucketCount).toBe(16);
    expect(counts.filter((n) => n > 0)).toHaveLength(8);
    expect(counts).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);

    // The clamped rule still reports what it always did.
    const [clamped] = await readEnvelope(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 100,
    });
    expect(clamped?.bucketCount).toBe(8);
  });

  it('measures every allocation it is about to make, not only the accumulators', async () => {
    /*
     * The guard counted `min`, `max` and `counts` — 12 bytes per bucket per signal — and then the
     * fixed-width path allocated a `Float64Array(bucketCount)` of bucket starts per signal on top,
     * after the guard. So a call granted exactly the byte count its own refusal named allocated
     * 1.67x it, on the one path the budget exists for: "a fixed width fine enough — one microsecond
     * over an hour — asks for billions of buckets" (fixed in 0.3.89).
     */
    const realInt32 = globalThis.Int32Array;
    const realFloat64 = globalThis.Float64Array;
    let allocated = 0;
    class SpyInt32 extends realInt32 {
      constructor(length: number) {
        super(length);
        allocated += this.byteLength;
      }
    }
    class SpyFloat64 extends realFloat64 {
      constructor(length: number) {
        super(length);
        allocated += this.byteLength;
      }
    }

    const bytes = buildEdf({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Fp1', samplesPerRecord: 4 },
        { label: 'Fp2', samplesPerRecord: 4 },
      ],
    });
    const opened = await openEdf(byteSource(bytes));
    const edf = { ...opened, index: await buildRecordIndex(opened) };
    const selection = {
      signalIndices: [0, 1],
      startSeconds: 0,
      durationSeconds: 4,
      secondsPerBucket: 0.00001,
    };

    // Ask with an impossible budget so the refusal states the size it wants.
    const refusal = await readEnvelopeAtResolution(edf, selection, { maxMaterializeBytes: 1 }).then(
      () => '',
      (error: Error) => error.message,
    );
    const wanted = Number(/needs a (\d+)-byte accumulator/.exec(refusal)?.[1]);
    expect(wanted).toBeGreaterThan(0);

    // Grant exactly that, and count what the call really allocates.
    (globalThis as { Int32Array: unknown }).Int32Array = SpyInt32;
    (globalThis as { Float64Array: unknown }).Float64Array = SpyFloat64;
    try {
      const chunks = await readEnvelopeAtResolution(edf, selection, {
        maxMaterializeBytes: wanted,
      });
      // The premise: this really is the fixed-width path, where the extra array exists.
      expect(chunks[0]?.bucketCount).toBeGreaterThan(1000);
    } finally {
      (globalThis as { Int32Array: unknown }).Int32Array = realInt32;
      (globalThis as { Float64Array: unknown }).Float64Array = realFloat64;
    }

    // Within one bucket's worth of slack for the per-chunk scratch, which is bounded separately.
    expect(allocated).toBeLessThanOrEqual(wanted + 1024);
  });

  it('names the knob the caller actually passed, not the other function’s', async () => {
    // `reduceRange` is shared. Its refusal hard-coded "ask for a coarser secondsPerBucket", so a
    // `readEnvelope` caller — whose only resolution knob is `buckets`, a pixel width — was told to
    // change a parameter its signature does not have (fixed in 0.3.69).
    //
    // Dense enough that the densest-samples clamp does not save it: 8 x 4096 samples against
    // 30,000 buckets, which is what makes this path reachable from `readEnvelope` at all.
    const bytes = buildEdf({
      recordCount: 8,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4096 }],
    });
    const edf = await openEdf(byteSource(bytes));
    const selection = { signalIndices: [0], startSeconds: 0, durationSeconds: 8 };

    const fromBuckets = await readEnvelope(
      edf,
      { ...selection, buckets: 30_000 },
      {
        maxMaterializeBytes: 8192,
      },
    ).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(fromBuckets?.message).toContain('ask for fewer buckets');
    expect(fromBuckets?.message).not.toContain('secondsPerBucket');

    const fromResolution = await readEnvelopeAtResolution(
      edf,
      { ...selection, secondsPerBucket: 0.000001 },
      { maxMaterializeBytes: 8192 },
    ).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(fromResolution?.message).toContain('a coarser secondsPerBucket');
    expect(fromResolution?.message).not.toContain('fewer buckets');
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

describe('a signal with no scale is refused the same way by both converters', () => {
  it('names the cause the header recorded, not SCALE_UNAVAILABLE', async () => {
    /*
     * `toPhysicalEnvelope` hard-coded `{ code: 'SCALE_UNAVAILABLE' }`. That code is defined —
     * in the deferred-fatal table and in `describeScalingFailure` itself — as the case where none
     * of the other conditions applies, so on a signal whose digital range is degenerate it was
     * positively false, and `toPhysical` and `toPhysicalEnvelope` answered the same question
     * about the same signal with different codes. The envelope message also carried no raw
     * fields and no spec reference (fixed in 0.3.111).
     */
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 3,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Fp1', samplesPerRecord: 4 },
        { label: 'Flat', samplesPerRecord: 4, digitalMinimum: 5, digitalMaximum: 5 },
      ],
      annotationSignals: [{ samplesPerRecord: 20 }],
    });
    const recording = await openEdf(byteSource(bytes));
    const flat = recording.header.signals[1];
    if (flat === undefined) throw new Error('no signal');

    // The premise: the header really did record a specific cause for this signal.
    expect(flat.scale).toBeUndefined();
    expect(
      recording.header.diagnostics.filter((one) => one.signalIndex === 1).map((one) => one.code),
    ).toContain('DEGENERATE_DIGITAL_RANGE');

    const chunks = await readEnvelope(recording, {
      startSeconds: 0,
      durationSeconds: 3,
      signalIndices: [1],
      buckets: 3,
    });
    const envelope = chunks[0]?.signals[0];
    if (envelope === undefined) throw new Error('no envelope');

    const fromSamples = catchError(() => toPhysical(flat, Int32Array.from([1, 2, 3])));
    const fromEnvelope = catchError(() => toPhysicalEnvelope(flat, envelope));

    expect(fromEnvelope?.code).toBe('DEGENERATE_DIGITAL_RANGE');
    expect(fromEnvelope?.code).toBe(fromSamples?.code);
    // The evidence the envelope message used to omit.
    expect(fromEnvelope?.message).toContain('Raw fields:');
    expect(fromEnvelope?.message).toContain('Digital maximum must be larger');
    // And its own next step, which is the part that genuinely differs.
    expect(fromEnvelope?.message).toContain('plot the digital envelope');
  });
});
