/**
 * A sample index spelled as text, handed to the grid family.
 *
 * The advice explained that "a fractional one has no position on" the grid — about `"12"`, which
 * is a whole index in the wrong type rather than a fraction.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { gridSampleStartSeconds } from '../../src/sample-grid.js';
import { minimalEdf } from '../support/writer.js';

it('sends text to Number() rather than talking about fractions', async () => {
  const header = await readHeader(byteSource(minimalEdf()));
  const [signal] = header.signals;
  const d = header.recordDurationTicks;
  expect(() => gridSampleStartSeconds(signal as never, '12' as never, d)).toThrow(
    'received the string "12". Next: convert it with Number() first',
  );
  expect(() => gridSampleStartSeconds(signal as never, 1.5, d)).toThrow('a fractional one');
});
