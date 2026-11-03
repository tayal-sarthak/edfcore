/**
 * A selection whose indices are under `signals` rather than `signalIndices`.
 *
 * The chunk guard recognised any selection with a `signals` array, so `{ signals: [0], … }` — the
 * key a chunk uses, and the one a caller abbreviates to — was called a chunk "which is what a read
 * returns". A chunk's signals are objects; numbers there are a selection with its key misspelled.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

it('readWindow() names the misspelled key rather than calling the selection a chunk', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  const selection = { signals: [0], startSeconds: 0, durationSeconds: 1 };
  const refusal = readWindow(recording, selection as never);
  await expect(refusal).rejects.toThrow(
    'readWindow(): the selection holds its indices on `signals`, and the field is called ' +
      'signalIndices.',
  );
  await expect(refusal).rejects.not.toThrow('is a chunk');
});
