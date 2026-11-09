/**
 * A time spelled as text or as ticks, handed to `sampleAt`.
 *
 * The advice was to "pass a time on the recording axis" — and `chunk.startTicks` is on that axis
 * already, as is a cursor position read back out of a URL. Each is the right time in another type.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { sampleAt } from '../../src/sample-locate.js';
import { minimalEdf } from '../support/writer.js';

it('sends text to Number() and ticks to the seconds beside them', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  const advice = 'Next: convert it first — Number(text) for a string, and for a tick count';
  expect(() => sampleAt(recording, 0, '1' as never)).toThrow(advice);
  expect(() => sampleAt(recording, 0, 10_000_000n as never)).toThrow(advice);
  expect(() => sampleAt(recording, 0, Number.NaN)).toThrow('Next: pass a time on the recording');
});
