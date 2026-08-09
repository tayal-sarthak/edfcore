/**
 * Record onsets to segments and gaps.
 *
 * Layer 4. Pure and synchronous, and structural only: it reports the shape the onsets actually
 * have and judges none of it. Monotonicity and the spacing rules belong to `time/timeline.ts`,
 * which is their sole owner — run `assertMonotonicOnsetArray` on the same array first, and every
 * segment then starts at or after the one before it.
 *
 * That is all monotonicity buys. It requires `onset[r] >= onset[r - 1]`, which an OVERLAP
 * satisfies: `onset[r]` can be at or after its predecessor and still before
 * `onset[r - 1] + recordDurationTicks`, and `buildSegmentation` then closes the earlier segment
 * past where the next one begins. The gap between them is negative, which is exactly what the
 * comment on `durationTicks` below says and what `index.gaps` reports for a real overlapping file.
 * This docblock claimed a gap "can then only have a non-negative duration" until 0.3.82, ninety
 * lines above the line saying otherwise.
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
      durationTicks,
      endSeconds: ticksToSeconds(endTicks),
      endTicks,
    });
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

  // The segments carry their own exact ends, so a gap is read straight off the two it joins —
  // it never re-derives a boundary, and never derives one from the seconds.
  const gaps: EdfGap[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    const before = segments[index - 1];
    const after = segments[index];
    if (before === undefined || after === undefined) continue;
    const startTicks = before.endTicks;
    const endTicks = after.startTicks;
    gaps.push({
      beforeSegmentIndex: index - 1,
      afterSegmentIndex: index,
      startSeconds: ticksToSeconds(startTicks),
      startTicks,
      endSeconds: ticksToSeconds(endTicks),
      endTicks,
      // Negative for an overlap. The subtraction is exact, so a sum over gaps is too.
      durationSeconds: ticksToSeconds(endTicks - startTicks),
      durationTicks: endTicks - startTicks,
    });
  }

  return { segments: Object.freeze(segments), gaps: Object.freeze(gaps) };
}
