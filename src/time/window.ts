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
import { ceilDiv, floorDiv, secondsToTicks, ticksToSeconds } from '../tal/ticks.js';
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

/** Clamping in bigint first, because `Number()` on a large bigint silently loses digits. */
function clampToInt(value: bigint, low: number, high: number): number {
  if (value <= BigInt(low)) return low;
  if (value >= BigInt(high)) return high;
  return Number(value);
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
 * `spanTicks === coveredTicks` states; when it is not, the records a window maps to depend
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

  // From the timeline, not recovered from its seconds. `resolveTimeWindow` takes no header, so
  // until 0.3.8 this rounded `recordDurationSeconds` back with `secondsToTicks` and reasoned that
  // the trip was exact for anything a header can declare. The timeline now carries the value.
  const durationTicks = timeline.recordDurationTicks;
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

  // Ticks, not the seconds beside them: those are float64 conversions, and two different tick
  // counts can round to the same one. On a long enough recording a real gap then vanished from
  // this comparison and the window was mapped on the nominal grid (fixed in 0.3.4).
  if (timeline.spanTicks !== timeline.coveredTicks) {
    // The test is TWO-SIDED and the message used to name only one side. A span that exceeds the
    // coverage is a gap; a coverage that exceeds the span means records OVERLAP, and saying
    // "span 3.5 s but cover only 4 s, so it contains at least one gap" is both arithmetic
    // nonsense — "only" for the larger number — and the opposite of what the bytes say. The same
    // file's open-time diagnostic already calls it an overlap, so one file produced two edfcore
    // messages that contradicted each other. 0.3.3 stated the rule for `edfcore gaps`: a gap is
    // time no record covers; an overlap is one instant two records both claim (fixed in 0.3.33).
    const overlapping = timeline.coveredTicks > timeline.spanTicks;
    const shape = overlapping
      ? `records covering ${timeline.coveredSeconds} s are packed into a ${timeline.spanSeconds} s ` +
        'span, so at least one record starts before the previous one ends'
      : `its ${recordCount} records span ${timeline.spanSeconds} s but cover only ` +
        `${timeline.coveredSeconds} s, so it contains at least one gap`;
    throw new RangeError(
      `resolveTimeWindow() cannot map seconds to records on this file: ${shape}, ` +
        'and a probed index knows where neither the discontinuity nor the ' +
        'records after it start. ' +
        // The two seconds above can PRINT the same on a long recording, since that is exactly the
        // rounding this check stopped relying on. The ticks always differ here, so they are
        // stated: a message that appears to contradict itself is a message nobody acts on.
        `Exactly: ${timeline.spanTicks} against ${timeline.coveredTicks} ticks of 100 ns. ` +
        'Next: await buildRecordIndex(recording) and pass the index it ' +
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
 * Sample `firstIndex` of the chunk, as an exact rational, in both units.
 *
 * The sample sits at `chunkStart + firstIndex * recordDuration / samplesPerRecord`, and that
 * division is usually not a whole number of ticks. The whole part goes through `ticksToSeconds`
 * and only the remainder is divided, so the sub-tick part costs one rounding instead of poisoning
 * the seconds and the ticks together.
 *
 * `ticks` is FLOORED — `floorDiv`, not bigint `/`, which truncates toward zero and would round a
 * negative chunk start (a pre-stimulus window) the wrong way. Flooring is the rule every boundary
 * decision in the package follows: a sample covers from its own start to the next one's, so the
 * tick a sample starts in is the one it is already running in. The remainder is then non-negative
 * and the two parts still sum to the same seconds.
 */
function gridSampleStart(
  chunkStartTicks: bigint,
  firstIndex: bigint,
  durationTicks: bigint,
  samplesPerRecord: bigint,
): { ticks: bigint; seconds: number } {
  const scaled = chunkStartTicks * samplesPerRecord + firstIndex * durationTicks;
  const wholeTicks = floorDiv(scaled, samplesPerRecord);
  const remainder = scaled - wholeTicks * samplesPerRecord;
  return {
    ticks: wholeTicks,
    seconds:
      ticksToSeconds(wholeTicks) +
      Number(remainder) / (Number(samplesPerRecord) * TICKS_PER_SECOND_FLOAT),
  };
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
  start: { ticks: bigint; seconds: number },
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
    startSeconds: start.seconds,
    startTicks: start.ticks,
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
 * Sample `j` of the chunk is inside the window when the tick edfcore PUBLISHES for it —
 * `ceil(j * recordDuration / samplesPerRecord)`, the value `gridSampleStartTicks` and
 * `sampleStartTicksOf` report — falls in `[relativeStart, relativeEnd)`. Since `ceil(x) >= R` iff
 * `x > R - 1`, both edges stay integer bigint products of on-disk quantities: no division, no
 * sample rate, no float bound, so the boundary sample is the same one on every platform.
 *
 * The comparison is against the PUBLISHED tick, not the sample's exact rational start. Those
 * differ whenever a boundary is not a whole tick — 256 samples in a one-second record puts sample 1
 * at 39,062.5 ticks, published as 39,063 — and selecting on the exact start excluded the sample a
 * caller had aligned the window to. This docblock stated that older rule until 0.3.95, three
 * releases after 0.3.56 replaced it.
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
  // The chunk's own start, as the chunk itself recorded it. Until 0.3.7 `EdfChunkSignal` published
  // only seconds, so this rounded them back — a round trip the comment here bounded at "any
  // recording shorter than ~28.5 years", which is where 10^7 ticks per second passes 2^53. The
  // library accepts declared spans up to the int64 tick range, three orders of magnitude past
  // that, so the bound was reachable rather than theoretical. The value is now carried.
  const chunkStartTicks = chunkSignal.startTicks;

  // Nothing advances in time within the chunk: a zero record duration puts every sample at the
  // chunk's start instant, and a signal with no samples per record has no grid at all. The chunk
  // is then either wholly inside the window or wholly outside it.
  if (durationTicks === 0n || samplesPerRecord === 0) {
    const inside =
      windowDurationTicks > 0n &&
      windowStartTicks <= chunkStartTicks &&
      chunkStartTicks < windowStartTicks + windowDurationTicks;
    const unchanged = { ticks: chunkStartTicks, seconds: chunkSignal.startSeconds };
    return inside
      ? trimmed(chunkSignal, signal, 0, available, unchanged)
      : trimmed(chunkSignal, signal, 0, 0, unchanged);
  }

  const samplesPerRecordTicks = BigInt(samplesPerRecord);
  const relativeStartTicks = windowStartTicks - chunkStartTicks;
  const relativeEndTicks = relativeStartTicks + windowDurationTicks;

  /*
   * Compared against the start tick each sample PUBLISHES, not against its exact rational start.
   *
   * `gridSampleStartTicks` and `sampleStartTicksOf` round a sample's start UP to a whole tick, on
   * purpose, so that flooring it back names the same sample. A boundary need not fall on a whole
   * tick: 256 samples in a one-second record — the commonest EEG geometry there is — puts sample 1
   * at 39,062.5 ticks, published as 39,063. Selecting on the EXACT start then excluded that sample
   * from a window beginning at its own published start, because 39,063 is later than 39,062.5. Half
   * of all indices were affected at that rate; at 128 samples per 0.29 s a one-sample-wide window
   * aligned to a sample start came back EMPTY.
   *
   * 0.3.32 fixed the same mismatch in `readTriggers` and recorded the rule it settled on:
   * "`sampleAt`, `sampleStartTicksOf`, a window bound and `readTriggers` all name the same sample."
   * The window bound was the one of the four still using the other rounding (fixed in 0.3.56).
   *
   * Sample j is in the window when `ceil(j * D / S)` is in `[R, Rend)`, and since
   * `ceil(x) >= R  <=>  x > R - 1`, both edges stay a bigint product of on-disk quantities:
   *   first: smallest j with j*D > (R-1)*S      -> floorDiv((R-1)*S, D) + 1
   *   last:  largest  j with j*D <= (Rend-1)*S  -> floorDiv((Rend-1)*S, D)
   * Identical to the old form whenever a boundary is a whole tick, so no window on a
   * power-of-ten geometry moves; a sample admitted by the new rule starts at most one tick — 100
   * ns, below the resolution edfcore reports in — before the bound, and it is precisely the sample
   * the caller aligned to.
   */
  const firstIndex = clampToInt(
    floorDiv((relativeStartTicks - 1n) * samplesPerRecordTicks, durationTicks) + 1n,
    0,
    available,
  );
  const lastIndex = clampToInt(
    floorDiv((relativeEndTicks - 1n) * samplesPerRecordTicks, durationTicks),
    -1,
    available - 1,
  );
  const sampleCount = lastIndex < firstIndex ? 0 : lastIndex - firstIndex + 1;

  return trimmed(
    chunkSignal,
    signal,
    firstIndex,
    sampleCount,
    gridSampleStart(chunkStartTicks, BigInt(firstIndex), durationTicks, samplesPerRecordTicks),
  );
}
