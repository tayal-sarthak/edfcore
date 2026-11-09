/**
 * A time spelled as text or as ticks, handed to `gapAt`.
 *
 * The advice was to "pass a number, the way segmentAt() requires one" — which a caller holding
 * `"12.5"` from a URL or `annotation.onsetTicksFromFirstRecord` already believes they did. Neither
 * needs computing differently; each needs converting.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, gapAt } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

it('sends text to Number() and ticks to the seconds beside them', async () => {
  const index = await buildRecordIndex(await openEdf(byteSource(minimalEdf())));
  const advice = 'Next: convert it first — Number(text) for a string, and for a tick count';
  expect(() => gapAt(index, '1' as never)).toThrow(advice);
  expect(() => gapAt(index, 10_000_000n as never)).toThrow(advice);
  expect(() => gapAt(index, Number.NaN)).toThrow('Next: pass a number, the way segmentAt()');
});
