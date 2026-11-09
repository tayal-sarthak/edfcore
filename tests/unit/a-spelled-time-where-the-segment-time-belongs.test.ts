/**
 * A time spelled as text or as ticks, handed to `segmentAt`.
 *
 * The advice was "not the result of dividing by a zero recordDurationSeconds" — about `"12.5"` from
 * a URL, or a tick count, neither of which anybody divided to get.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, segmentAt } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

it('sends text to Number() and ticks to the seconds beside them', async () => {
  const index = await buildRecordIndex(await openEdf(byteSource(minimalEdf())));
  const advice = 'Next: convert it first — Number(text) for a string, and for a tick count';
  expect(() => segmentAt(index, '1' as never)).toThrow(advice);
  expect(() => segmentAt(index, 10_000_000n as never)).toThrow(advice);
  expect(() => segmentAt(index, Number.NaN)).toThrow('dividing by a zero recordDurationSeconds');
});
