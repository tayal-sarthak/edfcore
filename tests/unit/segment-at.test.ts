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
import { buildRecordIndex, gapAt, segmentAt } from '../../src/record-index.js';
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

describe('gapAt is the complement of segmentAt', () => {
  it('returns the gap under an instant with no data, and its bounds', async () => {
    const index = await scanned();
    const gap = gapAt(index, 5);
    expect(gap).toBe((index.gaps ?? [])[0]);
    // What a viewer actually wanted when segmentAt said undefined.
    expect(gap?.durationSeconds).toBe(5);
    expect(gap?.endSeconds).toBe(8);
  });

  it('returns undefined wherever a record exists', async () => {
    const index = await scanned();
    expect(gapAt(index, 0)).toBeUndefined();
    expect(gapAt(index, 2.5)).toBeUndefined();
    expect(gapAt(index, 8)).toBeUndefined();
  });

  it('agrees with segmentAt on every instant: never both, never neither inside the span', async () => {
    const index = await scanned();
    for (let tenths = 0; tenths <= 110; tenths += 1) {
      const seconds = tenths / 10;
      const inSegment = segmentAt(index, seconds) !== undefined;
      const inGap = gapAt(index, seconds) !== undefined;
      // 11 s is the exclusive end of the recording, so neither covers it.
      const inside = seconds < 11;
      expect(inSegment && inGap, `both at ${seconds}s`).toBe(false);
      expect(inSegment || inGap, `neither at ${seconds}s`).toBe(inside);
    }
  });

  it('refuses a probed index and a non-finite time, as segmentAt does', async () => {
    const recording = await openEdf(
      byteSource(minimalEdfPlus({ recordCount: 6, recordDurationSeconds: 1 })),
    );
    expect(() => gapAt(recording.index, 2)).toThrow(/buildRecordIndex/);
    const index = await scanned();
    expect(() => gapAt(index, Number.NaN)).toThrow(RangeError);
  });
});

describe('the boundaries are decided in ticks', () => {
  // The seconds on a segment or a gap are float64 conversions of exact tick values, and a
  // boundary is where a lossy conversion decides the answer. `sampleAt` picks a segment through
  // `segmentAt` and then measures the offset from `segment.startTicks`, so the two must be
  // deciding the same question in the same units (fixed in 0.3.6).
  it('carries the exact ticks alongside every second', async () => {
    const index = await scanned();
    for (const segment of index.segments ?? []) {
      expect(segment.startSeconds).toBe(Number(segment.startTicks) / 1e7);
      expect(segment.endSeconds).toBe(Number(segment.endTicks) / 1e7);
      expect(segment.durationSeconds).toBe(Number(segment.durationTicks) / 1e7);
      // An end is a start plus a duration, exactly, with no float addition in between.
      expect(segment.endTicks).toBe(segment.startTicks + segment.durationTicks);
    }
    for (const gap of index.gaps ?? []) {
      expect(gap.startSeconds).toBe(Number(gap.startTicks) / 1e7);
      expect(gap.endSeconds).toBe(Number(gap.endTicks) / 1e7);
      expect(gap.durationTicks).toBe(gap.endTicks - gap.startTicks);
    }
  });

  it('reads a gap straight off the segments it joins', async () => {
    // The 5 s hole: segment 0 ends at 3 s and segment 1 starts at 8 s, to the tick.
    const index = await scanned();
    const [gap] = index.gaps ?? [];
    const segments = index.segments ?? [];
    if (gap === undefined) throw new Error('setup failed');
    expect(gap.startTicks).toBe(segments[0]?.endTicks);
    expect(gap.endTicks).toBe(segments[1]?.startTicks);
    expect(gap.durationTicks).toBe(50_000_000n);
  });

  it('totals the time lost exactly, which summing the seconds does not promise', async () => {
    // The reason `durationTicks` is on the gap at all: summing float seconds accumulates error,
    // and this is the sum a caller writes to answer "how much of the recording is missing".
    const index = await scanned();
    const total = (index.gaps ?? []).reduce((sum, gap) => sum + gap.durationTicks, 0n);
    expect(total).toBe(50_000_000n);
  });

  it('is half-open on the tick, at both ends of a gap', async () => {
    const index = await scanned();
    const [gap] = index.gaps ?? [];
    if (gap === undefined) throw new Error('setup failed');
    const tick = 1 / 1e7;
    // The last instant with data belongs to the segment; the first instant of the hole does not.
    expect(segmentAt(index, gap.startSeconds - tick)).toBeDefined();
    expect(segmentAt(index, gap.startSeconds)).toBeUndefined();
    expect(gapAt(index, gap.startSeconds)).toBe(gap);
    // And the first instant with data again belongs to the next segment, not to the gap.
    expect(gapAt(index, gap.endSeconds - tick)).toBe(gap);
    expect(gapAt(index, gap.endSeconds)).toBeUndefined();
    expect(segmentAt(index, gap.endSeconds)?.index).toBe(1);
  });
});
