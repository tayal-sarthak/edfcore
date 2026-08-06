/**
 * segmentAt.
 *
 * `index.locate()` answers a similar question by probing the file. This one is pure, because a
 * viewer asks it on every mouse move and should not be issuing reads to do so.
 *
 * The refusals matter more than the hits. `undefined` from this function means "no records cover
 * this instant", and a probed index cannot say that about anything in the middle of the file, so
 * it must throw rather than return the answer it does not have.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, segmentAt } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecordIndex } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

/** Records 0-2 at t = 0,1,2; a five-second hole; records 3-5 at t = 8,9,10. */
async function scanned(): Promise<EdfRecordIndex> {
  const recording = await openEdf(
    byteSource(
      minimalEdfPlus({
        plus: 'D',
        recordCount: 6,
        recordDurationSeconds: 1,
        recordOnsetSeconds: (i: number) => (i < 3 ? i : i + 5),
      }),
    ),
  );
  return buildRecordIndex(recording);
}

describe('segmentAt finds the segment covering an instant', () => {
  it('agrees with the segments the scan produced, at every boundary', async () => {
    const index = await scanned();
    const segments = index.segments ?? [];
    expect(segments).toHaveLength(2);

    for (const segment of segments) {
      // Inclusive at the start, exclusive at the end — a segment that ends where the next begins
      // must not be both.
      expect(segmentAt(index, segment.startSeconds)).toBe(segment);
      expect(segmentAt(index, segment.endSeconds - 0.5)).toBe(segment);
      expect(segmentAt(index, segment.endSeconds)).not.toBe(segment);
    }
  });

  it('returns undefined inside a gap, where no record exists', async () => {
    const index = await scanned();
    const gap = (index.gaps ?? [])[0];
    expect(gap).toBeDefined();
    expect(segmentAt(index, 3)).toBeUndefined();
    expect(segmentAt(index, 5)).toBeUndefined();
    // The gap's own bounds: its start is the first instant with no record, its end the first with
    // one again.
    expect(segmentAt(index, gap?.startSeconds ?? 0)).toBeUndefined();
    expect(segmentAt(index, gap?.endSeconds ?? 0)).toBeDefined();
  });

  it('returns undefined before the first record and after the last', async () => {
    const index = await scanned();
    expect(segmentAt(index, -1)).toBeUndefined();
    expect(segmentAt(index, 11)).toBeUndefined();
    expect(segmentAt(index, 10.5)).toBeDefined();
  });

  it('checks every instant against a linear scan of the segments', async () => {
    // The binary search must agree with the obvious O(n) answer everywhere, boundaries included.
    const index = await scanned();
    const segments = index.segments ?? [];
    for (let tenths = -20; tenths <= 130; tenths += 1) {
      const seconds = tenths / 10;
      const expected = segments.find((s) => seconds >= s.startSeconds && seconds < s.endSeconds);
      expect(segmentAt(index, seconds), `at ${seconds}s`).toBe(expected);
    }
  });
});

describe('segmentAt refuses what it cannot answer', () => {
  it('throws on a probed index instead of reporting a gap nobody looked for', async () => {
    const recording = await openEdf(
      byteSource(minimalEdfPlus({ recordCount: 6, recordDurationSeconds: 1 })),
    );
    expect(recording.index.coverage).toBe('probed');
    expect(() => segmentAt(recording.index, 2)).toThrow(RangeError);
    expect(() => segmentAt(recording.index, 2)).toThrow(/buildRecordIndex/);
  });

  it('throws on a time that is not a time', async () => {
    // Every comparison against NaN is false, so the search would walk to an arbitrary segment and
    // return it as the answer.
    const index = await scanned();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => segmentAt(index, bad)).toThrow(RangeError);
    }
  });
});
