/**
 * The argument of `mergeChunks`, before a length is read off it.
 *
 * `readWindow` resolves to one chunk per contiguous run, and on a continuous file — which is most
 * files — that is an array of exactly one. A caller who has only ever seen one chunk holds a
 * chunk, not a list, so `mergeChunks(chunk)` is the call that gets written.
 *
 * `chunks.length` was then `undefined`, which is not `0`, so the empty-list branch did not fire;
 * `at(chunks, 0)` did, and refused with "no chunk at 0. Next: pass the array readWindow() returned,
 * with no holes and nothing spliced out of it" — a message about holes in an array, addressed to
 * someone who never had an array. `null`, which a config-driven pipeline produces as readily, did
 * not reach even that: `Cannot read properties of null (reading 'length')`.
 *
 * Every other refusal in this file names a specific reason two chunks do not join. This one names
 * the argument.
 */

import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfChunk } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function oneChunk(): Promise<EdfChunk> {
  const recording = await openEdf(byteSource(FILE));
  return readRecords(recording, { signalIndices: [0], records: { start: 0, count: 4 } });
}

const merge =
  (chunks: unknown): (() => unknown) =>
  () =>
    (mergeChunks as unknown as (c: unknown) => unknown)(chunks);

describe('mergeChunks given one chunk', () => {
  it('throws a RangeError', async () => {
    expect(merge(await oneChunk())).toThrow(RangeError);
  });

  it('is a caller mistake, so isEdfError says false', async () => {
    let thrown: unknown;
    try {
      merge(await oneChunk())();
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('says it was handed one chunk rather than an array of them', async () => {
    expect(merge(await oneChunk())).toThrow(
      /^mergeChunks: the chunks are one chunk rather than an array of them\./,
    );
  });

  it('says nothing about holes in an array the caller never had', async () => {
    const chunk = await oneChunk();
    expect(merge(chunk)).not.toThrow(/no chunk at 0|nothing spliced out of it/);
  });

  it('points at the array readWindow returns, and says it holds one on a continuous file', async () => {
    expect(merge(await oneChunk())).toThrow(
      /Next: pass what readWindow\(\) resolved to — it is the array this takes even on a continuous file, where it holds exactly one chunk\.$/,
    );
  });
});

describe('mergeChunks given something that is no list at all', () => {
  it.each([
    [null, 'the chunks are null, not an array'],
    [undefined, 'the chunks are undefined, not an array'],
  ])('%s is named as itself rather than dereferenced', (value, expected) => {
    expect(merge(value)).toThrow(RangeError);
    expect(merge(value)).toThrow(expected);
    expect(merge(value)).not.toThrow(/Cannot read properties/);
  });
});

describe('the array itself still behaves exactly as before', () => {
  it('returns a lone chunk as-is and still refuses an empty list on its own terms', async () => {
    const chunk = await oneChunk();
    expect(mergeChunks([chunk])).toBe(chunk);
    expect(() => mergeChunks([])).toThrow(/mergeChunks: nothing to merge/);
  });
});
