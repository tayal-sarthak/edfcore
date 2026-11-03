/**
 * A signal's INDEX handed to the scaling calls in place of the signal.
 *
 * Every read selects by index, so the index is the number a caller holds when `toPhysical(0,
 * digital)` gets written. The refusal sent them to `header.signals[chunkSignal.signalIndex]` — an
 * expression about a chunk signal they did not pass — when the element to use is the one their
 * own number names.
 */

import { expect, it } from 'vitest';
import { physicalRangeOf, toPhysical } from '../../../src/decode/physical.js';

it('toPhysical() spells the element an index names', () => {
  expect(() => toPhysical(2 as never, new Int32Array(1))).toThrow(
    'toPhysical(): the signal is 2, not one of header.signals. Next: pass header.signals[2]',
  );
});

it('physicalRangeOf() keeps the chunk-signal expression for a value that is not an index', () => {
  expect(() => physicalRangeOf(-1 as never)).toThrow('header.signals[chunkSignal.signalIndex]');
});
