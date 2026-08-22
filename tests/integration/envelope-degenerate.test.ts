/**
 * The envelope of the files and selections a viewer actually produces by accident.
 *
 * `readEnvelope` exists to draw a recording at pixel width, so its caller is a UI: the signal
 * indices come from a multi-select, the bucket count from a canvas width, and the file from
 * whatever the user dropped on the page. Three shapes fall out of that and none had been drawn:
 *
 *  - **The same signal asked for twice.** A multi-select that appends on click, a "select all"
 *    over a list that already had one checked, a URL parameter merged with a default. The result
 *    must be one series, not two identical ones sharing a legend entry — and the reads behind it
 *    must be paid for once.
 *  - **A signal with no samples in a record.** Legal, warned about on open, and present in
 *    `header.signals` beside the live channels, so a "plot everything" loop reaches it.
 *  - **A file whose records do not advance in time.** Also legal. There is no time axis to bucket
 *    along, which is the one case where the bucket arithmetic would divide by zero.
 *
 * `envelope.test.ts` covers the refusals — a signal index the file does not have, a bucket count
 * that is not a positive integer — and the extremes a bucket must not lose. These are the inputs
 * that are not mistakes and still have to produce something a caller can draw.
 *
 * A fourth is not a file at all but a request: a `secondsPerBucket` finer than one tick. It has no
 * whole-tick answer, and what the code does about that — ask for one bucket per tick, then let the
 * fold clamp to one bucket per sample — was a comment.
 *
 * What this does NOT check: what the drawing looks like. `envelope-buckets.test.ts` owns the
 * bucket boundaries and `envelope-physical.test.ts` owns the conversion; the question here is
 * only that a chunk comes back, with the series the caller can account for.
 *
 * Nor which of two guards produces the single bucket on a zero-span run. `runTicks > 0n ? … : 1`
 * and the `Math.max(1, …)` inside `clampToSafeInteger` give the same answer for it, so removing
 * either alone changes nothing — as does the zero guard inside `bucketStartsFor`, which the
 * fixed-width path reaches only with a bucket count of one and therefore an empty loop. What is
 * pinned is the count, not the line that produces it.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

const twoSignals = (): Uint8Array =>
  buildEdf({
    recordCount: 4,
    recordDurationSeconds: 1,
    signals: [
      { label: 'Fp1', samplesPerRecord: 8 },
      { label: 'Fp2', samplesPerRecord: 8 },
    ],
  });

const open = (bytes: Uint8Array): Promise<EdfRecording> => openEdf(byteSource(bytes));

describe('the same signal asked for twice', () => {
  it('is one series, not two', async () => {
    const recording = await open(twoSignals());
    const [chunk] = await readEnvelope(recording, {
      signalIndices: [0, 0, 1, 0],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 8,
    });
    expect(chunk?.signals.map((one) => one.signalIndex)).toEqual([0, 1]);
  });

  it('keeps the order of first mention, so a legend matches the selection', async () => {
    const recording = await open(twoSignals());
    const [chunk] = await readEnvelope(recording, {
      signalIndices: [1, 0, 1],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 8,
    });
    expect(chunk?.signals.map((one) => one.signalIndex)).toEqual([1, 0]);
  });

  it('costs what asking once costs', async () => {
    const measure = async (signalIndices: readonly number[]): Promise<number> => {
      const spy = spySource(byteSource(twoSignals()));
      const recording = await openEdf(spy);
      const before = spy.bytesRead;
      await readEnvelope(recording, {
        signalIndices,
        startSeconds: 0,
        durationSeconds: 4,
        buckets: 8,
      });
      return spy.bytesRead - before;
    };
    expect(await measure([0, 0, 0, 1])).toBe(await measure([0, 1]));
  });

  it('is the same for readEnvelopeAtResolution, which shares the resolver', async () => {
    const recording = await open(twoSignals());
    const [chunk] = await readEnvelopeAtResolution(recording, {
      signalIndices: [0, 0],
      startSeconds: 0,
      durationSeconds: 4,
      secondsPerBucket: 1,
    });
    expect(chunk?.signals.map((one) => one.signalIndex)).toEqual([0]);
  });
});

describe('a bucket finer than a tick', () => {
  it('is clamped to one bucket per sample, which is the finest picture there is', async () => {
    const recording = await open(twoSignals());
    // One tick is 100 ns. A nanosecond per bucket rounds to zero ticks and cannot be honoured.
    const [chunk] = await readEnvelopeAtResolution(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
      secondsPerBucket: 1e-9,
    });
    const series = chunk?.signals[0];
    // Eight samples a record over four records: one bucket each, and no empty ones between.
    expect(series?.sampleCount).toBe(32);
    expect(series?.counts).toHaveLength(32);
    expect([...(series?.counts ?? [])].every((count) => count === 1)).toBe(true);
  });
});

describe('a signal with no samples in a record', () => {
  it('draws as an empty series rather than failing the whole envelope', async () => {
    const recording = await open(
      buildEdf({
        recordCount: 4,
        recordDurationSeconds: 1,
        signals: [
          { label: 'Flat', samplesPerRecord: 0 },
          { label: 'Fp1', samplesPerRecord: 8 },
        ],
      }),
    );
    expect(recording.header.diagnostics.map((one) => one.code)).toContain(
      'ZERO_SAMPLES_PER_RECORD',
    );
    const [chunk] = await readEnvelope(recording, {
      signalIndices: [0, 1],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 4,
    });
    // Both series are present: a "plot everything" loop gets a slot for every channel it named.
    expect(chunk?.signals.map((one) => one.signalIndex)).toEqual([0, 1]);
    const flat = chunk?.signals[0];
    expect(flat?.sampleCount).toBe(0);
    // Nothing was folded into it, so no bucket claims a value it never saw.
    expect(flat?.counts?.every((count) => count === 0) ?? true).toBe(true);
  });
});

describe('a file whose records do not advance in time', () => {
  it('buckets it without dividing by the duration', async () => {
    const recording = await open(
      buildEdf({
        recordCount: 3,
        recordDurationSeconds: 0,
        signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      }),
    );
    const chunks = await readEnvelope(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 1,
      buckets: 4,
    });
    // Every record is at one instant, so the whole file is one chunk of zero span.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.records).toEqual({ start: 0, count: 3 });
    expect(chunks[0]?.durationSeconds).toBe(0);
    const series = chunks[0]?.signals[0];
    expect(series?.sampleCount).toBe(24);
    // Divided evenly, which is `readEnvelope`'s contract: the caller asked for a pixel width, and
    // there are no timestamps to place the samples along instead. Six per bucket, none lost.
    expect([...(series?.counts ?? [])]).toEqual([6, 6, 6, 6]);
  });

  it('gives readEnvelopeAtResolution one bucket, because there is no width to divide', async () => {
    // The fixed-width path derives its bucket count from the run's span, and the span is zero.
    // This is the one call where the bucket boundaries would be computed by dividing by the
    // record duration, so it is the one that must not.
    const recording = await open(
      buildEdf({
        recordCount: 3,
        recordDurationSeconds: 0,
        signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      }),
    );
    const [chunk] = await readEnvelopeAtResolution(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 1,
      secondsPerBucket: 1,
    });
    expect([...(chunk?.signals[0]?.counts ?? [])]).toEqual([24]);
  });

  it('returns nothing for a window that misses the instant', async () => {
    const recording = await open(
      buildEdf({
        recordCount: 3,
        recordDurationSeconds: 0,
        signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      }),
    );
    expect(
      await readEnvelope(recording, {
        signalIndices: [0],
        startSeconds: 5,
        durationSeconds: 1,
        buckets: 4,
      }),
    ).toEqual([]);
  });
});
