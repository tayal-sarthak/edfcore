/**
 * `trimToWindow` handed a header signal where a chunk signal belongs.
 *
 * This package has two per-signal shapes and they name the index differently: `EdfSignal.index`
 * describes a channel the header declares, and `EdfChunkSignal.signalIndex` describes the samples a
 * read returned for one. The header's is the one a reader already holds — `getSignal(header, 'Fp1')`
 * hands it over — so passing it here is the natural mistake.
 *
 * It sent `undefined` into `signalAt`, and the refusal that came back was about the OTHER argument:
 * "signalIndex undefined is not one of the 7 signals in this header, so trimToWindow() cannot know
 * how many samples per record it holds. Next: pass the header the chunk was read with." The header
 * was the argument that was right (fixed in 0.6.97).
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../../src/header/lookup.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf, readWindow } from '../../../src/recording.js';
import { trimToWindow } from '../../../src/time/window.js';
import type { EdfChunkSignal } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const BYTES = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Fp2', samplesPerRecord: 8 },
  ],
});

async function parts() {
  const recording = await openEdf(byteSource(BYTES));
  const chunks = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 4,
  });
  const chunkSignal = chunks[0]?.signals[0] as EdfChunkSignal;
  return { header: recording.header, chunkSignal };
}

/** The cast a JavaScript caller does not need to write. */
const asChunkSignal = (value: unknown) => value as EdfChunkSignal;

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the argument was accepted');
}

describe('a header signal', () => {
  it('is named as the argument that is wrong', async () => {
    const { header } = await parts();
    const message = refusal(() =>
      trimToWindow(header, asChunkSignal(getSignal(header, 'Fp1')), 0, 1),
    );
    expect(message).toContain('trimToWindow(): the second argument is a header signal');
    expect(message).toContain('carries no samples to trim');
  });

  it('no longer sends the reader to fix the header, which was right', async () => {
    const { header } = await parts();
    const message = refusal(() =>
      trimToWindow(header, asChunkSignal(getSignal(header, 'Fp1')), 0, 1),
    );
    expect(message).not.toContain('pass the header the chunk was read with');
    expect(message).not.toContain('is not one of the 2 signals');
  });

  it('names where a chunk signal comes from', async () => {
    const { header } = await parts();
    const message = refusal(() => trimToWindow(header, asChunkSignal(header.signals[1]), 0, 1));
    expect(message).toContain('Next: pass one element of chunk.signals');
    expect(message).toContain('readWindow()');
  });
});

describe('the other wrong second arguments', () => {
  it.each([
    ['missing', undefined],
    ['null', null],
    ['the chunk itself rather than one of its signals', 'chunk'],
  ])('says %s has no signalIndex', async (_described, given) => {
    const { header, chunkSignal } = await parts();
    const value = given === 'chunk' ? { signals: [chunkSignal] } : given;
    expect(refusal(() => trimToWindow(header, asChunkSignal(value), 0, 1))).toContain(
      'with no signalIndex on it',
    );
  });
});

describe('a real chunk signal', () => {
  it('still trims, and the header index it is looked up by is still checked', async () => {
    const { header, chunkSignal } = await parts();
    expect(trimToWindow(header, chunkSignal, 1, 1).sampleCount).toBe(8);
    expect(() => trimToWindow(header, { ...chunkSignal, signalIndex: 9 }, 0, 1)).toThrow(
      /not one of the 2 signals in this header/,
    );
  });
});
