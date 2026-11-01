/**
 * The header handed to the grid family where `header.recordDurationTicks` belongs.
 *
 * The third argument is named after a header field, and the header is what a caller has open
 * beside the signal — so `gridSampleIndexAt(signal, t, header)` is one property access short of
 * right. It was called "an object, not a BigInt", which says nothing about which object.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import {
  gridSampleIndexAt,
  gridSampleStartSeconds,
  gridSampleStartTicks,
} from '../../src/sample-grid.js';
import { minimalEdf } from '../support/writer.js';

describe('the header passed as recordDurationTicks', () => {
  it.each([
    ['gridSampleIndexAt', gridSampleIndexAt],
    ['gridSampleStartTicks', gridSampleStartTicks],
    ['gridSampleStartSeconds', gridSampleStartSeconds],
  ] as const)('%s() names it', (name, call) => {
    const file = minimalEdf();
    const header = parseHeader(file, file.byteLength);
    const signal = header.signals[0];
    expect(() => call(signal as never, 0, header as never)).toThrow(
      `${name}(): recordDurationTicks is the header, not a BigInt. ` +
        'Next: pass header.recordDurationTicks',
    );
  });
});
