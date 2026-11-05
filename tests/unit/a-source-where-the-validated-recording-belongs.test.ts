/**
 * The source handed to `validateRecording` where the recording opened from it belongs.
 *
 * It was "the recording is not the object openEdf() returns" — true of anything. The reading calls
 * already name a ByteSource as "what openEdf() reads, not what it resolves to".
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { validateRecording } from '../../src/validate.js';
import { minimalEdf } from '../support/writer.js';

it('names a ByteSource', async () => {
  const source = byteSource(minimalEdf());
  await expect(validateRecording(source as never)).rejects.toThrow(
    'validateRecording(): the recording is a ByteSource — what openEdf() reads, not what it ' +
      'resolves to.',
  );
});
