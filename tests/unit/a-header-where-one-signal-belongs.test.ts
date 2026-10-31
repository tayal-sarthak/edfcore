/**
 * The header, or the recording, passed where one of its signals belongs.
 *
 * `toPhysical(header, digital)` and `physicalRangeOf(recording)` hand over the object that holds
 * every signal, and both were "an object, not one of header.signals" — which names the field to
 * look in without saying the argument was the thing that has it.
 */

import { describe, expect, it } from 'vitest';
import { byteSource, openEdf, physicalRangeOf, toPhysical } from '../../src/index.js';
import { minimalEdf } from '../support/writer.js';

const DIGITAL = new Int32Array([0, 1, 2]);

describe('a header or a recording passed as the signal', () => {
  it('names a header', async () => {
    const { header } = await openEdf(byteSource(minimalEdf()));
    expect(() => toPhysical(header as never, DIGITAL)).toThrow(
      'toPhysical(): the signal is a header, which carries one signal per element of .signals ' +
        'rather than being one.',
    );
    expect(() => physicalRangeOf(header as never)).toThrow('the signal is a header');
  });

  it('names a recording', async () => {
    const recording = await openEdf(byteSource(minimalEdf()));
    expect(() => toPhysical(recording as never, DIGITAL)).toThrow(
      'toPhysical(): the signal is a recording, whose header carries one signal per element of ' +
        '.signals.',
    );
    expect(() => physicalRangeOf(recording as never)).toThrow('the signal is a recording');
  });

  it('keeps the field it points at', async () => {
    const { header } = await openEdf(byteSource(minimalEdf()));
    expect(() => toPhysical(header as never, DIGITAL)).toThrow(
      'Next: pass header.signals[chunkSignal.signalIndex]',
    );
    expect(() => toPhysical({} as never, DIGITAL)).toThrow('an object, not one of header.signals');
  });
});
