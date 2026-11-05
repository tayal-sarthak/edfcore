/**
 * A window bounded by `endSeconds` where `durationSeconds` belongs.
 *
 * Segments and gaps both state their bounds as a start and an end, so `{ startSeconds, endSeconds }`
 * is a spelling this package itself teaches. It was "durationSeconds must be a finite number of
 * seconds, but was undefined", with advice about a spread that dropped a key — not the field that
 * was there instead.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

it('names endSeconds and the length to pass instead', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  const selection = { signalIndices: [0], startSeconds: 0, endSeconds: 1 };
  await expect(readWindow(recording, selection as never)).rejects.toThrow(
    'readWindow(): the selection has an endSeconds, and this call measures the window by its ' +
      'length. Next: pass durationSeconds, which is endSeconds minus startSeconds.',
  );
});
