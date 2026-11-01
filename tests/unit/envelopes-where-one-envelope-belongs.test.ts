/**
 * What `readEnvelope` resolved to, handed whole to `toPhysicalEnvelope`.
 *
 * The array is what a caller holds after the await, and `toPhysicalEnvelope(signal, envelopes)`
 * is that value passed one step early. It was called "an object with no min on it" — an array
 * is not what a reader calls an object, and the sentence does not say which layer it is.
 */

import { expect, it } from 'vitest';
import { readEnvelope, toPhysicalEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

it('toPhysicalEnvelope() names the array readEnvelope() resolves to', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  const envelopes = await readEnvelope(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 1,
    buckets: 4,
  });
  const signal = recording.header.signals[0];
  expect(() => toPhysicalEnvelope(signal as never, envelopes as never)).toThrow(
    'toPhysicalEnvelope(): the envelope is the array readEnvelope() resolves to, which holds ' +
      'one chunk per contiguous run. Next: pass one element of chunk.signals',
  );
});
