/**
 * A recording handed to `mergeChunks` where the chunks read from it belong.
 *
 * `mergeChunks` sits in the barrel among the calls that take the recording, so the recording is
 * what arrives. It was called "an object, not an array" and sent to `readWindow()`, which is the
 * right next step for a reason the sentence never gave: nothing had been read yet.
 */

import { expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

it('mergeChunks() says a recording has not been read yet', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  expect(() => mergeChunks(recording as never)).toThrow(
    'mergeChunks: the chunks are a recording, which has not been read yet. Next: pass what ' +
      'readWindow() resolved to',
  );
});
