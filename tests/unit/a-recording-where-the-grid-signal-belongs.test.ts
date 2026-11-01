/**
 * A recording handed to the grid family where one of its signals belongs.
 *
 * The refusal explained itself as if every wrong signal were a chunk signal — "a chunk signal
 * carries the samples rather than the grid they sit on" — and sent the caller to
 * `chunkSignal.signalIndex`. A reader who passed the recording holds no chunk signal at all.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import {
  gridSampleIndexAt,
  gridSampleStartSeconds,
  gridSampleStartTicks,
} from '../../src/sample-grid.js';
import { minimalEdf } from '../support/writer.js';

describe('a recording passed as the signal', () => {
  it.each([
    ['gridSampleIndexAt', gridSampleIndexAt],
    ['gridSampleStartTicks', gridSampleStartTicks],
    ['gridSampleStartSeconds', gridSampleStartSeconds],
  ] as const)('%s() does not call it a chunk signal', async (name, call) => {
    const recording = await openEdf(byteSource(minimalEdf()));
    const ticks = recording.header.recordDurationTicks;
    let message = '';
    try {
      call(recording as never, 0, ticks);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      `${name}(): the signal is an object, not one of header.signals. ` +
        'Next: resolve it with getSignal(header, label).',
    );
  });
});
