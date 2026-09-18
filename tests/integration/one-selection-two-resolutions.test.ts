/**
 * A selection carrying both `buckets` and `secondsPerBucket`.
 *
 * The two envelope calls exist so a caller can state the bucket width either way — `readEnvelope`
 * takes "a plot's pixel width", `readEnvelopeAtResolution` takes seconds per pixel — and
 * `api-helpers.md` puts it as the choice between what a pixel width knows and what a time axis
 * knows. A viewer that offers both switches between them on one selection object.
 *
 * Whichever field was not taken out on the way was simply ignored. So the same object answered with
 * four buckets from one call and six from the other: two different resolutions for one selection,
 * with nothing saying which had been used.
 *
 * It is the reverse of the records-versus-window pair `assertSelection` handles (0.6.87 and
 * 0.6.176), and the difference is what makes it worth its own refusal: those are two shapes and one
 * is wrong, while these are two answers to the same question and neither is.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const WINDOW = { signalIndices: [0], startSeconds: 0, durationSeconds: 6 } as const;

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

describe('a selection carrying both', () => {
  it('is refused by readEnvelope, which was about to ignore the seconds', async () => {
    const recording = await opened();
    const thrown = await readEnvelope(recording, {
      ...WINDOW,
      buckets: 4,
      secondsPerBucket: 1,
    } as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'one field was silently dropped').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('carries both buckets and secondsPerBucket');
    expect(thrown?.message).toContain('readEnvelopeAtResolution()');
    expect(thrown?.message).toContain('Next:');
  });

  it('is refused by readEnvelopeAtResolution, which was about to ignore the count', async () => {
    const recording = await opened();
    const thrown = await readEnvelopeAtResolution(recording, {
      ...WINDOW,
      buckets: 4,
      secondsPerBucket: 1,
    } as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown).toBeDefined();
    expect(thrown?.message).toContain('carries both secondsPerBucket and buckets');
    expect(thrown?.message).toContain('readEnvelope()');
  });

  it('was two different answers to one object, which is what made it worth refusing', async () => {
    // Pinned as the behaviour that was there, through the single-field calls that still work: the
    // same window gives four buckets one way and six the other, so the ignored field was never a
    // harmless duplicate of the one that won.
    const recording = await opened();
    const byCount = await readEnvelope(recording, { ...WINDOW, buckets: 4 });
    const bySeconds = await readEnvelopeAtResolution(recording, {
      ...WINDOW,
      secondsPerBucket: 1,
    });
    expect(byCount[0]?.signals[0]?.min.length).toBe(4);
    expect(bySeconds[0]?.signals[0]?.min.length).toBe(6);
  });
});

describe('a selection carrying one', () => {
  it('still reads by bucket count', async () => {
    const recording = await opened();
    const chunks = await readEnvelope(recording, { ...WINDOW, buckets: 8 });
    expect(chunks[0]?.signals[0]?.min.length).toBe(8);
  });

  it('still reads by seconds per bucket', async () => {
    const recording = await opened();
    const chunks = await readEnvelopeAtResolution(recording, { ...WINDOW, secondsPerBucket: 2 });
    expect(chunks[0]?.signals[0]?.min.length).toBe(3);
  });

  it('is unbothered by a field explicitly set to undefined', async () => {
    const recording = await opened();
    await expect(
      readEnvelope(recording, { ...WINDOW, buckets: 4, secondsPerBucket: undefined } as never),
    ).resolves.toBeDefined();
  });

  it('still refuses a bucket count that is not one', async () => {
    const recording = await opened();
    await expect(readEnvelope(recording, { ...WINDOW, buckets: 0 })).rejects.toThrow(
      /buckets must be a positive whole number/,
    );
    await expect(
      readEnvelopeAtResolution(recording, { ...WINDOW, secondsPerBucket: 0 }),
    ).rejects.toThrow(/secondsPerBucket must be a positive finite number/);
  });
});
