/**
 * Time and sample index, on the recording's own axis.
 *
 * Layer 7. The recording-aware counterpart to `sample-grid.ts`, and the reason it exists is stated
 * plainly there: `gridSampleIndexAt`, `gridSampleStartTicks` and `gridSampleStartSeconds` take
 * `(signal, value, recordDurationTicks)` — no index, no timeline — so a gap is not in their
 * arguments and no arithmetic inside them could find one. They measure the signal's own SAMPLE
 * GRID, which equals elapsed recording time only when the recording is contiguous.
 *
 * These two take the recording, so they can answer the question people actually mean. On a
 * contiguous file they agree with the grid functions exactly. On an EDF+D file they differ by the
 * gaps, and `sampleAt` can answer something the grid functions structurally cannot: that an
 * instant has NO sample at all, because it falls in a hole.
 *
 * Both refuse a probed index on a file whose records do not cover its span, for the reason
 * `segmentAt` does: `undefined` from `sampleAt` means "no sample exists here", and an index that
 * has read record 0 and the last record cannot say that about anything in between. Merging "there
 * is a gap here" with "nobody looked" is the confusion this whole area of the API avoids.
 *
 * ONE LIMIT, and it belongs to the file rather than to these functions. If two records cover the
 * same instant — a timeline whose onsets repeat, which EDF+ does not forbid and which edfcore
 * reports without a diagnostic — then more than one sample exists at that time and no function can
 * return both. `sampleAt` returns the one whose segment `segmentAt` finds. The round-trip
 * "the sample at a sample's start is that sample" therefore holds for files whose records do not
 * overlap, which is every file anyone is likely to have; it is not a universal law and 0.2.60
 * claimed it as one.
 */

import { EdfChannelNotFoundError } from './errors.js';
import { segmentAt } from './record-index.js';
import { floorDiv, secondsToTicks, ticksToSeconds } from './tal/ticks.js';
import type { EdfRecording, EdfSampleLocation, EdfSegment, EdfSignal } from './types.js';

function resolveSignal(recording: EdfRecording, signalIndex: number, caller: string): EdfSignal {
  const signal = recording.header.signals[signalIndex];
  if (signal === undefined) {
    throw new EdfChannelNotFoundError(
      `${caller}(): signalIndex ${signalIndex} is outside the ` +
        `${recording.header.signals.length} signals this file declares. Next: pass an index from ` +
        'header.dataSignalIndices, or resolve one with getSignal(header, label).',
      {
        selector: signalIndex,
        availableLabels: recording.header.signals.map((s) => s.label),
      },
    );
  }
  if (signal.kind === 'annotations') {
    throw new RangeError(
      `${caller}(): signal ${signalIndex} (${JSON.stringify(signal.label)}) is an annotations ` +
        'channel, whose region holds TAL text rather than samples, so it has no sample grid. ' +
        'Next: use onsetTicksFromFirstRecord on the annotations themselves.',
    );
  }
  if (signal.samplesPerRecord <= 0) {
    throw new RangeError(
      `${caller}(): signal ${signalIndex} (${JSON.stringify(signal.label)}) declares ` +
        `${signal.samplesPerRecord} samples per record, so it has no sample grid to index. ` +
        'Next: check header.diagnostics for ZERO_SAMPLES_PER_RECORD.',
    );
  }
  if (recording.header.recordDurationTicks <= 0n) {
    throw new RangeError(
      `${caller}(): this file declares a record duration of zero, so records do not advance in ` +
        'time and no elapsed time maps to a sample. This is legal EDF and a scoring file relies ' +
        'on it. Next: index by record with readRecords().',
    );
  }
  return signal;
}

/**
 * The record a segment places at a given position, and that record's true start in ticks.
 *
 * `segment.startTicks` is already on the recording's axis, and records inside one segment are
 * contiguous by construction, so this is exact.
 */
function recordStartTicks(
  recording: EdfRecording,
  segment: EdfSegment | undefined,
  recordIndex: number,
): bigint {
  const duration = recording.header.recordDurationTicks;
  if (segment === undefined) return BigInt(recordIndex) * duration;
  return segment.startTicks + BigInt(recordIndex - segment.records.start) * duration;
}

/** The segment holding a record, on a scanned index; `undefined` when the file is contiguous. */
function segmentOfRecord(recording: EdfRecording, recordIndex: number): EdfSegment | undefined {
  const segments = recording.index.segments;
  if (segments === undefined) return undefined;
  for (const segment of segments) {
    const first = segment.records.start;
    if (recordIndex >= first && recordIndex < first + segment.records.count) return segment;
  }
  return undefined;
}

/**
 * Whether a PROBED recording needs a scan before a time can be located.
 *
 * This is a statement about a probed index and nothing else. It compares net drift — span against
 * coverage — which is what two probes can see, and edfcore's own documentation says three times
 * that net drift is not a proof of contiguity: a gap that an overlap elsewhere cancels exactly
 * leaves span equal to coverage and is still a gap.
 *
 * So it must never be consulted while a COMPLETE index is available; `resolveTimeWindow` gets that
 * precedence right and this module originally did not, which made `sampleAt` take the nominal
 * branch on a file whose scanned index reported gaps (fixed in 0.2.68).
 */
function probedIndexNeedsScan(recording: EdfRecording): boolean {
  // In ticks. The seconds beside them are lossy conversions of these, and on a long enough
  // recording a real discontinuity rounds away — `sampleAt` then answered on the nominal grid
  // instead of refusing, for a file whose scanned index reports two segments (fixed in 0.3.4).
  return recording.timeline.spanTicks !== recording.timeline.coveredTicks;
}

/**
 * The sample covering `seconds`, or `undefined` when no sample does.
 *
 * `undefined` is a real answer rather than a failure: on an EDF+D file an instant inside a gap has
 * no sample, and so does any time before the recording starts or after it ends. That is the case
 * `gridSampleIndexAt` cannot express — given only a signal and a record duration it always returns an
 * index, even one past the end of the file.
 *
 * Floor, not round, and in exact integer arithmetic on ticks: a sample covers the half-open
 * interval from its own start to the next one's, so the sample "at" a time is the one already
 * running when that time arrives.
 */
export function sampleAt(
  recording: EdfRecording,
  signalIndex: number,
  seconds: number,
): EdfSampleLocation | undefined {
  const signal = resolveSignal(recording, signalIndex, 'sampleAt');
  if (!Number.isFinite(seconds)) {
    throw new RangeError(`sampleAt(): seconds must be a finite number, received ${seconds}.`);
  }

  const duration = recording.header.recordDurationTicks;
  const perRecord = BigInt(signal.samplesPerRecord);
  const ticks = secondsToTicks(seconds);

  // A SCANNED index takes precedence over any statement about net drift, the same order
  // `resolveTimeWindow` uses. Asking `probedIndexNeedsScan` first meant a file whose gap and
  // overlap cancel — span equal to coverage, no diagnostic on open — took the nominal branch while
  // a complete index sat on the same object reporting two gaps.
  if (recording.index.segments !== undefined) {
    // `segmentAt` owns "is there data here at all" and throws for a probed index rather than
    // guessing; it cannot be reached with one here, because segments only exist on a scanned index.
    const segment = segmentAt(recording.index, seconds);
    if (segment === undefined) return undefined;

    const offsetTicks = ticks - segment.startTicks;
    const recordOffset = floorDiv(offsetTicks, duration);
    // Bounded by the SEGMENT, as the nominal branch is bounded by the record count. `segmentAt`
    // compares float seconds while this compares exact ticks, and `secondsToTicks` rounds to the
    // nearest tick — so a time within half a tick of `segment.endSeconds` is inside the segment
    // for one and at its end for the other, and without this it walked into the next segment or
    // off the end of the file.
    if (recordOffset < 0n || recordOffset >= BigInt(segment.records.count)) return undefined;

    const recordIndex = segment.records.start + Number(recordOffset);
    const withinTicks = offsetTicks - recordOffset * duration;
    const sampleWithinRecord = Number(floorDiv(withinTicks * perRecord, duration));
    return {
      sampleIndex: recordIndex * signal.samplesPerRecord + sampleWithinRecord,
      recordIndex,
      sampleWithinRecord,
    };
  }

  if (probedIndexNeedsScan(recording)) {
    throw new RangeError(
      'sampleAt(): this file has gaps and its index has not been scanned, so which records cover ' +
        'a time is not known. Next: await buildRecordIndex(recording) and read the result into ' +
        'the recording.',
    );
  }

  // Contiguous, probed: the nominal grid is the true one, and the answer is bounded by the file.
  const recordIndex = Number(floorDiv(ticks, duration));
  if (recordIndex < 0 || recordIndex >= recording.header.recordCount) return undefined;
  const withinTicks = ticks - BigInt(recordIndex) * duration;
  const sampleWithinRecord = Number(floorDiv(withinTicks * perRecord, duration));
  return {
    sampleIndex: recordIndex * signal.samplesPerRecord + sampleWithinRecord,
    recordIndex,
    sampleWithinRecord,
  };
}

/**
 * When a sample starts, in exact ticks on the recording's axis.
 *
 * The inverse of `sampleAt`, and the recording-aware form of `gridSampleStartTicks`. On a contiguous
 * file the two agree exactly; on an EDF+D file this one includes the gaps that precede the sample
 * and `gridSampleStartTicks` does not.
 *
 * Rounds UP to a whole tick, as `gridSampleStartTicks` does: a sample boundary need not fall on one —
 * 128 samples over 0.3 s puts sample 1 at 23,437.5 ticks — and truncating would return a tick
 * lying inside the previous sample, which `sampleAt` would then map straight back to that
 * previous sample.
 */
export function sampleStartTicksOf(
  recording: EdfRecording,
  signalIndex: number,
  sampleIndex: number,
): bigint {
  const signal = resolveSignal(recording, signalIndex, 'sampleStartTicksOf');
  if (!Number.isSafeInteger(sampleIndex)) {
    throw new RangeError(
      `sampleStartTicksOf(): sampleIndex must be a whole number, received ${sampleIndex}.`,
    );
  }

  const perRecord = signal.samplesPerRecord;
  const duration = recording.header.recordDurationTicks;
  const recordIndex = Math.floor(sampleIndex / perRecord);
  const within = BigInt(sampleIndex - recordIndex * perRecord);

  // Bounded by the file. An index past the end used to fall through `segmentOfRecord` to the
  // nominal grid and come back EARLIER than the last real sample — on a file with a 7 s gap,
  // sample 24 of a 24-sample file reported 6.75 s before sample 23. Refusing is the only honest
  // answer for a sample that does not exist.
  if (sampleIndex < 0 || recordIndex >= recording.header.recordCount) {
    throw new RangeError(
      `sampleStartTicksOf(): sample ${sampleIndex} is outside the ` +
        `${recording.header.recordCount * perRecord} samples signal ${signalIndex} has. ` +
        'Next: clamp the index, or read signal.sampleCount first.',
    );
  }

  if (recording.index.segments === undefined && probedIndexNeedsScan(recording)) {
    throw new RangeError(
      'sampleStartTicksOf(): this file has gaps and its index has not been scanned, so the true ' +
        'start of a record after a gap is not known. Next: await buildRecordIndex(recording) and ' +
        'read the result into the recording.',
    );
  }

  const start = recordStartTicks(recording, segmentOfRecord(recording, recordIndex), recordIndex);
  const numerator = within * duration;
  const offset = numerator / BigInt(perRecord);
  // Ceil, matching `gridSampleStartTicks`.
  return start + (numerator % BigInt(perRecord) === 0n ? offset : offset + 1n);
}

/** `sampleStartTicksOf` as float64 seconds. Compare with the ticks, never with this. */
export function sampleStartSecondsOf(
  recording: EdfRecording,
  signalIndex: number,
  sampleIndex: number,
): number {
  return ticksToSeconds(sampleStartTicksOf(recording, signalIndex, sampleIndex));
}
