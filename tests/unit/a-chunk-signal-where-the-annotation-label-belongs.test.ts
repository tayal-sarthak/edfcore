/**
 * A chunk signal handed to `isAnnotationLabel`.
 *
 * `chunk.signals.filter(isAnnotationLabel)` is the predicate shape the name invites, and each
 * element was told to "pass signal.label" — a field a chunk signal does not have.
 */

import { expect, it } from 'vitest';
import { isAnnotationLabel } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

it('points a chunk signal at the declaration it was read from', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  const [chunk] = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 1,
  });
  expect(() => isAnnotationLabel(chunk?.signals[0] as never)).toThrow(
    'Next: pass header.signals[chunkSignal.signalIndex].label — a chunk signal carries no label.',
  );
});
