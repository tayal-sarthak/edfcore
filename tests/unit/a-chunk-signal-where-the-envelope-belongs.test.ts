/**
 * A chunk signal from `readWindow` handed to `toPhysicalEnvelope`.
 *
 * The two scaling calls take the same signal first and differ only in what comes second, so a
 * caller with samples in hand reaches for the one whose name mentions the plot. It was "an object
 * with no min on it", which said nothing about the call that scales samples.
 */

import { expect, it } from 'vitest';
import { toPhysicalEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

it('toPhysicalEnvelope() points a chunk signal at toPhysical()', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  const [chunk] = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 1,
  });
  const signal = recording.header.signals[0];
  expect(() => toPhysicalEnvelope(signal as never, chunk?.signals[0] as never)).toThrow(
    'the envelope is a chunk signal — samples, which toPhysical(signal, chunkSignal.digital) scales',
  );
});
