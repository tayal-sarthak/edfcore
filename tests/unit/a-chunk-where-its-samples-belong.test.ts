/**
 * A whole chunk passed as the samples to convert.
 *
 * `toPhysical(signal, chunk)` is one level further out than `toPhysical(signal, chunkSignal)`,
 * which has been named since 0.6.128. The chunk itself was "an object, which has no length" —
 * true, and no help to a reader holding exactly what readWindow() gave them.
 */

import { describe, expect, it } from 'vitest';
import {
  byteSource,
  clampToDigitalRange,
  openEdf,
  readWindow,
  toPhysical,
} from '../../src/index.js';
import { minimalEdf } from '../support/writer.js';

async function firstChunk() {
  const recording = await openEdf(byteSource(minimalEdf()));
  const signal = recording.header.signals[0];
  if (signal === undefined) throw new Error('fixture has no signal');
  const [chunk] = await readWindow(recording, {
    signalIndices: [signal.index],
    startSeconds: 0,
    durationSeconds: 1,
  });
  if (chunk === undefined) throw new Error('fixture has no chunk');
  return { signal, chunk };
}

describe('a chunk passed where its samples belong', () => {
  it.each([
    ['toPhysical', toPhysical],
    ['clampToDigitalRange', clampToDigitalRange],
  ] as const)('%s() names it, and the field each of its signals carries', async (call, run) => {
    const { signal, chunk } = await firstChunk();
    expect(() => run(signal, chunk as never)).toThrow(
      `${call}(): the samples are a chunk, which carries one signal per element of .signals, ` +
        'each with its own .digital.',
    );
    expect(() => run(signal, chunk as never)).toThrow('Next: pass chunkSignal.digital');
  });

  it.each([
    ['toPhysical', toPhysical],
    ['clampToDigitalRange', clampToDigitalRange],
  ] as const)('%s() names the list readWindow() resolved to', async (call, run) => {
    const { signal, chunk } = await firstChunk();
    expect(() => run(signal, [chunk] as never)).toThrow(
      `${call}(): the samples are a list of chunks — what readWindow() resolves to`,
    );
    expect(() => run(signal, [chunk] as never)).not.toThrow('would be NaN');
  });

  it('still converts the samples the chunk carries', async () => {
    const { signal, chunk } = await firstChunk();
    const [series] = chunk.signals;
    if (series === undefined) throw new Error('chunk has no signal');
    expect(toPhysical(signal, series.digital)).toHaveLength(series.digital.length);
  });
});
