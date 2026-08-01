/**
 * The recording's time axis, built from probed record onsets.
 *
 * Layer 4. Pure and synchronous: it is handed onsets that someone else read, and it decides what
 * they mean. Sole owner of what makes a timeline valid — `tal/annotations.ts` produces
 * `recordOnsetTicks` and deliberately passes no judgement on it, so monotonicity and
 * record-onset spacing are enforced here and nowhere else.
 *
 * TIME AXIS, fixed here for the whole library: `t = 0` is the START OF RECORD 0, not the header
 * start time. Record 0's timekeeping onset is `startOffsetTicks` — in [0, 1) s — and it is the
 * bridge back to the header clock. Every other second edfcore reports (segment, gap, chunk,
 * window bound) is elapsed recording time. This is the EDFlib/pyEDFlib/MNE convention, and it is
 * the one under which sample `n` of a signal sits at exactly
 * `n * recordDuration / samplesPerRecord` with no sub-second constant to remember.
 */

import { TICKS_PER_SECOND } from '../constants.js';
import { DiagnosticSink, fatalError } from '../diagnostics/collector.js';
import { ticksToSeconds } from '../tal/ticks.js';
import type { EdfDiagnostic, EdfHeader, EdfTimeline, ParseOptions } from '../types.js';

const TIMEKEEPING_SPEC = 'EDF+ specification 2.2.1 (time keeping of data records)';

/** One record onset as observed on disk: which record, and its exact timekeeping value. */
export interface RecordOnsetProbe {
  readonly recordIndex: number;
  /** Verbatim, relative to the header start time — the axis rebasing has not happened yet. */
  readonly onsetTicks: bigint;
}

export interface TimelineInput {
  readonly header: EdfHeader;
  /**
   * Ascending by `recordIndex`, first entry record 0 and last entry record `recordCount - 1`.
   * In practice the two probes `buildTimeline` reads; a single-record file supplies one entry
   * that is both. Empty exactly when the file has no records.
   */
  readonly probes: readonly RecordOnsetProbe[];
  /**
   * Diagnostics from decoding the probed records, folded into `timeline.diagnostics` so one
   * array explains the whole timeline. A `START_OFFSET_OUT_OF_RANGE` already present here is not
   * repeated below.
   */
  readonly probeDiagnostics?: readonly EdfDiagnostic[];
}

/**
 * Fatal, at any observed pair: a later record starting earlier than an earlier one makes every
 * time-based answer for the file wrong, so edfcore refuses to derive any of them.
 *
 * Equal onsets are not a violation — a file with `recordDuration = 0` has every record at the
 * same instant legally, and an insufficient advance is spacing, which is a warning.
 */
export function assertMonotonicOnsets(earlier: RecordOnsetProbe, later: RecordOnsetProbe): void {
  if (later.onsetTicks >= earlier.onsetTicks) return;
  throw fatalError({
    code: 'TIMELINE_NOT_MONOTONIC',
    message:
      `record ${later.recordIndex} starts at ${ticksToSeconds(later.onsetTicks)} s, before ` +
      `record ${earlier.recordIndex} at ${ticksToSeconds(earlier.onsetTicks)} s ` +
      `(${later.onsetTicks} against ${earlier.onsetTicks} ticks of 100 ns). ` +
      'Rule: record onsets never decrease, in EDF+C or EDF+D — the timekeeping TAL of record r ' +
      "is that record's start relative to the header start time. " +
      'Next: every time-based answer for this file would be wrong, so edfcore derives none of ' +
      'them; read by record index with readRecords(), or repair the timekeeping TALs.',
    field: 'timekeeping TAL',
    expected: `onset >= ${earlier.onsetTicks} ticks`,
    actual: `${later.onsetTicks} ticks`,
    recordIndex: later.recordIndex,
    specReference: TIMEKEEPING_SPEC,
  });
}

/**
 * `assertMonotonicOnsets` across a full onset array, which is what `buildRecordIndex` has.
 *
 * `firstRecordIndex` is the record `onsetTicks[0]` belongs to, so the diagnostic names the record
 * in the file rather than a position in the array.
 */
export function assertMonotonicOnsetArray(
  onsetTicks: ArrayLike<bigint>,
  firstRecordIndex: number = 0,
): void {
  for (let position = 1; position < onsetTicks.length; position += 1) {
    const previous = onsetTicks[position - 1];
    const current = onsetTicks[position];
    if (previous === undefined || current === undefined) continue;
    assertMonotonicOnsets(
      { recordIndex: firstRecordIndex + position - 1, onsetTicks: previous },
      { recordIndex: firstRecordIndex + position, onsetTicks: current },
    );
  }
}

/**
 * The probe array has to describe the whole file, because `spanSeconds` is defined by its two
 * ends. A `RangeError` rather than an `EdfFormatError`: nothing here is the file's fault.
 */
function assertProbeShape(probes: readonly RecordOnsetProbe[], recordCount: number): void {
  if (recordCount === 0) {
    if (probes.length === 0) return;
    throw new RangeError(
      `buildTimelineFromProbes() received ${probes.length} onset probes for a file with no data ` +
        'records. Next: pass an empty probes array when header.recordCount is 0.',
    );
  }

  const first = probes[0];
  const last = probes[probes.length - 1];
  if (first === undefined || last === undefined) {
    throw new RangeError(
      `buildTimelineFromProbes() received no onset probes for a file with ${recordCount} data ` +
        'records, so neither the start offset nor the span is known. Next: probe record 0 and ' +
        `record ${recordCount - 1} and pass both.`,
    );
  }
  if (first.recordIndex !== 0 || last.recordIndex !== recordCount - 1) {
    throw new RangeError(
      `buildTimelineFromProbes() received probes for records ${first.recordIndex}..` +
        `${last.recordIndex}, but the start offset comes from record 0 and the span ends at ` +
        `record ${recordCount - 1}. Next: probe both ends of the file; intermediate probes are ` +
        'optional.',
    );
  }
  for (let i = 1; i < probes.length; i += 1) {
    const previous = probes[i - 1];
    const probe = probes[i];
    if (previous === undefined || probe === undefined) continue;
    if (probe.recordIndex <= previous.recordIndex) {
      throw new RangeError(
        `buildTimelineFromProbes() received probes out of order: record ${probe.recordIndex} ` +
          `follows record ${previous.recordIndex}. Next: sort the probes by record index.`,
      );
    }
  }
}

function reportStartOffset(sink: DiagnosticSink, startOffsetTicks: bigint): void {
  sink.report({
    code: 'START_OFFSET_OUT_OF_RANGE',
    message:
      `record 0 starts ${ticksToSeconds(startOffsetTicks)} s after the header start time ` +
      `(${startOffsetTicks} ticks of 100 ns), but a sub-second start offset must be in [0, 1). ` +
      "Rule: the onset of record 0's timekeeping TAL is the recording's sub-second start " +
      'offset; the whole-second part of the start time lives in the header starttime field. ' +
      'Next: the value was used as written, so the time axis still starts at record 0; compare ' +
      'it with the header starttime, because a writer that encodes the start time twice ' +
      'produces exactly this.',
    field: 'timekeeping TAL',
    expected: `0 <= onset < ${TICKS_PER_SECOND} ticks`,
    actual: `${startOffsetTicks} ticks`,
    recordIndex: 0,
    specReference: TIMEKEEPING_SPEC,
  });
}

/**
 * The two-probe contiguity verdict.
 *
 * `onset[last] === onset[0] + (n - 1) * recordDuration`, in exact ticks, detects any NET drift of
 * the timeline from two reads. It is not a proof of contiguity: a gap that a later overlap
 * cancels exactly leaves the two ends where a contiguous file would put them, and only
 * `buildRecordIndex()` or `validateRecording()` — which read every onset — can see that. The
 * message says so, because a caller who believes this check is a proof will trust the wrong file.
 */
function reportDrift(
  sink: DiagnosticSink,
  header: EdfHeader,
  lastRecordIndex: number,
  observedTicks: bigint,
  expectedTicks: bigint,
): void {
  const driftTicks = observedTicks - expectedTicks;
  const nominal =
    `record ${lastRecordIndex} starts at ${ticksToSeconds(observedTicks)} s where ` +
    `startOffset + ${lastRecordIndex} * recordDuration is ${ticksToSeconds(expectedTicks)} s, ` +
    `a net drift of ${ticksToSeconds(driftTicks)} s (${driftTicks} ticks of 100 ns)`;
  const probeNote =
    'Note: two probes detect any net drift of the timeline, but not a gap that an overlap ' +
    'elsewhere cancels exactly — buildRecordIndex() reads every onset and does.';

  if (header.continuity === 'continuous') {
    sink.report({
      code: 'DISCONTINUITY_IN_CONTINUOUS_FILE',
      message:
        `the reserved field marks this file continuous, but ${nominal}. ` +
        'Rule: in a continuous file every record onset is startOffset + recordIndex * ' +
        'recordDuration; a recording with gaps is what EDF+D exists for. ' +
        'Next: treat the file as discontinuous — buildRecordIndex() returns its segments and ' +
        `gaps, and readWindow() then returns one chunk per contiguous run instead of ` +
        'crossing a gap silently. ' +
        probeNote,
      field: 'timekeeping TAL',
      expected: `${expectedTicks} ticks`,
      actual: `${observedTicks} ticks`,
      recordIndex: lastRecordIndex,
      specReference: TIMEKEEPING_SPEC,
    });
    return;
  }

  // A discontinuous file is allowed to spread its records out; it is never allowed to pull them
  // together, so only negative net drift is reportable here.
  if (driftTicks >= 0n) return;
  sink.report({
    code: 'RECORD_ONSET_SPACING_VIOLATION',
    message:
      `${nominal}, so somewhere in this file a record starts before the previous one ends. ` +
      'Rule: consecutive record onsets are spaced by at least the record duration — a ' +
      'discontinuous file may leave gaps between records but never overlaps them. ' +
      'Next: the onsets were used as written and nothing was reordered; buildRecordIndex() ' +
      'reports which records overlap. ' +
      probeNote,
    field: 'timekeeping TAL',
    expected: `>= ${expectedTicks} ticks`,
    actual: `${observedTicks} ticks`,
    recordIndex: lastRecordIndex,
    specReference: TIMEKEEPING_SPEC,
  });
}

/**
 * `EdfTimeline` from the probed onsets plus the header.
 *
 * `spanSeconds` and `coveredSeconds` are computed independently — last record end minus first
 * record start, against the sum of the record durations — because their being equal is the
 * statement "this file is contiguous as far as two reads can tell". Deriving either from the
 * other would make that identity true by construction and worth nothing.
 */
export function buildTimelineFromProbes(input: TimelineInput, options?: ParseOptions): EdfTimeline {
  const header = input.header;
  const recordCount = header.recordCount;
  const durationTicks = header.recordDurationTicks;
  assertProbeShape(input.probes, recordCount);

  // Fatal, and checked before anything is derived: a non-monotonic timeline has no valid span,
  // no valid offset, and no valid answer to any question a caller could ask of this object.
  for (let i = 1; i < input.probes.length; i += 1) {
    const previous = input.probes[i - 1];
    const probe = input.probes[i];
    if (previous === undefined || probe === undefined) continue;
    assertMonotonicOnsets(previous, probe);
  }

  const sink = new DiagnosticSink(options);
  const priorDiagnostics = input.probeDiagnostics ?? [];
  const first = input.probes[0];
  const last = input.probes[input.probes.length - 1];

  if (recordCount === 0 || first === undefined || last === undefined) {
    return {
      recordCount: 0,
      recordDurationSeconds: header.recordDurationSeconds,
      startOffsetSeconds: 0,
      startOffsetTicks: 0n,
      spanSeconds: 0,
      coveredSeconds: 0,
      diagnostics: Object.freeze(priorDiagnostics.slice()),
    };
  }

  const startOffsetTicks = first.onsetTicks;
  const spanTicks = last.onsetTicks + durationTicks - first.onsetTicks;
  const coveredTicks = BigInt(recordCount) * durationTicks;
  const expectedLastTicks = first.onsetTicks + BigInt(recordCount - 1) * durationTicks;

  // decodeAnnotations already reports this for a range that began at record 0, which is exactly
  // how record 0 is probed. Repeating it would double every strict-mode failure and every
  // diagnostic count a test asserts.
  const offsetAlreadyReported = priorDiagnostics.some(
    (diagnostic) => diagnostic.code === 'START_OFFSET_OUT_OF_RANGE',
  );
  if (!offsetAlreadyReported && (startOffsetTicks < 0n || startOffsetTicks >= TICKS_PER_SECOND)) {
    reportStartOffset(sink, startOffsetTicks);
  }

  if (last.onsetTicks !== expectedLastTicks) {
    reportDrift(sink, header, last.recordIndex, last.onsetTicks, expectedLastTicks);
  }

  return {
    recordCount,
    recordDurationSeconds: header.recordDurationSeconds,
    startOffsetSeconds: ticksToSeconds(startOffsetTicks),
    startOffsetTicks,
    spanSeconds: ticksToSeconds(spanTicks),
    coveredSeconds: ticksToSeconds(coveredTicks),
    diagnostics: Object.freeze([...priorDiagnostics, ...sink.diagnostics]),
  };
}
