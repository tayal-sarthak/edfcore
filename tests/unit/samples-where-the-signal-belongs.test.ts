/**
 * The two arguments of `toPhysical` the other way round.
 *
 * `toPhysical(digital, signal)` reads naturally — the samples, then what to scale them by — and it
 * was refused as "the signal is Int32Array, not one of header.signals", which says what the first
 * argument is not and leaves the reader to notice the second argument was the signal all along.
 */

import { describe, expect, it } from 'vitest';
import {
  byteSource,
  clampToDigitalRange,
  openEdf,
  physicalRangeOf,
  toPhysical,
} from '../../src/index.js';
import { minimalEdf } from '../support/writer.js';

const DIGITAL = new Int32Array([0, 1, 2]);

describe('the samples passed where the signal belongs', () => {
  it.each([
    ['toPhysical', toPhysical],
    ['clampToDigitalRange', clampToDigitalRange],
  ] as const)('%s() says the arguments are swapped', async (call, run) => {
    const { header } = await openEdf(byteSource(minimalEdf()));
    expect(() => run(DIGITAL as never, header.signals[0] as never)).toThrow(
      `${call}(): the signal is Int32Array — samples, which this call takes second, after the ` +
        'signal they are scaled by. Next: swap the two arguments',
    );
  });

  it('does not tell physicalRangeOf, which takes one argument, to swap them', () => {
    expect(() => physicalRangeOf(DIGITAL as never)).not.toThrow('swap');
  });
});
