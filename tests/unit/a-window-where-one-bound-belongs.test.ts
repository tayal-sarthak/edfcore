/**
 * A time window handed where one of its bounds belongs.
 *
 * `trimToWindow` and `resolveTimeWindow` take `startSeconds` and `durationSeconds` as two
 * arguments, and `readWindow` takes them as one object — so the object is what arrives in the
 * first slot. It was told it "was given an object" and to convert it with `Number(text)`.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { resolveTimeWindow, trimToWindow } from '../../src/time/window.js';
import { minimalEdf } from '../support/writer.js';

const WINDOW = { startSeconds: 0, durationSeconds: 1 };

describe('a window passed as startSeconds', () => {
  it('trimToWindow() names it and its two fields', async () => {
    const recording = await openEdf(byteSource(minimalEdf()));
    const [chunk] = await readWindow(recording, { signalIndices: [0], ...WINDOW });
    const series = chunk?.signals[0];
    expect(() =>
      trimToWindow(recording.header, series as never, WINDOW as never, undefined as never),
    ).toThrow(
      'startSeconds must be a number of seconds, and was given a time window. Next: pass the ' +
        'field you mean — window.startSeconds or window.durationSeconds — rather than the window.',
    );
  });

  it('resolveTimeWindow() says the same', async () => {
    const recording = await openEdf(byteSource(minimalEdf()));
    expect(() =>
      resolveTimeWindow(recording.timeline, recording.index, WINDOW as never, 1),
    ).toThrow('was given a time window');
  });
});
