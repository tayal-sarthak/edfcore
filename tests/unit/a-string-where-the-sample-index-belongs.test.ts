/**
 * A sample index spelled as text, handed to `sampleStartSecondsOf`.
 *
 * The advice was to "index by samplesPerRecord rather than deriving one from a float sampleRateHz"
 * — about a fractional index, which `"12"` is not. It is a whole index in the wrong type.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { sampleStartSecondsOf } from '../../src/sample-locate.js';
import { minimalEdf } from '../support/writer.js';

it('sends text to Number() rather than to samplesPerRecord', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  expect(() => sampleStartSecondsOf(recording, 0, '12' as never)).toThrow(
    'received the string "12". Next: convert it with Number() first',
  );
  expect(() => sampleStartSecondsOf(recording, 0, 1.5)).toThrow('Next: index by samplesPerRecord');
});
