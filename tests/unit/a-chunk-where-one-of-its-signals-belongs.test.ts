/**
 * A whole chunk handed to the two calls that take one of its signals.
 *
 * `trimToWindow(header, chunkSignal, …)` and `envelopeOfSamples(chunkSignal, buckets)` take one element
 * of `chunk.signals`, and the chunk is the object a reader is holding when they write either. The
 * refusal was true and no help: "the signal is an object with no signalIndex on it" — and the next
 * step already named `chunk.signals`, the field one level down from what they passed.
 * `toPhysicalEnvelope` names its envelope chunk as a chunk; these two now do too.
 */

import { describe, expect, it } from 'vitest';
import { envelopeOfSamples } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import { minimalEdfPlus } from '../support/writer.js';

const aChunk = async () => {
  const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 4 })));
  const [chunk] = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 2,
  });
  return { header: recording.header, chunk };
};

describe('a chunk where one of its signals belongs', () => {
  it('is named a chunk by trimToWindow', async () => {
    const { header, chunk } = await aChunk();
    expect(() => trimToWindow(header, chunk as never, 0, 1)).toThrow(
      'trimToWindow(): the signal is a chunk, which carries one signal per element of .signals',
    );
  });

  it('is named a chunk by envelopeOfSamples', async () => {
    const { chunk } = await aChunk();
    expect(() => envelopeOfSamples(chunk as never, 10)).toThrow(
      'envelopeOfSamples(): the signal is a chunk',
    );
  });

  it('still takes the element the next step names', async () => {
    const { chunk } = await aChunk();
    const [signal] = chunk?.signals ?? [];
    expect(envelopeOfSamples(signal as never, 2).signalIndex).toBe(0);
  });
});
