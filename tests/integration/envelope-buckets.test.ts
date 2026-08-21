/**
 * How many buckets an envelope has, against the two rules `api-helpers.md` states.
 *
 * `readEnvelope` clamps `buckets` to the densest signal's sample count, because "asking for more
 * buckets than there are samples would leave holes that mean nothing".
 * `readEnvelopeAtResolution` does not clamp, "because reducing it would shorten the grid rather
 * than coarsen it" — a resolution is a promise about seconds per pixel, and honouring it by
 * dropping buckets would silently change the time span the caller is drawing.
 *
 * The page gives the case where the two part company: "A 4-second run of a 2 Hz signal at 0.25 s
 * per bucket reports 16 buckets with 8 of them filled."
 *
 * That is also the sentence a viewer's indexing depends on. `bucketCount` is "the field to read
 * before indexing", and a caller who trusts the `buckets` they passed instead walks off the end of
 * a short run, or draws a grid narrower than the window it claims to cover.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-helpers.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');

/** "A 4-second run of a 2 Hz signal at 0.25 s per bucket reports 16 buckets with 8 of them filled." */
const WORKED =
  /A (\d+)-second run of a (\d+) Hz signal at ([\d.]+) s per bucket reports (\d+) buckets with (\d+) of them filled/.exec(
    FLAT,
  );

describe('the worked case where the two rules differ', () => {
  it('is still stated on the page', () => {
    expect(WORKED).not.toBeNull();
  });

  it('reports the count and the filled buckets the page reports', async () => {
    const seconds = Number(WORKED?.[1]);
    const hz = Number(WORKED?.[2]);
    const secondsPerBucket = Number(WORKED?.[3]);

    const bytes = buildEdf({
      recordCount: seconds,
      recordDurationSeconds: 1,
      signals: [{ label: 'Slow', samplesPerRecord: hz }],
    });
    const recording = await openEdf(byteSource(bytes));

    const [chunk] = await readEnvelopeAtResolution(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: seconds,
      secondsPerBucket,
    });

    // `ceil(runTicks / bucketTicks)`, not the sample count.
    expect(chunk?.bucketCount).toBe(Number(WORKED?.[4]));
    expect(chunk?.secondsPerBucket).toBe(secondsPerBucket);

    const filled = [...(chunk?.signals[0]?.counts ?? [])].filter((count) => count > 0).length;
    expect(filled).toBe(Number(WORKED?.[5]));
    // Which is every sample in the run, each in its own bucket.
    expect(chunk?.signals[0]?.sampleCount).toBe(seconds * hz);
  });

  it('holds the grid at the resolution asked for, rather than shortening it', async () => {
    // The reason it does not clamp: the count times the resolution is the span being drawn.
    const seconds = Number(WORKED?.[1]);
    const secondsPerBucket = Number(WORKED?.[3]);
    const bytes = buildEdf({
      recordCount: seconds,
      recordDurationSeconds: 1,
      signals: [{ label: 'Slow', samplesPerRecord: Number(WORKED?.[2]) }],
    });
    const recording = await openEdf(byteSource(bytes));
    const [chunk] = await readEnvelopeAtResolution(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: seconds,
      secondsPerBucket,
    });
    expect((chunk?.bucketCount ?? 0) * secondsPerBucket).toBe(seconds);
  });
});

describe('readEnvelope, which does clamp', () => {
  const BYTES = buildEdf({
    recordCount: 4,
    recordDurationSeconds: 1,
    signals: [
      { label: 'Slow', samplesPerRecord: 2 },
      { label: 'Fast', samplesPerRecord: 16 },
    ],
  });

  it('never returns more buckets than the densest signal has samples', async () => {
    // "`buckets` is clamped to the sample count of the densest signal in the run."
    expect(FLAT).toContain('clamped to the sample count of the densest signal in the run');
    const recording = await openEdf(byteSource(BYTES));
    const [chunk] = await readEnvelope(recording, {
      signalIndices: [0, 1],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 100_000,
    });
    // Four records of 16 samples on the densest channel.
    expect(chunk?.bucketCount).toBe(64);
    expect(chunk?.bucketCount).toBeLessThan(100_000);
  });

  it('honours a bucket count that fits', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const [chunk] = await readEnvelope(recording, {
      signalIndices: [0, 1],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 8,
    });
    expect(chunk?.bucketCount).toBe(8);
  });

  it('gives every signal the same grid, whatever its own rate', async () => {
    // One grid per chunk is what makes two channels drawable against one axis.
    const recording = await openEdf(byteSource(BYTES));
    const [chunk] = await readEnvelope(recording, {
      signalIndices: [0, 1],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 8,
    });
    for (const signal of chunk?.signals ?? []) {
      expect(signal.min).toHaveLength(chunk?.bucketCount ?? 0);
      expect(signal.max).toHaveLength(chunk?.bucketCount ?? 0);
      expect(signal.counts).toHaveLength(chunk?.bucketCount ?? 0);
    }
  });

  it('keeps two numbers per bucket, which is what an envelope is', async () => {
    // "at two numbers per pixel" — and `counts` is the authoritative answer about emptiness.
    expect(FLAT).toContain(
      'keeps the minimum and maximum of each bucket, at two numbers per pixel',
    );
    const recording = await openEdf(byteSource(BYTES));
    const [chunk] = await readEnvelope(recording, {
      signalIndices: [1],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 8,
    });
    const signal = chunk?.signals[0];
    expect(signal?.sampleCount).toBe([...(signal?.counts ?? [])].reduce((a, b) => a + b, 0));
    for (let at = 0; at < (chunk?.bucketCount ?? 0); at += 1) {
      if ((signal?.counts[at] ?? 0) === 0) continue;
      expect(signal?.min[at]).toBeLessThanOrEqual(signal?.max[at] ?? 0);
    }
  });
});
