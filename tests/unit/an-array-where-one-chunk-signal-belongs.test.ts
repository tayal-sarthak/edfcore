/**
 * A whole array handed to the two calls that take one chunk signal.
 *
 * `trimToWindow` and `envelopeOfSamples` each take one element of `chunk.signals`, and the arrays a
 * caller holds one or two levels up are what `readWindow` resolves to and `chunk.signals` itself.
 * Both were "an object with no signalIndex on it", which named neither.
 */

import { expect, it } from 'vitest';
import { envelopeOfSamples } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import { minimalEdf } from '../support/writer.js';

it('names an array rather than calling it an object', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  const chunks = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 1,
  });
  const named = "the signal is an array — readWindow()'s chunks, or a chunk's .signals";
  expect(() => trimToWindow(recording.header, chunks as never, 0, 1)).toThrow(
    `trimToWindow(): ${named}`,
  );
  expect(() => envelopeOfSamples(chunks[0]?.signals as never, 2)).toThrow(
    `envelopeOfSamples(): ${named}`,
  );
});
