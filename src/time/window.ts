/**
 * Windows in seconds, resolved to records and then to samples.
 *
 * Layer 4. Pure and synchronous, both halves of it. `resolveTimeWindow` answers "which records
 * does this window cost?" before a byte is read, so the price of a window is auditable rather
 * than discovered; `trimToWindow` narrows a record-aligned chunk to the samples actually asked
 * for.
 *
 * The window is the half-open interval `[startSeconds, startSeconds + durationSeconds)` in
 * elapsed recording time — `t = 0` is the start of record 0, the axis `time/timeline.ts` fixes.
 *
 * Every comparison below is integer or rational arithmetic on ticks, records and
 * `samplesPerRecord`. `round(t * sampleRateHz)` appears nowhere: `sampleRateHz` is derived and
 * often not representable (256/3 Hz is a real record duration of 3 s with 256 samples), so
 * rounding through it walks the answer off by a sample near every large `t` — which is the exact
 * mistake edfcore exists to stop a consumer from re-implementing.
 */

import { TICKS_PER_SECOND } from '../constants.js';
import { EdfChannelNotFoundError } from '../errors.js';
import { secondsToTicks, ticksToSeconds } from '../tal/ticks.js';
import type {
  EdfChunkSignal,
  EdfHeader,
  EdfRecordIndex,
  EdfSignal,
  EdfTimeline,
  RecordRange,
} from '../types.js';

const NO_RANGES: readonly RecordRange[] = Object.freeze([]);

/** Exact: 10^7 is far below 2^53. */
const TICKS_PER_SECOND_FLOAT = Number(TICKS_PER_SECOND);

/** `b` must be positive. Bigint `/` truncates toward zero, so negatives need the correction. */
function floorDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b === 0n || a > 0n ? quotient : quotient - 1n;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b === 0n || a < 0n ? quotient : quotient + 1n;
}

/** Clamping in bigint first, because `Number()` on a large bigint silently loses digits. */
function clampToInt(value: bigint, low: number, high: number): number {
  if (value <= BigInt(low)) return low;
  if (value >= BigInt(high)) return high;
  return Number(value);
}

/**
 * The record duration in exact ticks, recovered from the timeline's float.
 *
 * `resolveTimeWindow`'s signature takes no header, so `header.recordDurationTicks` is not
 * available here. The round-trip is exact anyway: the seconds value was itself produced from a
 * header field of at most a few decimals, and `secondsToTicks` rounds to the nearest tick, so
 * every duration a file can declare below ~10^9 s comes back to the tick it came from.
 */
function recordDurationTicksOf(timeline: EdfTimeline): bigint {
  return secondsToTicks(timeline.recordDurationSeconds);
}

function signalAt(header: EdfHeader, signalIndex: number): EdfSignal {
  const signal = header.signals[signalIndex];
  if (signal !== undefined) return signal;
  throw new EdfChannelNotFoundError(
    `signalIndex ${signalIndex} is not one of the ${header.signals.length} signals in this ` +
      'header, so trimToWindow() cannot know how many samples per record it holds. Next: pass ' +
      'the header the chunk was read with.',
    { selector: signalIndex, availableLabels: header.signals.map((s) => s.label) },
  );
}

/**
 * The records a window needs, one `RecordRange` per contiguous run it overlaps, in time order.
 *
 * Empty when the window falls entirely inside a gap, entirely outside the recording, or has a
 * non-positive duration — the interval is half-open, so a zero-length window contains no time
 * and therefore no samples.
 *
 * Ranges are RECORD-ALIGNED and are therefore usually wider than the window: a record is the
 * smallest unit the file can be read by, and `trimToWindow` is how a caller narrows the samples
 * afterwards.
 *
 * With `index.segments` present (`coverage === 'complete'`) the answer is exact. With a probed
 * index it is exact only while the file is contiguous, which is precisely what
 * `spanSeconds === coveredSeconds` states; when it is not, the records a window maps to depend
 * on onsets nobody has read, and this function refuses rather than guessing them.
 */
export function resolveTimeWindow(
  timeline: EdfTimeline,
  index: EdfRecordIndex,
  startSeconds: number,
  durationSeconds: number,
): readonly RecordRange[] {
  const recordCount = timeline.recordCount;
  if (recordCount <= 0) return NO_RANGES;

  const windowStartTicks = secondsToTicks(startSeconds);
  const windowDurationTicks = secondsToTicks(durationSeconds);
  if (windowDurationTicks <= 0n) return NO_RANGES;
  const windowEndTicks = windowStartTicks + windowDurationTicks;

  const durationTicks = recordDurationTicksOf(timeline);
  const segments = index.segments;
  if (segments !== undefined) {
    const ranges: RecordRange[] = [];
    for (const segment of segments) {
      const segmentCount = segment.records.count;
      if (segmentCount <= 0) continue;
      const segmentStartTicks = segment.startTicks;

      // A zero record duration puts every record of the segment at one instant, so the segment
      // is either wholly inside the window or wholly outside it.
      if (durationTicks === 0n) {
        if (windowStartTicks <= segmentStartTicks && segmentStartTicks < windowEndTicks) {
          ranges.push({ start: segment.records.start, count: segmentCount });
        }
        continue;
      }

      const segmentEndTicks = segmentStartTicks + BigInt(segmentCount) * durationTicks;
      if (segmentEndTicks <= windowStartTicks || segmentStartTicks >= windowEndTicks) continue;

      const firstOffset = clampToInt(
        floorDiv(windowStartTicks - segmentStartTicks, durationTicks),
        0,
        segmentCount - 1,
      );
      const lastOffset = clampToInt(
        ceilDiv(windowEndTicks - segmentStartTicks, durationTicks) - 1n,
        0,
        segmentCount - 1,
      );
      if (lastOffset < firstOffset) continue;
      ranges.push({
        start: segment.records.start + firstOffset,
        count: lastOffset - firstOffset + 1,
      });
    }
    return Object.freeze(ranges);
  }

  if (timeline.spanSeconds !== timeline.coveredSeconds) {
    throw new RangeError(
      `resolveTimeWindow() cannot map seconds to records on this file: its ${recordCount} ` +
        `records span ${timeline.spanSeconds} s but cover only ${timeline.coveredSeconds} s, so ` +
        'it contains at least one gap, and a probed index knows where neither the gap nor the ' +
        'records after it start. Next: await buildRecordIndex(recording) and pass the index it ' +
        'returns, or locate the window with index.locate(seconds).',
    );
  }

  // Contiguous as far as the probes can tell: record r starts at exactly r * recordDuration.
  if (durationTicks === 0n) {
    return windowStartTicks <= 0n && windowEndTicks > 0n
      ? Object.freeze([{ start: 0, count: recordCount }])
      : NO_RANGES;
  }
  if (windowEndTicks <= 0n) return NO_RANGES;
  if (windowStartTicks >= BigInt(recordCount) * durationTicks) return NO_RANGES;
  const first = clampToInt(floorDiv(windowStartTicks, durationTicks), 0, recordCount - 1);
  const last = clampToInt(ceilDiv(windowEndTicks, durationTicks) - 1n, 0, recordCount - 1);
  if (last < first) return NO_RANGES;
  return Object.freeze([{ start: first, count: last - first + 1 }]);
}

/**
 * Sample `firstIndex` of the chunk, in seconds, as an exact rational.
 *
 * The sample sits at `chunkStart + firstIndex * recordDuration / samplesPerRecord`, and that
 * division is usually not a whole number of ticks. The whole part goes through `ticksToSeconds`
 * and only the remainder is divided, so the sub-tick part costs one rounding instead of poisoning
 * the seconds and the ticks together. Bigint `/` and `%` agree in sign, so a negative chunk start
 * (a pre-stimulus window) sums correctly.
 */
function gridSampleStartSeconds(
  chunkStartTicks: bigint,
  firstIndex: bigint,
  durationTicks: bigint,
  samplesPerRecord: bigint,
): number {
  const scaled = chunkStartTicks * samplesPerRecord + firstIndex * durationTicks;
  const wholeTicks = scaled / samplesPerRecord;
  const remainder = scaled % samplesPerRecord;
  return (
    ticksToSeconds(wholeTicks) +
    Number(remainder) / (Number(samplesPerRecord) * TICKS_PER_SECOND_FLOAT)
  );
}

function countOutOfDigitalRange(digital: Int32Array, signal: EdfSignal): number {
  const low = Math.min(signal.digitalMinimum, signal.digitalMaximum);
  const high = Math.max(signal.digitalMinimum, signal.digitalMaximum);
  let count = 0;
  for (let i = 0; i < digital.length; i += 1) {
    // biome-ignore lint/style/noNonNullAssertion: i is bounded by digital.length.
    const value = digital[i]!;
    if (value < low || value > high) count += 1;
  }
  return count;
}

function trimmed(
  chunkSignal: EdfChunkSignal,
  signal: EdfSignal,
  firstIndex: number,
  sampleCount: number,
  startSeconds: number,
): EdfChunkSignal {
  const digital = chunkSignal.digital.subarray(firstIndex, firstIndex + sampleCount);
  const keptEverything = firstIndex === 0 && digital.length === chunkSignal.digital.length;
  return {
    signalIndex: chunkSignal.signalIndex,
    // From the view, so the count and the data cannot disagree even if the chunk they came from
    // declared a length its array did not have.
    sampleCount: digital.length,
    digital,
    firstSampleIndex: chunkSignal.firstSampleIndex + firstIndex,
    startSeconds,
    // Re-counted only when it can have changed and only when there is something to find: a
    // chunk with no out-of-range samples cannot acquire one by being narrowed.
    outOfDigitalRangeCount:
      keptEverything || chunkSignal.outOfDigitalRangeCount === 0
        ? chunkSignal.outOfDigitalRangeCount
        : countOutOfDigitalRange(digital, signal),
  };
}

/**
 * The exact per-signal trim of a record-aligned chunk to `[startSeconds, startSeconds + duration)`.
 *
 * Sample `j` of the chunk starts at `chunkSignal.startSeconds + j * recordDuration /
 * samplesPerRecord`, so the samples inside the window are those with
 * `j * recordDuration >= relativeStart * samplesPerRecord` and
 * `j * recordDuration < relativeEnd * samplesPerRecord`. Both comparisons are integer bigint
 * products of on-disk quantities — no division, no sample rate, no float bound — which is what
 * makes the boundary sample the same one every time and on every platform.
 *
 * The chunk must be one contiguous run of records (what `readWindow` returns), because that is
 * what makes the sample grid uniform across it.
 *
 * `digital` in the result is a SUBARRAY view of the input's, so trimming allocates nothing and
 * the two share memory. A window that only partly overlaps the chunk is clamped to the samples
 * that exist; one that misses it entirely yields a zero-length result rather than an error.
 */
export function trimToWindow(
  header: EdfHeader,
  chunkSignal: EdfChunkSignal,
  startSeconds: number,
  durationSeconds: number,
): EdfChunkSignal {
  const signal = signalAt(header, chunkSignal.signalIndex);
  const samplesPerRecord = signal.samplesPerRecord;
  const durationTicks = header.recordDurationTicks;
  const available = Math.min(chunkSignal.sampleCount, chunkSignal.digital.length);

  const windowStartTicks = secondsToTicks(startSeconds);
  const windowDurationTicks = secondsToTicks(durationSeconds);
  // The chunk's own start is a float only because `EdfChunkSignal` publishes seconds; it was
  // produced from exact ticks by `ticksToSeconds`, and rounding back to the nearest tick recovers
  // them for any recording shorter than ~28.5 years.
  const chunkStartTicks = secondsToTicks(chunkSignal.startSeconds);

  // Nothing advances in time within the chunk: a zero record duration puts every sample at the
  // chunk's start instant, and a signal with no samples per record has no grid at all. The chunk
  // is then either wholly inside the window or wholly outside it.
  if (durationTicks === 0n || samplesPerRecord === 0) {
    const inside =
      windowDurationTicks > 0n &&
      windowStartTicks <= chunkStartTicks &&
      chunkStartTicks < windowStartTicks + windowDurationTicks;
    return inside
      ? trimmed(chunkSignal, signal, 0, available, chunkSignal.startSeconds)
      : trimmed(chunkSignal, signal, 0, 0, chunkSignal.startSeconds);
  }

  const samplesPerRecordTicks = BigInt(samplesPerRecord);
  const relativeStartTicks = windowStartTicks - chunkStartTicks;
  const relativeEndTicks = relativeStartTicks + windowDurationTicks;

  const firstIndex = clampToInt(
    ceilDiv(relativeStartTicks * samplesPerRecordTicks, durationTicks),
    0,
    available,
  );
  const lastIndex = clampToInt(
    ceilDiv(relativeEndTicks * samplesPerRecordTicks, durationTicks) - 1n,
    -1,
    available - 1,
  );
  const sampleCount = lastIndex < firstIndex ? 0 : lastIndex - firstIndex + 1;

  return trimmed(
    chunkSignal,
    signal,
    firstIndex,
    sampleCount,
    gridSampleStartSeconds(
      chunkStartTicks,
      BigInt(firstIndex),
      durationTicks,
      samplesPerRecordTicks,
    ),
  );
}
