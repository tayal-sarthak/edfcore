/**
 * "Next: pass the pixel width of the plot you are drawing into", on a file with a gap.
 *
 * `buckets` is the buckets ONE contiguous run is divided into. `readEnvelope` returns a chunk per
 * run — "the shape mirrors `readWindow` exactly", so a caller that already handles gaps handles
 * envelopes for free — and each chunk gets the full count. A window spanning two gaps answered a
 * 1000-pixel width with three chunks of 1000: three thousand columns for a thousand pixels, which
 * the caller has to reduce a second time.
 *
 * And each run is divided EVENLY into them, so the widths differ run to run. `api-helpers.md` puts
 * the consequence plainly — "widths that disagree cannot be drawn on one axis, which is the entire
 * reason this function exists separately from `readEnvelope`" — and the sibling it means,
 * `readEnvelopeAtResolution`, was the call the advice never named.
 *
 * The sentence was true on a continuous file, which is the only kind it was written against. EDF+D
 * is the format this package goes out of its way to carry, and it is the one the advice misled on.
 * Same shape as 0.6.206, where `formatHeader`'s note called the records' extent the span "which on
 * this file is not the span".
 */

import { describe, expect, it } from 'vitest';
import { envelopeOfSamples, readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** Two runs of different lengths: 0..4 s, then a hole, then 24..26 s. */
const GAPPED = buildEdf({
  format: 'EDF',
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
  recordOnsetSeconds: (r) => (r < 4 ? r : r + 20),
});

const CONTINUOUS = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
});

/** A gapped file needs a scanned index before seconds can be mapped to records. */
const opened = async (bytes: Uint8Array): Promise<EdfRecording> => {
  const recording = await openEdf(byteSource(bytes));
  return { ...recording, index: await buildRecordIndex(recording) };
};

const refusal = async (call: () => unknown): Promise<Error> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('what the advice promised, measured', () => {
  it('returns the count once per run, not once per window', async () => {
    const recording = await opened(GAPPED);
    const chunks = await readEnvelope(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 30,
      buckets: 8,
    });
    expect(chunks.length).toBe(2);
    expect(chunks.map((c) => c.bucketCount)).toEqual([8, 8]);
    const columns = chunks.reduce((total, c) => total + (c.signals[0]?.min.length ?? 0), 0);
    expect(columns, 'an 8-pixel plot came back as 16 columns').toBe(16);
  });

  it('gives those buckets different widths in each run, which is the rest of the claim', async () => {
    const recording = await opened(GAPPED);
    const [first, second] = await readEnvelope(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 30,
      buckets: 8,
    });
    expect(first?.secondsPerBucket).toBe(0.5);
    expect(second?.secondsPerBucket).toBe(0.25);
    // The sibling the advice now names answers the same window with one width throughout.
    const even = await readEnvelopeAtResolution(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 30,
      secondsPerBucket: 0.5,
    });
    expect(new Set(even.map((c) => c.secondsPerBucket)).size).toBe(1);
  });

  it('is one chunk of exactly that many on a continuous file, as it always was', async () => {
    const chunks = await readEnvelope(await opened(CONTINUOUS), {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 6,
      buckets: 8,
    });
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.signals[0]?.min.length).toBe(8);
  });
});

describe('the refusal that carried the advice', () => {
  const badCounts = [0, -1, 1.5, Number.NaN];

  it('no longer offers the whole plot for a per-run count', async () => {
    const recording = await opened(GAPPED);
    for (const buckets of badCounts) {
      const thrown = await refusal(() =>
        readEnvelope(recording, {
          signalIndices: [0],
          startSeconds: 0,
          durationSeconds: 30,
          buckets,
        }),
      );
      expect(thrown.message, String(buckets)).not.toContain(
        'pixel width of the plot you are drawing into',
      );
      expect(thrown.message).toContain('ONE contiguous run');
      expect(thrown.message).toContain('buckets per run');
    }
  });

  it('names the call whose buckets are the same width across runs', async () => {
    const recording = await opened(GAPPED);
    const thrown = await refusal(() =>
      readEnvelope(recording, {
        signalIndices: [0],
        startSeconds: 0,
        durationSeconds: 30,
        buckets: 0,
      }),
    );
    expect(thrown.message).toContain('readEnvelopeAtResolution(recording, selection)');
    expect(thrown.message).toContain('Next:');
  });

  it('keeps naming the argument, and stays the shared message with no function in it', async () => {
    const chunks = await readWindow(await opened(CONTINUOUS), {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    const signal = chunks[0]?.signals[0];
    const thrown = await refusal(() => envelopeOfSamples(signal as never, 0));
    // `envelopeOfSamples` takes one chunk signal, which IS one run — the advice fits it too.
    expect(thrown.message).toContain('buckets must be a positive whole number, received 0');
    expect(thrown.message).not.toContain('readEnvelope(');
    expect(thrown.message).not.toContain('envelopeOfSamples(');
  });
});
