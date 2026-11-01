/**
 * A signal handed to `decodeDigital` where its index belongs.
 *
 * The primitive's fourth argument is a number, and the object every lookup returns is the signal
 * that number indexes. `decodeDigital(header, bytes, records, getSignal(header, 'A1'))` was told
 * the object is "not a number this header can be indexed by" and to resolve one with `getSignal`
 * — the call it had come from.
 */

import { expect, it } from 'vitest';
import { decodeDigital } from '../../../src/decode/digital.js';
import { getSignal } from '../../../src/header/lookup.js';
import { parseHeader } from '../../../src/header/parse.js';
import { buildEdf } from '../../support/writer.js';

it('decodeDigital() says to pass signal.index', () => {
  const file = buildEdf({
    format: 'EDF',
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [
      { label: 'X', samplesPerRecord: 2 },
      { label: 'A1', samplesPerRecord: 4 },
    ],
  });
  const header = parseHeader(file, file.byteLength);
  const records = file.subarray(header.headerByteLength);
  const signal = getSignal(header, 'A1');
  expect(() => decodeDigital(header, records, { start: 0, count: 1 }, signal as never)).toThrow(
    'Next: that is a signal already — pass signal.index, which is 1.',
  );
});
