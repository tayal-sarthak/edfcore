/**
 * The ELEMENTS of the array `mergeChunks` takes.
 *
 * 0.6.141 guarded the argument itself and named one wrong value in particular: "one chunk rather
 * than an array of them", which is what a caller who has only ever seen a continuous file writes.
 * An array of the wrong thing walks straight through that guard, because it is an array.
 *
 * `mergeChunks(chunk.signals)` is the mistake this leaves. `chunk.signals` is an array;
 * `EdfChunkSignal` carries `startSeconds` and `startTicks` under the same names `EdfChunk` does;
 * and "merge the chunk's signals" is a sentence a caller writes.
 *
 * What it did depended on how many channels were selected, which is the part that matters:
 *
 *   - one signal — a viewer drawing one trace — gave an array of length 1, and `mergeChunks`
 *     returns a single-element array's element unchecked, so the CHUNK SIGNAL came back typed as
 *     an `EdfChunk`, with no `signals` and no `durationSeconds` on it;
 *   - two signals reached `previous.records.start` and threw V8's "Cannot read properties of
 *     undefined (reading 'start')" — an internal field name, no `Next:` clause.
 *
 * One mistake, silently accepted or reported with an internal name depending on the selection.
 */

import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfChunk } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'C3', samplesPerRecord: 8 },
  ],
});

async function chunkOf(signalIndices: readonly number[]): Promise<EdfChunk> {
  const recording = await openEdf(byteSource(FILE));
  return readRecords(recording, { signalIndices, records: { start: 0, count: 2 } });
}

const merge = (chunks: unknown): unknown =>
  (mergeChunks as unknown as (c: unknown) => unknown)(chunks);

describe.each([
  ['one signal, where the array has length 1 and was returned as-is', [0]],
  ['two signals, where the join threw an internal field name', [0, 1]],
])('mergeChunks(chunk.signals) on a read of %s', (_name, signalIndices) => {
  it('is refused rather than merged', async () => {
    const chunk = await chunkOf(signalIndices);
    expect(() => merge(chunk.signals)).toThrow();
  });

  it('says a signal is not a chunk, and where to get chunks', async () => {
    const chunk = await chunkOf(signalIndices);
    try {
      merge(chunk.signals);
      expect.unreachable('a chunk signal must not be accepted where a chunk belongs');
    } catch (error) {
      expect((error as Error).message).toContain('one signal of a chunk rather than a chunk');
      expect((error as Error).message).toContain('readWindow()');
      // Never V8's, which is what the two-signal case used to throw.
      expect((error as Error).message).not.toContain('Cannot read properties');
    }
  });
});

describe('the arrays mergeChunks does take', () => {
  it('still returns a single chunk as-is', async () => {
    const chunk = await chunkOf([0, 1]);
    expect(mergeChunks([chunk])).toBe(chunk);
  });

  it('still joins two adjacent chunks', async () => {
    const recording = await openEdf(byteSource(FILE));
    const first = await readRecords(recording, {
      signalIndices: [0],
      records: { start: 0, count: 2 },
    });
    const second = await readRecords(recording, {
      signalIndices: [0],
      records: { start: 2, count: 2 },
    });
    expect(mergeChunks([first, second]).signals[0]?.sampleCount).toBe(32);
  });

  it('still names a hole rather than the kind of what is in it', async () => {
    const chunk = await chunkOf([0]);
    expect(() => merge([chunk, undefined])).toThrow(/no chunk at 1/);
  });
});
