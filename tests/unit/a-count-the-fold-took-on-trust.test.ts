/**
 * `envelopeOfSamples` folding by a count that is not one.
 *
 * Its docblock states the contract and the reason for it: "`sampleCount` bounds the reduction, not
 * `digital.length`... The bound is here because a CALLER can build an `EdfChunkSignal`, and because
 * `mergeChunks` and `trimToWindow` already take `sampleCount` as authoritative: two helpers
 * defending and one not is the worst of the three states."
 *
 * The bound it had was `Math.min(sampleCount, digital.length)`, which defends only against a count
 * that is too LARGE. Below zero, fractional, or `NaN`, it defended nothing — while `buckets`, the
 * other argument, was checked one line above by `assertPositiveInteger`.
 *
 * Each answer was a lie about the samples in hand, and the worst of them is silent:
 *
 *   - A NEGATIVE count made `total` negative, so the fold loop never ran and the result was one
 *     bucket of count zero carrying the caller's own `sampleCount: -5`. `toPhysicalEnvelope` renders
 *     a bucket of count zero as `NaN` — which is how this package spells a dropout — so forty real
 *     samples came back as a hole in the recording, through a function whose whole job is to make
 *     samples drawable.
 *   - `NaN` was worse still: `Math.max(1, Math.min(buckets, NaN))` is `NaN` and `new Int32Array(NaN)`
 *     has length 0, so the envelope had NO buckets at all — a shape no read in this package produces.
 *   - A FRACTIONAL count rode through onto the result as it arrived.
 *
 * `>= 0` rather than `> 0`: a zero-sample `EdfChunkSignal` is real — `trimToWindow` returns one for a
 * window that selected nothing — and folding it to empty buckets is the honest answer (0.6.290).
 */

import { describe, expect, it } from 'vitest';
import { envelopeOfSamples, toPhysicalEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfChunkSignal, EdfHeader, EdfSignal } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

async function fixture(): Promise<{
  header: EdfHeader;
  signal: EdfSignal;
  chunkSignal: EdfChunkSignal;
}> {
  const recording = await openEdf(
    byteSource(minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 })),
  );
  const chunks = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 4,
  });
  const chunkSignal = chunks[0]?.signals[0];
  const signal = recording.header.signals[0];
  if (chunkSignal === undefined || signal === undefined) throw new Error('fixture');
  return { header: recording.header, signal, chunkSignal };
}

describe('envelopeOfSamples refuses a count that is not one', () => {
  it('has real samples to fold, so an empty answer is never the honest one', async () => {
    const { chunkSignal } = await fixture();
    expect(chunkSignal.sampleCount).toBe(40);
    expect(chunkSignal.digital.length).toBe(40);
  });

  it('refuses a negative count rather than reporting a hole', async () => {
    const { chunkSignal } = await fixture();
    expect(() => envelopeOfSamples({ ...chunkSignal, sampleCount: -5 }, 4)).toThrow(
      /declares -5 samples, which is not a count of them/,
    );
  });

  it('refuses NaN, which produced an envelope with no buckets at all', async () => {
    const { chunkSignal } = await fixture();
    expect(() => envelopeOfSamples({ ...chunkSignal, sampleCount: Number.NaN }, 4)).toThrow(
      /declares NaN samples/,
    );
  });

  it('refuses a fractional count, which rode through onto the result', async () => {
    const { chunkSignal } = await fixture();
    expect(() => envelopeOfSamples({ ...chunkSignal, sampleCount: 1.5 }, 4)).toThrow(
      /declares 1.5 samples/,
    );
  });

  it('ends every one of those with a Next: clause naming what to pass', async () => {
    const { chunkSignal } = await fixture();
    for (const sampleCount of [-5, Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      let message = '';
      try {
        envelopeOfSamples({ ...chunkSignal, sampleCount }, 4);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, String(sampleCount)).toMatch(/Next: pass one element of chunk\.signals/);
    }
  });

  it('still folds a zero-sample signal, which trimToWindow really returns', async () => {
    const { header, chunkSignal } = await fixture();
    // A window past this chunk: a real `EdfChunkSignal` carrying no samples.
    const trimmed = trimToWindow(header, chunkSignal, 100, 1);
    expect(trimmed.sampleCount).toBe(0);
    const folded = envelopeOfSamples(trimmed, 4);
    expect(folded.sampleCount).toBe(0);
    expect([...folded.counts]).toEqual([0]);
  });

  it('still folds the signal a read actually produced, unchanged', async () => {
    const { chunkSignal } = await fixture();
    const folded = envelopeOfSamples(chunkSignal, 4);
    expect(folded.sampleCount).toBe(40);
    expect([...folded.counts]).toEqual([10, 10, 10, 10]);
  });

  it('is what kept a dropout from being fabricated downstream', async () => {
    const { signal, chunkSignal } = await fixture();
    // The old path: the negative count folded to one empty bucket, and an empty bucket is NaN in
    // physical units — indistinguishable from a stretch of recording with no samples in it.
    const honest = toPhysicalEnvelope(signal, envelopeOfSamples(chunkSignal, 4));
    expect([...honest.min].every((value) => Number.isFinite(value))).toBe(true);
    expect([...honest.max].every((value) => Number.isFinite(value))).toBe(true);
  });
});
