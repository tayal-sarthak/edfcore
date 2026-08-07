/**
 * `time/segments.ts` — record onsets to segments and gaps, and nothing else.
 *
 * Pure and structural: it reports the shape the onsets have and judges none of it (monotonicity
 * and spacing belong to `time/timeline.ts`). The boundary rule under test is exact:
 * a new segment starts wherever `onset[r] !== onset[r-1] + recordDurationTicks` in TICKS — not
 * "differs by more than an epsilon", because a float tolerance is how a one-sample overlap
 * becomes invisible.
 *
 * Every second reported here is elapsed recording time measured from record 0's start, so
 * `ticksToSeconds(segment.startTicks) === segment.startSeconds` holds by construction and the
 * assertions below check both halves against each other.
 */

import { describe, expect, it } from 'vitest';
import { buildSegmentation } from '../../../src/time/segments.js';
import type { EdfSegment } from '../../../src/types.js';

/** 100 ns ticks per second, spelled out so the tests do not import the constant they pin. */
const SECOND = 10_000_000n;

/** Onsets on a perfect grid: `count` records of `durationTicks` starting at `startTicks`. */
function grid(startTicks: bigint, durationTicks: bigint, count: number): bigint[] {
  return Array.from({ length: count }, (_, r) => startTicks + BigInt(r) * durationTicks);
}

function recordsOf(segments: readonly EdfSegment[]): Array<{ start: number; count: number }> {
  return segments.map((segment) => ({ ...segment.records }));
}

describe('a contiguous file is one segment and no gaps', () => {
  it('reports exactly one segment covering every record, and zero gaps', () => {
    const { segments, gaps } = buildSegmentation(grid(0n, SECOND, 10), SECOND);

    expect(segments).toHaveLength(1);
    expect(gaps).toHaveLength(0);
    expect(segments[0]).toEqual({
      index: 0,
      records: { start: 0, count: 10 },
      startSeconds: 0,
      startTicks: 0n,
      durationSeconds: 10,
      durationTicks: 10n * SECOND,
      endSeconds: 10,
      endTicks: 10n * SECOND,
    });
  });

  it('is still one segment when the records are zero-duration, which EDF permits', () => {
    // recordDuration = 0 is legal (the PhysioNet hypnograms use it): every record shares one
    // onset, and `onset[r] === onset[r-1] + 0` holds, so nothing is a boundary.
    const { segments, gaps } = buildSegmentation([0n, 0n, 0n], 0n);

    expect(recordsOf(segments)).toEqual([{ start: 0, count: 3 }]);
    expect(gaps).toHaveLength(0);
    expect(segments[0]?.durationSeconds).toBe(0);
  });

  it('rebases to record 0 by default, so a sub-second start offset does not shift the axis', () => {
    // t = 0 is the START OF RECORD 0, not the header start time; the default origin is
    // onsetTicks[0], which is exactly the sub-second start offset.
    const onsets = grid(5_000_000n, SECOND, 3);

    expect(buildSegmentation(onsets, SECOND).segments[0]?.startSeconds).toBe(0);
    // An explicit origin of 0 measures from the header start instead.
    expect(buildSegmentation(onsets, SECOND, 0n).segments[0]?.startSeconds).toBe(0.5);
  });

  it('returns nothing for a file with no records', () => {
    const { segments, gaps } = buildSegmentation([], SECOND);

    expect(segments).toEqual([]);
    expect(gaps).toEqual([]);
  });
});

describe('a single-record file', () => {
  it('is one segment of one record with no gaps', () => {
    const { segments, gaps } = buildSegmentation([0n], SECOND);

    expect(gaps).toHaveLength(0);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.records).toEqual({ start: 0, count: 1 });
    expect(segments[0]?.durationSeconds).toBe(1);
    expect(segments[0]?.endSeconds).toBe(1);
  });
});

describe('a gap between the first two records', () => {
  // Records at 0 s, 5 s, 6 s with a 1 s record: the boundary is at record index 1, so the first
  // segment holds record 0 alone. An off-by-one here would silently attach record 1 to it.
  const { segments, gaps } = buildSegmentation([0n, 5n * SECOND, 6n * SECOND], SECOND);

  it('splits at record 1, not at record 0 or record 2', () => {
    expect(recordsOf(segments)).toEqual([
      { start: 0, count: 1 },
      { start: 1, count: 2 },
    ]);
  });

  it('reports one gap between the two segments, measured end to start', () => {
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({
      beforeSegmentIndex: 0,
      afterSegmentIndex: 1,
      startSeconds: 1, // record 0 ends at 1 s...
      startTicks: SECOND,
      endSeconds: 5, // ...and record 1 starts at 5 s.
      endTicks: 5n * SECOND,
      durationSeconds: 4,
      durationTicks: 4n * SECOND,
    });
  });
});

describe('the MSLT pattern from DESIGN section 7', () => {
  // Five 20-minute segments two hours apart — a Multiple Sleep Latency Test, the canonical real
  // EDF+D shape. 30 s records, 40 records per nap, so each segment is 1200 s of coverage inside
  // a 7200 s stride, leaving a 6000 s gap between consecutive naps.
  const RECORD = 30n * SECOND;
  const RECORDS_PER_NAP = 40;
  const NAP_COUNT = 5;
  const STRIDE = 7200n * SECOND;

  const onsets = Array.from({ length: NAP_COUNT }, (_, nap) =>
    grid(BigInt(nap) * STRIDE, RECORD, RECORDS_PER_NAP),
  ).flat();

  const { segments, gaps } = buildSegmentation(onsets, RECORD);

  it('finds five segments and four gaps', () => {
    expect(onsets).toHaveLength(200);
    expect(segments).toHaveLength(5);
    expect(gaps).toHaveLength(4);
    // The interface contract: one gap per adjacent pair of segments.
    expect(gaps).toHaveLength(segments.length - 1);
  });

  it('puts every segment on the right records and the right seconds', () => {
    expect(segments).toEqual(
      Array.from({ length: NAP_COUNT }, (_, nap) => ({
        index: nap,
        records: { start: nap * RECORDS_PER_NAP, count: RECORDS_PER_NAP },
        startSeconds: nap * 7200,
        startTicks: BigInt(nap) * STRIDE,
        durationSeconds: 1200,
        durationTicks: BigInt(RECORDS_PER_NAP) * RECORD,
        endSeconds: nap * 7200 + 1200,
        endTicks: BigInt(nap) * STRIDE + BigInt(RECORDS_PER_NAP) * RECORD,
      })),
    );
  });

  it('reports each gap with its duration and the segments it sits between', () => {
    expect(gaps).toEqual(
      Array.from({ length: NAP_COUNT - 1 }, (_, index) => ({
        beforeSegmentIndex: index,
        afterSegmentIndex: index + 1,
        startSeconds: index * 7200 + 1200,
        startTicks: BigInt(index * 7200 + 1200) * SECOND,
        endSeconds: (index + 1) * 7200,
        endTicks: BigInt(index + 1) * STRIDE,
        durationSeconds: 6000,
        durationTicks: 6000n * SECOND,
      })),
    );
  });

  it('covers every record exactly once, in time order', () => {
    let nextRecord = 0;
    let previousEnd = Number.NEGATIVE_INFINITY;
    for (const segment of segments) {
      expect(segment.records.start).toBe(nextRecord);
      expect(segment.startSeconds).toBeGreaterThan(previousEnd);
      nextRecord += segment.records.count;
      previousEnd = segment.endSeconds;
    }
    expect(nextRecord).toBe(onsets.length);
  });

  it('keeps seconds and ticks consistent on every segment and gap', () => {
    for (const segment of segments) {
      // startTicks is the rebased value; startSeconds is that same number in seconds.
      expect(segment.startSeconds).toBe(Number(segment.startTicks) / 1e7);
      expect(segment.endSeconds - segment.startSeconds).toBe(segment.durationSeconds);
      expect(segment.durationSeconds).toBe((segment.records.count * Number(RECORD)) / 1e7);
    }
    for (const gap of gaps) {
      expect(gap.endSeconds - gap.startSeconds).toBe(gap.durationSeconds);
      expect(gap.startSeconds).toBe(segments[gap.beforeSegmentIndex]?.endSeconds);
      expect(gap.endSeconds).toBe(segments[gap.afterSegmentIndex]?.startSeconds);
    }
  });
});

describe('the boundary test is exact, not approximate', () => {
  it('splits on a one-tick discrepancy — 100 ns is a gap', () => {
    // A float comparison with any tolerance at all would merge these two records.
    const { segments, gaps } = buildSegmentation([0n, SECOND + 1n], SECOND);

    expect(recordsOf(segments)).toEqual([
      { start: 0, count: 1 },
      { start: 1, count: 1 },
    ]);
    expect(gaps[0]?.durationSeconds).toBe(1e-7);
  });

  it('reports an overlap as a negative gap rather than clamping it to zero', () => {
    // Onsets 0 s and 2 s with a 3 s record: monotonic, but record 1 starts before record 0 ends.
    // This module judges nothing — it reports the shape as it is, and
    // RECORD_ONSET_SPACING_VIOLATION (time/timeline.ts) is what names the violation.
    const { segments, gaps } = buildSegmentation([0n, 2n * SECOND], 3n * SECOND);

    expect(segments).toHaveLength(2);
    expect(gaps[0]?.startSeconds).toBe(3);
    expect(gaps[0]?.endSeconds).toBe(2);
    expect(gaps[0]?.durationSeconds).toBe(-1);
  });

  it('treats a repeated onset as a boundary once the record duration is non-zero', () => {
    // Two records claiming the same start is a total overlap, and it is still structure, not
    // an error, at this layer.
    const { segments } = buildSegmentation([0n, 0n], SECOND);

    expect(recordsOf(segments)).toEqual([
      { start: 0, count: 1 },
      { start: 1, count: 1 },
    ]);
  });
});
