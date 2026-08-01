/**
 * Record onsets to segments and gaps.
 *
 * Layer 4. Pure and synchronous, and structural only: it reports the shape the onsets actually
 * have and judges none of it. Monotonicity and the spacing rules belong to `time/timeline.ts`,
 * which is their sole owner — run `assertMonotonicOnsetArray` on the same array first, and a gap
 * can then only have a non-negative duration.
 *
 * Only `buildRecordIndex` calls this, because only a complete traversal has every onset. The
 * boundary rule is the one edfcore states everywhere else: a new segment starts wherever
 * `onset[r] !== onset[r - 1] + recordDurationTicks`, in exact ticks. Not "differs by more than an
 * epsilon" — a float tolerance is how a one-sample overlap becomes invisible.
 *
 * Every second here is elapsed recording time, measured from record 0's start (see
 * `time/timeline.ts`), so `segment.startTicks` is the rebased value and
 * `ticksToSeconds(segment.startTicks) === segment.startSeconds` holds by construction.
 */

import { ticksToSeconds } from '../tal/ticks.js';
import type { EdfGap, EdfSegment } from '../types.js';

export interface Segmentation {
  /** In time order, contiguous within each entry, and covering every record exactly once. */
  readonly segments: readonly EdfSegment[];
  /** One per adjacent pair of segments, so `gaps.length === segments.length - 1` (or 0). */
  readonly gaps: readonly EdfGap[];
}

const EMPTY_SEGMENTATION: Segmentation = Object.freeze({
  segments: Object.freeze([]),
  gaps: Object.freeze([]),
});

/** A segment's two ends in exact ticks, kept while building so gaps never re-derive them. */
interface SegmentBounds {
  readonly startTicks: bigint;
  readonly endTicks: bigint;
}

/**
 * `onsetTicks` holds one entry per record, record 0 first — the `BigInt64Array` that
 * `decodeAnnotations` returns for a full-file range fits directly.
 *
 * `originTicks` is the tick value that maps to `0` seconds. It defaults to `onsetTicks[0]`,
 * which is record 0's own onset and therefore the recording's sub-second start offset.
 */
export function buildSegmentation(
  onsetTicks: ArrayLike<bigint>,
  recordDurationTicks: bigint,
  originTicks?: bigint,
): Segmentation {
  const recordCount = onsetTicks.length;
  if (recordCount === 0) return EMPTY_SEGMENTATION;

  const firstOnset = onsetTicks[0];
  if (firstOnset === undefined) return EMPTY_SEGMENTATION;
  const origin = originTicks ?? firstOnset;

  const segments: EdfSegment[] = [];
  const bounds: SegmentBounds[] = [];

  let segmentStart = 0;
  let segmentStartTicks = firstOnset;

  const closeSegment = (endExclusive: number): void => {
    const count = endExclusive - segmentStart;
    const startTicks = segmentStartTicks - origin;
    const durationTicks = BigInt(count) * recordDurationTicks;
    const endTicks = startTicks + durationTicks;
    segments.push({
      index: segments.length,
      records: { start: segmentStart, count },
      startSeconds: ticksToSeconds(startTicks),
      startTicks,
      durationSeconds: ticksToSeconds(durationTicks),
      endSeconds: ticksToSeconds(endTicks),
    });
    bounds.push({ startTicks, endTicks });
  };

  for (let record = 1; record < recordCount; record += 1) {
    const previous = onsetTicks[record - 1];
    const current = onsetTicks[record];
    // A missing entry cannot happen for a BigInt64Array of this length; skipping rather than
    // asserting keeps a hand-built ArrayLike from turning a structural walk into a throw.
    if (previous === undefined || current === undefined) continue;
    if (current === previous + recordDurationTicks) continue;
    closeSegment(record);
    segmentStart = record;
    segmentStartTicks = current;
  }
  closeSegment(recordCount);

  const gaps: EdfGap[] = [];
  for (let index = 1; index < bounds.length; index += 1) {
    const before = bounds[index - 1];
    const after = bounds[index];
    if (before === undefined || after === undefined) continue;
    gaps.push({
      beforeSegmentIndex: index - 1,
      afterSegmentIndex: index,
      startSeconds: ticksToSeconds(before.endTicks),
      endSeconds: ticksToSeconds(after.startTicks),
      durationSeconds: ticksToSeconds(after.startTicks - before.endTicks),
    });
  }

  return { segments: Object.freeze(segments), gaps: Object.freeze(gaps) };
}
