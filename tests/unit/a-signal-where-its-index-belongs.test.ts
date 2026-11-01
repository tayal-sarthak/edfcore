/**
 * A signal handed to the sample locators where its index belongs.
 *
 * `getSignal(header, 'A1')` is how a channel is found, and what it returns is the signal — so
 * `sampleAt(recording, getSignal(header, 'A1'), t)` is the line written next. It was told the
 * object is "not a number this header can be indexed by" and then to resolve one with `getSignal`,
 * the call that had just produced it.
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { sampleAt, sampleStartSecondsOf, sampleStartTicksOf } from '../../src/sample-locate.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

describe('a signal passed where its index belongs', () => {
  it.each([
    ['sampleAt', sampleAt],
    ['sampleStartTicksOf', sampleStartTicksOf],
    ['sampleStartSecondsOf', sampleStartSecondsOf],
  ] as const)('%s() says to pass signal.index', async (_call, call) => {
    const recording = await openEdf(byteSource(FILE));
    const signal = getSignal(recording.header, 'A1');
    expect(() => call(recording, signal as never, 0)).toThrow(
      'Next: that is a signal already — pass signal.index, which is 0.',
    );
  });
});
