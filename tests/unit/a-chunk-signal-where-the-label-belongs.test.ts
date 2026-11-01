/**
 * A chunk signal handed to `getSignal` or `findSignals` where the label belongs.
 *
 * What a read hands back per channel is a chunk signal: the samples, and the `signalIndex` they
 * were read from. Looking up its declaration — for the scale, the unit — is the next step, and
 * `getSignal(header, series)` is the first spelling of it. It was told "the selector is an object"
 * and to pass the label as a string, which a chunk signal does not carry.
 */

import { describe, expect, it } from 'vitest';
import { findSignals, getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
});

describe('a chunk signal passed where the label belongs', () => {
  it.each([
    ['getSignal', getSignal],
    ['findSignals', findSignals],
  ] as const)('%s() points at header.signals[chunkSignal.signalIndex]', async (_call, call) => {
    const recording = await openEdf(byteSource(FILE));
    const [chunk] = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 1,
    });
    const series = chunk?.signals[0];
    expect(() => call(recording.header, series as never)).toThrow(
      'the selector is a chunk signal, which carries samples rather than a label. ' +
        'Next: use header.signals[chunkSignal.signalIndex]',
    );
  });
});
