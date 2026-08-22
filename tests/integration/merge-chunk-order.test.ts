/**
 * Two reads with the same channels in a different order, and a hole in the array.
 *
 * `mergeChunks` concatenates by position: signal `i` of the second chunk continues signal `i` of
 * the first. `merge-chunks.test.ts` pins the refusal when the two were read with a different
 * NUMBER of channels. The remaining way to get it wrong is subtler and more likely — the same
 * channels, in a different order.
 *
 * A caller reaches it without doing anything strange. `signalIndices` built from a `Set`, from
 * `Object.keys`, from a checkbox list re-rendered between reads, or from `getSignal` calls made in
 * whatever order the labels came back: all of them produce the same channels in an order nothing
 * promised to keep. Merging those without checking splices one electrode's samples onto another's
 * and hands back a chunk that looks entirely normal — right length, right record range, right
 * timestamps — with two channels swapped halfway through. There is no downstream check that would
 * catch it, because there is nothing wrong with the numbers, only with which channel they belong
 * to. On a montage that is the difference between a left-temporal seizure and a right-temporal one.
 *
 * The other refusal is the array itself. `mergeChunks` addresses its input by index, so a hole —
 * a `filter` that dropped a chunk, an element spliced out, a sparse literal — would read as
 * `undefined` and be dereferenced. It is refused by name instead, pointing at the array
 * `readWindow` returned.
 *
 * What this does NOT check: the merged samples of a correctly ordered pair. That is
 * `merge-chunks.test.ts`, which reproduces the file's samples through a merge; this file is about
 * the two ways the input can be wrong that the numbers cannot show.
 */

import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfChunk } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** Two data channels, so an order exists to get wrong, and six seconds to read in halves. */
const TWO_CHANNELS = buildEdf({
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [
    { label: 'T3-T5', samplesPerRecord: 4 },
    { label: 'T4-T6', samplesPerRecord: 4 },
  ],
});

async function halves(
  first: readonly number[],
  second: readonly number[],
): Promise<readonly EdfChunk[]> {
  const recording = await openEdf(byteSource(TWO_CHANNELS));
  const [a] = await readWindow(recording, {
    signalIndices: first,
    startSeconds: 0,
    durationSeconds: 3,
  });
  const [b] = await readWindow(recording, {
    signalIndices: second,
    startSeconds: 3,
    durationSeconds: 3,
  });
  return [a as EdfChunk, b as EdfChunk];
}

const refusal = (call: () => unknown): Error | undefined => {
  try {
    call();
    return undefined;
  } catch (thrown) {
    return thrown as Error;
  }
};

describe('the same channels in a different order', () => {
  it('is refused, naming the position and both signals', async () => {
    const chunks = await halves([0, 1], [1, 0]);
    const failure = refusal(() => mergeChunks(chunks));
    expect(failure).toBeInstanceOf(RangeError);
    expect(failure?.message).toContain('chunk 1 has signal 1 in position 0');
    expect(failure?.message).toContain('the chunk before it signal 0');
    // Says the rule, not only the mismatch: the count check passes here, and a reader who has
    // just satisfied that one needs to be told there is a second requirement.
    expect(failure?.message).toContain('same order too');
    expect(failure?.message).toContain('readWindow() preserves the order given');
  });

  it('is a different message from the one about a different count', async () => {
    const swapped = await halves([0, 1], [1, 0]);
    const narrowed = await halves([0, 1], [0]);
    const reordered = refusal(() => mergeChunks(swapped));
    const fewer = refusal(() => mergeChunks(narrowed));
    expect(fewer?.message).toContain('signal(s)');
    expect(reordered?.message).not.toContain('signal(s)');
  });

  it('merges the identical selection, so the check is about order and not about reading twice', async () => {
    const chunks = await halves([0, 1], [0, 1]);
    const merged = mergeChunks(chunks);
    expect(merged.records).toEqual({ start: 0, count: 6 });
    expect(merged.signals.map((one) => one.signalIndex)).toEqual([0, 1]);
    expect(merged.signals[0]?.digital).toHaveLength(24);
  });
});

describe('an array with a hole in it', () => {
  it('is refused by name rather than dereferenced', async () => {
    const chunks = await halves([0, 1], [0, 1]);
    // What a `filter` that dropped one leaves behind, or a sparse literal.
    const holed = [chunks[0], undefined, chunks[1]] as unknown as readonly EdfChunk[];
    const failure = refusal(() => mergeChunks(holed));
    expect(failure).toBeInstanceOf(RangeError);
    expect(failure?.message).toContain('no chunk at 1');
    // Points at where a correct array comes from, which is the only reliable way to get one.
    expect(failure?.message).toContain('the array readWindow() returned');
  });
});
