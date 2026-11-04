/**
 * The signals of an earlier chunk handed back as `signalIndices`.
 *
 * Reading the next window of the same channels is written with the chunk in hand, and its
 * `signals` are the channels that were read. They were refused as "an object, not a number this
 * header can be indexed by" and sent to `getSignal(header, label)` — when each one carries the
 * index it was read with, on `signalIndex`.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

it('readWindow() points chunk signals at their signalIndex', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  const window = { startSeconds: 0, durationSeconds: 1 };
  const [chunk] = await readWindow(recording, { signalIndices: [0], ...window });
  const signalIndices = chunk?.signals as never;
  await expect(readWindow(recording, { signalIndices, ...window })).rejects.toThrow(
    'signalIndices holds a chunk signal rather than an index. Next: pass chunkSignal.signalIndex',
  );
});
