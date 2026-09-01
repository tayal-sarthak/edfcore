/**
 * Conformance, and nothing that reading bytes depends on.
 *
 * Layer 7, published as `edfcore/validate`. The split is one line: does the check affect BYTE
 * OFFSETS? If it does, it is core and always on, because correctness is the product and cannot be
 * an optional install. If it only tells you the file is impolite, it lives here — a full-file
 * conformance sweep has no business on the open path.
 *
 * Everything in this module is therefore a re-check: nothing it reports changes how a single byte
 * is interpreted, and a caller who never imports it reads exactly the same samples. Some codes
 * overlap with ones the parser already emits (`RECORD_SIZE_ABOVE_RECOMMENDED`,
 * `PATIENT_ID_NONCONFORMANT`); that is deliberate, so a validation report stands on its own
 * instead of only making sense next to `header.diagnostics`.
 *
 * Four codes here are not in the core vocabulary — `LABEL_CONVENTION_NONCONFORMANT`,
 * `PREFILTERING_NONCONFORMANT`, `TRANSDUCER_TYPE_BLANK` and `DATE_IMPLAUSIBLE`. `EdfDiagnosticCode`
 * is an open union for exactly this: they are recommendations from EDF+ additional specification
 * 9, they can never be fatal, and a consumer's `switch` keeps its `default` branch.
 *
 * Four HERE. `inspect.ts` emits two more of its own, and the six together are listed in
 * `tests/integration/open-union-codes.test.ts` — which is what stops a seventh appearing by
 * typo, since an unregistered code takes `dispositionOf`'s `?? 'warning'` and looks deliberate.
 */

import { trimEdfField } from './bytes/latin1.js';
import { EDF_RECOMMENDED_MAX_RECORD_BYTES } from './constants.js';
import { decodeDigitalCounted } from './decode/digital.js';
import {
  appendChunkDiagnostics,
  appendDiagnostics,
  createDiagnostic,
} from './diagnostics/collector.js';
import { EdfBudgetError } from './errors.js';
import {
  calendarDatesEqual,
  formatCalendarDate,
  isValidCalendarDate,
  parseHeaderStartDate,
} from './header/dates.js';
import { signalFieldOffset } from './header/signals.js';
import { readRecordBytes } from './io/read.js';
import { scanChunkRecords } from './record-index.js';
import { decodeAnnotations } from './tal/annotations.js';
import { buildSegmentation } from './time/segments.js';
import { assertMonotonicOnsetArray } from './time/timeline.js';
import type {
  EdfCalendarDate,
  EdfDiagnostic,
  EdfGap,
  EdfHeader,
  EdfRecordIndex,
  EdfRecording,
  EdfSignal,
  ObservedSignalStats,
  RecordRange,
  ValidateOptions,
  ValidationReport,
} from './types.js';

export { formatValidationReport } from './format-report.js';
/**
 * Every shape this subpath's own signatures mention, re-exported from where it is declared.
 *
 * They live in `types.ts` with everything else — one file holds every public data shape — but a
 * consumer of `edfcore/validate` must be able to name a `ValidationReport` without reaching into
 * the universal entry for it.
 *
 * That has to include the types the signatures REFER to, not only the ones they produce.
 * `validateHeader` takes an `EdfHeader` and returns `EdfDiagnostic[]`, and
 * `FormatReportOptions.header` is an `EdfHeader` — so a consumer who imported only this subpath
 * could call all three functions and still not name the type of anything they passed or received.
 * `tests/types/validate-entry.test-d.ts` pins the set.
 */
export type {
  EdfDiagnostic,
  EdfDiagnosticCode,
  EdfHeader,
  EdfRecordIndex,
  // The PARAMETER type of `validateRecording`, this subpath's headline function. A consumer
  // importing only `edfcore/validate` could not name what they were passing in (added in 0.3.44).
  EdfRecording,
  EdfSeverity,
  EdfSignal,
  FormatReportOptions,
  ObservedSignalStats,
  RecordRange,
  ValidateOptions,
  ValidationReport,
} from './types.js';

import { resolveMaterializeBudget } from './options.js';
import { pluralise } from './text/counted.js';

const LABEL_SPEC = 'EDF+ additional specification 9 (standard texts and labels)';
const TIMEKEEPING_SPEC = 'EDF+ specification 2.2.1 (time keeping of data records)';

/** The sample-scan scratch buffer is an `Int32Array`, so four bytes per sample. */
const BYTES_PER_SCRATCH_SAMPLE = 4;

/**
 * The signal types EDF+ additional specification 9 names.
 *
 * Case-sensitive, and a recommendation rather than a rule: a label outside this list is readable,
 * decodable and perfectly common. edfcore has no montage vocabulary and never infers a channel
 * type from a label — this list is used to report a deviation, never to classify anything.
 */
const STANDARD_LABEL_TYPES: ReadonlySet<string> = new Set([
  'EEG',
  'ECG',
  'EOG',
  'ERG',
  'EMG',
  'MEG',
  'MCG',
  'EP',
  'Temp',
  'Resp',
  'SaO2',
  'Light',
  'Sound',
  'Event',
]);

/** `HP:0.1Hz LP:75Hz N:50Hz` — high pass, low pass, notch, gain. */
const PREFILTERING_PREFIXES: readonly string[] = ['HP:', 'LP:', 'N:', 'G:'];

/** The spellings of "no filtering" that EDF+ and real writers use interchangeably. */
const PREFILTERING_NONE: ReadonlySet<string> = new Set(['None', 'none', 'NONE', 'No filtering']);

function labelOffset(header: EdfHeader, signal: EdfSignal): number {
  return signalFieldOffset('label', header.signals.length, signal.index);
}

function checkRecordSize(header: EdfHeader, into: EdfDiagnostic[]): void {
  if (header.recordByteLength <= EDF_RECOMMENDED_MAX_RECORD_BYTES) return;
  into.push(
    createDiagnostic({
      code: 'RECORD_SIZE_ABOVE_RECOMMENDED',
      message:
        `a data record is ${header.recordByteLength} bytes, above the ` +
        `${EDF_RECOMMENDED_MAX_RECORD_BYTES}-byte record size the EDF specification recommends. ` +
        'EDF specification, data records (recommended maximum record size). Next: nothing — the ' +
        'file reads normally, but every read is record-aligned, so this is also the smallest ' +
        'amount of data any read of this file can return.',
      field: 'recordByteLength',
      expected: `at most ${EDF_RECOMMENDED_MAX_RECORD_BYTES} bytes`,
      actual: `${header.recordByteLength} bytes`,
      specReference: 'EDF specification, data records',
    }),
  );
}

function checkLabelConvention(header: EdfHeader, signal: EdfSignal, into: EdfDiagnostic[]): void {
  const [type] = signal.label.split(' ');
  if (type !== undefined && STANDARD_LABEL_TYPES.has(type) && signal.label.length > type.length) {
    return;
  }
  into.push(
    createDiagnostic({
      code: 'LABEL_CONVENTION_NONCONFORMANT',
      message:
        `signal ${signal.index} is labelled ${JSON.stringify(signal.label)}, which is not the ` +
        'EDF+ form "<type> <sensor>" such as "EEG Fpz-Cz" with the type taken from ' +
        `${[...STANDARD_LABEL_TYPES].join(', ')}. ${LABEL_SPEC}. Next: nothing is affected — ` +
        'edfcore never infers a channel type from a label, and getSignal(header, label) matches ' +
        'the trimmed text exactly as written.',
      field: 'label',
      byteOffset: labelOffset(header, signal),
      byteLength: 16,
      raw: signal.raw.label,
      expected: '"<type> <sensor>", e.g. "EEG Fpz-Cz"',
      actual: signal.label,
      signalIndex: signal.index,
      specReference: LABEL_SPEC,
    }),
  );
}

function checkPrefiltering(header: EdfHeader, signal: EdfSignal, into: EdfDiagnostic[]): void {
  const text = signal.prefiltering;
  if (text.length === 0 || PREFILTERING_NONE.has(text)) return;
  // `filter`, because `trimEdfField` strips 0x20 and 0x00 and nothing else. A field padded or
  // separated with a tab or a newline still carries it here, and the split then yields an empty
  // token at that end — measured against the four prefixes it fails, and a field whose terms are
  // well formed is reported. The pattern's own `+` handles an interior run without help; this
  // handles the ends (0.4.483).
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  const conformant = tokens.every((token) =>
    PREFILTERING_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (conformant) return;

  into.push(
    createDiagnostic({
      code: 'PREFILTERING_NONCONFORMANT',
      message:
        `the prefiltering field of signal ${signal.index} (${JSON.stringify(signal.label)}) is ` +
        `${JSON.stringify(text)}, which is not written as space-separated ` +
        `${PREFILTERING_PREFIXES.join(' ')} terms such as "HP:0.1Hz LP:75Hz N:50Hz". ` +
        `${LABEL_SPEC}. Next: nothing is affected — signal.prefiltering keeps the text exactly ` +
        'as written, and edfcore never parses a filter setting out of it.',
      field: 'prefiltering',
      byteOffset: signalFieldOffset('prefiltering', header.signals.length, signal.index),
      byteLength: 80,
      raw: signal.raw.prefiltering,
      expected: 'HP:/LP:/N:/G: terms, or "None"',
      actual: text,
      signalIndex: signal.index,
      specReference: LABEL_SPEC,
    }),
  );
}

function checkTransducer(header: EdfHeader, signal: EdfSignal, into: EdfDiagnostic[]): void {
  if (signal.transducerType.length > 0) return;
  into.push(
    createDiagnostic({
      code: 'TRANSDUCER_TYPE_BLANK',
      message:
        `the transducer type of signal ${signal.index} (${JSON.stringify(signal.label)}) is ` +
        'blank, where EDF+ asks a data signal to name what recorded it, such as "AgAgCl ' +
        `electrode". ${LABEL_SPEC}. Next: nothing is affected — the field is descriptive, and ` +
        'only an annotations signal is required to leave it blank.',
      field: 'transducerType',
      byteOffset: signalFieldOffset('transducerType', header.signals.length, signal.index),
      byteLength: 80,
      raw: signal.raw.transducerType,
      expected: 'a transducer description, e.g. "AgAgCl electrode"',
      actual: '(blank)',
      signalIndex: signal.index,
      specReference: LABEL_SPEC,
    }),
  );
}

function checkIdentification(header: EdfHeader, into: EdfDiagnostic[]): void {
  // Plain EDF puts free text in these fields, which is normal and is not a non-conformance.
  if (!header.variant.includes('+')) return;

  if (!header.patient.conformant) {
    into.push(
      createDiagnostic({
        code: 'PATIENT_ID_NONCONFORMANT',
        message:
          `local patient identification is ${JSON.stringify(trimEdfField(header.patient.raw))}, ` +
          'which does not follow the EDF+ grammar "code sex(F|M) birthdate(dd-MMM-yyyy) name": ' +
          'four space-separated subfields, X for anything unknown, and no space inside a ' +
          'subfield. EDF+ additional specification 3. Next: header.patient keeps every subfield ' +
          'edfcore could read and the raw text verbatim; nothing about the samples changes.',
        field: 'patientId',
        byteOffset: 8,
        byteLength: 80,
        raw: header.patient.raw,
        expected: 'code sex(F|M) birthdate(dd-MMM-yyyy) name',
        actual: trimEdfField(header.patient.raw),
        specReference: 'EDF+ additional specification 3 (local patient identification)',
      }),
    );
  }

  if (!header.recording.conformant) {
    into.push(
      createDiagnostic({
        code: 'RECORDING_ID_NONCONFORMANT',
        message:
          'local recording identification is ' +
          `${JSON.stringify(trimEdfField(header.recording.raw))}, which does not follow the ` +
          'EDF+ grammar "Startdate startdate(dd-MMM-yyyy) investigationCode technicianCode ' +
          'equipmentCode". EDF+ additional specification 4. Next: header.recording keeps the raw ' +
          'text verbatim; a Startdate that could not be read leaves the two-digit header year as ' +
          'the only source of a date, which cannot express a year after 2084.',
        field: 'recordingId',
        byteOffset: 88,
        byteLength: 80,
        raw: header.recording.raw,
        expected: 'Startdate startdate(dd-MMM-yyyy) investigationCode technicianCode equipmentCode',
        actual: trimEdfField(header.recording.raw),
        specReference: 'EDF+ additional specification 4 (local recording identification)',
      }),
    );
  }
}

/** Negative when `a` is earlier than `b`. Both dates are proleptic Gregorian year/month/day. */
function compareDates(a: EdfCalendarDate, b: EdfCalendarDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function checkDates(header: EdfHeader, into: EdfDiagnostic[]): void {
  const { startTime, patient } = header;

  /*
   * The FIELD's condition, not `dateSource === 'none'`.
   *
   * `resolveStartTime` reports `DATE_UNPARSEABLE` whenever the 8-byte field fails its grammar,
   * whether or not the EDF+ recording-identification `Startdate` then supplies a good date.
   * Gating here on the RESOLVED date meant the two published entry points disagreed about whether
   * the same header has this defect: `32.13.05` beside a conformant `Startdate 02-AUG-1951` was
   * called defective by the parser and clean by `validateHeader`, so a caller on the recommended
   * two-read, no-I/O path was told the date fields were fine. That is the asymmetry 0.3.81 fixed
   * for `DATE_FIELDS_DISAGREE` under the `yy` escape, and this was the last of the shared codes
   * still holding it (fixed in 0.3.107).
   *
   * Converging on the field-level rule rather than the resolved one: `32.13.05` is eight corrupt
   * bytes whether or not something else rescues the date, and narrowing the parser instead would
   * have left them with no diagnostic anywhere in the package.
   */
  const dateParse = parseHeaderStartDate(header.raw.startDate);
  const rescued = startTime.recordingIdDate !== undefined;
  const startDateUnreadable =
    dateParse.status === 'unparseable' || (dateParse.status === 'yearEscape' && !rescued);

  if (startDateUnreadable) {
    into.push(
      createDiagnostic({
        code: 'DATE_UNPARSEABLE',
        message:
          `the startdate field is ${JSON.stringify(trimEdfField(header.raw.startDate))} and ` +
          (rescued
            ? 'cannot be read as dd.mm.yy. The recording identification carries a readable ' +
              'Startdate, so startTime.recordingIdDate holds the date and startTime.resolvedDate ' +
              'is taken from it. EDF specification, header record bytes 168-175. Next: nothing ' +
              'is lost, but the 8 bytes are wrong on disk and a stricter reader may refuse them.'
            : 'the recording identification carries no readable Startdate, so the recording has ' +
              'no calendar date at all. EDF specification, header record bytes 168-175. Next: ' +
              'every elapsed time in the file is unaffected, and only formatStartTimeNaive() has ' +
              'nothing to return. The clock is a separate field with a separate code: check ' +
              'startTime.clockSource, and look for STARTTIME_UNPARSEABLE.'),
        field: 'startDate',
        byteOffset: 168,
        byteLength: 8,
        raw: header.raw.startDate,
        expected: 'dd.mm.yy, or a Startdate subfield in the recording identification',
        actual: trimEdfField(header.raw.startDate),
        specReference: 'EDF specification, header record bytes 168-175',
      }),
    );
  }

  /*
   * The counterpart, and the check this sweep did not have.
   *
   * `validateHeader` is documented as independent of `header.diagnostics` — "running both costs
   * nothing and neither can mask the other" — so a caller running only the two-read, no-I/O path
   * both doc pages recommend saw NOTHING about a starttime field the parse had refused, and
   * concluded the header's timing fields were conformant while `startTime.clock` held a
   * substituted midnight the file never stated.
   *
   * 0.3.17 corrected the prose on two pages to describe this, and 0.3.27 rewrote it again for the
   * split code — both times documenting a check that was never added. Every other consumer of
   * `clockSource` already knows: `formatHeader` prints `unknown` and `formatStartTimeNaive`
   * returns `undefined`. Only the conformance sweep was blind (fixed in 0.3.34).
   */
  if (startTime.clockSource === 'none') {
    into.push(
      createDiagnostic({
        code: 'STARTTIME_UNPARSEABLE',
        message:
          `the starttime field is ${JSON.stringify(trimEdfField(header.raw.startTime))}, which ` +
          'is not a clock time in hh.mm.ss form with hour 00..23, minute 00..59 and second ' +
          '00..59. EDF specification, header record bytes 176-183. Next: startTime.clock reports ' +
          '00:00:00 because the type admits no absent clock — startTime.clockSource is "none" ' +
          'and formatStartTimeNaive() has nothing to return. The calendar date and every elapsed ' +
          'time in the file are unaffected.',
        field: 'startTime',
        byteOffset: 176,
        byteLength: 8,
        raw: header.raw.startTime,
        expected: 'hh.mm.ss',
        actual: trimEdfField(header.raw.startTime),
        specReference: 'EDF specification, header record bytes 176-183',
      }),
    );
  }

  const headerDate = startTime.headerDate;
  const recordingIdDate = startTime.recordingIdDate;
  /*
   * The EDF+ `yy` escape leaves `headerDate` undefined by construction — the field still states a
   * day and a month, just no year — so a guard on `headerDate !== undefined` can never fire for it
   * and `validateHeader` could not see a disagreement the parser reports. `resolveStartTime`
   * compares the day and month in that case, so the two disagreed about whether the same header
   * has a defect, and this function is documented as standing on its own (fixed in 0.3.81).
   *
   * The raw field is the only place the day and month survive when `headerDate` is undefined.
   */
  const yearEscape =
    headerDate === undefined ? parseHeaderStartDate(header.raw.startDate) : undefined;
  const yearEscapeDisagrees =
    yearEscape?.status === 'yearEscape' &&
    recordingIdDate !== undefined &&
    (yearEscape.day !== recordingIdDate.day || yearEscape.month !== recordingIdDate.month);

  if (yearEscapeDisagrees && recordingIdDate !== undefined && yearEscape !== undefined) {
    into.push(
      createDiagnostic({
        code: 'DATE_FIELDS_DISAGREE',
        message:
          `the startdate field states day ${String(yearEscape.day)}, month ${String(yearEscape.month)} ` +
          `with the EDF+ "yy" year escape, but the recording identification Startdate says ` +
          `${formatCalendarDate(recordingIdDate)}. EDF+ additional specification 4: the two state ` +
          'the same day, and only the second can express a year outside 1985-2084. ' +
          'Next: header.raw.startDate and header.recording.raw both keep their text verbatim.',
        field: 'startDate',
        byteOffset: 168,
        byteLength: 8,
        raw: header.raw.startDate,
        expected: formatCalendarDate(recordingIdDate),
        actual: `day ${String(yearEscape.day)}, month ${String(yearEscape.month)}`,
        specReference: 'EDF+ additional specification 4 (startdate)',
      }),
    );
  }

  if (
    headerDate !== undefined &&
    recordingIdDate !== undefined &&
    !calendarDatesEqual(headerDate, recordingIdDate)
  ) {
    into.push(
      createDiagnostic({
        code: 'DATE_FIELDS_DISAGREE',
        message:
          `the startdate field resolves to ${formatCalendarDate(headerDate)} but the recording ` +
          `identification Startdate says ${formatCalendarDate(recordingIdDate)}. EDF+ additional ` +
          'specification 4: the two state the same day, and only the second can express a ' +
          'four-digit year. Next: both are exposed on header.startTime and edfcore picks no ' +
          `winner beyond dateSource, which is ${JSON.stringify(startTime.dateSource)} here.`,
        field: 'startDate',
        byteOffset: 168,
        byteLength: 8,
        raw: header.raw.startDate,
        expected: formatCalendarDate(recordingIdDate),
        actual: formatCalendarDate(headerDate),
        specReference: 'EDF+ additional specification 4 (local recording identification)',
      }),
    );
  }

  // Unreachable today, and kept deliberately rather than deleted. `resolveStartTime` leaves
  // `resolvedDate` UNDEFINED for a date that names no real day and reports `DATE_UNPARSEABLE`
  // instead, so this condition cannot currently hold — `tests/unit/dates-validation.test.ts` pins
  // that interaction from both sides. It stays because the day `resolveStartTime` starts resolving
  // a best-effort date rather than refusing one, this is the check that has to be here, and a
  // missing guard is harder to notice than an idle one.
  const resolved = startTime.resolvedDate;
  if (resolved !== undefined && !isValidCalendarDate(resolved)) {
    into.push(
      createDiagnostic({
        code: 'DATE_IMPLAUSIBLE',
        message:
          `the recording start date reads ${formatCalendarDate(resolved)}, which is not a day ` +
          'that exists. EDF specification, header record bytes 168-175. Next: the fields are ' +
          'exposed exactly as they were read and nothing is corrected — a date edfcore repaired ' +
          'would be indistinguishable from one the equipment got right.',
        field: 'startDate',
        byteOffset: 168,
        byteLength: 8,
        raw: header.raw.startDate,
        expected: 'an existing calendar day',
        actual: formatCalendarDate(resolved),
        specReference: 'EDF specification, header record bytes 168-175',
      }),
    );
  }

  const birthDate = patient.birthDate;
  if (birthDate !== undefined && resolved !== undefined && compareDates(birthDate, resolved) > 0) {
    into.push(
      createDiagnostic({
        code: 'DATE_IMPLAUSIBLE',
        message:
          `the patient birthdate ${formatCalendarDate(birthDate)} is after the recording start ` +
          `date ${formatCalendarDate(resolved)}. EDF+ additional specification 3. Next: both are ` +
          'exposed as read; the usual cause is a two-digit header year resolved through the ' +
          '1985-2084 rule for a recording made outside that window, which the recording ' +
          'identification Startdate would settle.',
        field: 'patientId',
        byteOffset: 8,
        byteLength: 80,
        raw: header.patient.raw,
        expected: `a birthdate at or before ${formatCalendarDate(resolved)}`,
        actual: formatCalendarDate(birthDate),
        specReference: 'EDF+ additional specification 3 (local patient identification)',
      }),
    );
  }
}

/**
 * Header conformance, as a standalone list.
 *
 * Pure, synchronous and independent of `header.diagnostics`: none of these checks affects a byte
 * offset, so none of them is on the read path, and running them twice costs nothing.
 */
export function validateHeader(header: EdfHeader): readonly EdfDiagnostic[] {
  const diagnostics: EdfDiagnostic[] = [];

  checkRecordSize(header, diagnostics);
  for (const signalIndex of header.dataSignalIndices) {
    const signal = header.signals[signalIndex];
    if (signal === undefined) continue;
    checkLabelConvention(header, signal, diagnostics);
    checkPrefiltering(header, signal, diagnostics);
    checkTransducer(header, signal, diagnostics);
  }
  checkIdentification(header, diagnostics);
  checkDates(header, diagnostics);

  return Object.freeze(diagnostics);
}

/** Running totals for one signal, kept as plain numbers so the scan loop stays branch-light. */
interface StatsAccumulator {
  readonly signalIndex: number;
  min: number;
  max: number;
  outOfDigitalRangeCount: number;
  sampleCount: number;
}

function finaliseStats(accumulator: StatsAccumulator): ObservedSignalStats {
  const empty = accumulator.sampleCount === 0;
  return {
    signalIndex: accumulator.signalIndex,
    // A signal with no samples has no observed extremes. Reporting 0/0 rather than
    // Infinity/-Infinity keeps the struct numeric; `sampleCount === 0` is what says it is empty.
    observedDigitalMin: empty ? 0 : accumulator.min,
    observedDigitalMax: empty ? 0 : accumulator.max,
    outOfDigitalRangeCount: accumulator.outOfDigitalRangeCount,
    sampleCount: accumulator.sampleCount,
  };
}

/** A supplied index is only usable when it covers this file completely. */
function usableIndex(
  index: EdfRecordIndex | undefined,
  recordCount: number,
): EdfRecordIndex | undefined {
  if (index === undefined) return undefined;
  if (index.coverage !== 'complete') return undefined;
  if (index.recordCount !== recordCount) return undefined;
  if (index.segments === undefined || index.gaps === undefined) return undefined;
  return index;
}

function reportStructure(
  header: EdfHeader,
  segmentCount: number,
  gaps: readonly EdfGap[],
  into: EdfDiagnostic[],
): void {
  if (header.continuity === 'continuous' && segmentCount > 1) {
    // Partitioned by sign, the way `edfcore gaps` was in 0.3.3. An overlap travels in this array
    // with a NEGATIVE duration (0.2.69), so counting every entry as a gap told a reader that a
    // file missing no data at all had one — while the RECORD_ONSET_SPACING_VIOLATION appended a
    // few lines below correctly called the same boundary an overlap.
    const holes = gaps.filter((gap) => gap.durationTicks > 0n).length;
    const overlaps = gaps.length - holes;
    const between =
      overlaps === 0
        ? `${pluralise(holes, 'gap')} between them`
        : holes === 0
          ? `${pluralise(overlaps, 'overlap')} between them`
          : `${pluralise(holes, 'gap')} and ${pluralise(overlaps, 'overlap')} between them`;
    into.push(
      createDiagnostic({
        code: 'DISCONTINUITY_IN_CONTINUOUS_FILE',
        message:
          `the reserved field marks this file continuous, but its record onsets fall into ` +
          `${segmentCount} separate segments with ${between}. Rule: in a ` +
          'continuous file every record onset is startOffset + recordIndex * recordDuration; a ' +
          'recording with gaps is what EDF+D exists for, and an overlap is sanctioned by ' +
          'neither. Next: treat the file as discontinuous — ' +
          'readWindow() returns one chunk per contiguous run once you pass it a complete index, ' +
          'instead of crossing a gap silently.',
        field: 'timekeeping TAL',
        expected: '1 contiguous segment',
        actual: `${segmentCount} segments`,
        specReference: TIMEKEEPING_SPEC,
      }),
    );
  }

  for (const gap of gaps) {
    if (gap.durationSeconds >= 0) continue;
    into.push(
      createDiagnostic({
        code: 'RECORD_ONSET_SPACING_VIOLATION',
        message:
          `segment ${gap.afterSegmentIndex} starts at ${gap.endSeconds} s, before segment ` +
          `${gap.beforeSegmentIndex} ends at ${gap.startSeconds} s, so those records overlap in ` +
          `time by ${-gap.durationSeconds} s. Rule: consecutive record onsets are spaced by at ` +
          'least the record duration — a discontinuous file may leave gaps between records but ' +
          'never overlaps them. Next: the onsets were used exactly as written and nothing was ' +
          'reordered; index.segments shows which records are involved.',
        field: 'timekeeping TAL',
        expected: `a start at or after ${gap.startSeconds} s`,
        actual: `${gap.endSeconds} s`,
        specReference: TIMEKEEPING_SPEC,
      }),
    );
  }
}

interface Traversal {
  readonly onsets: BigInt64Array;
  readonly diagnostics: readonly EdfDiagnostic[];
  readonly recordsScanned: number;
  readonly bytesRead: number;
  readonly signalStats: readonly ObservedSignalStats[];
}

/**
 * ONE pass over the file, doing every job that needs the bytes.
 *
 * The annotation regions and the sample blocks of a record live in the same bytes, so decoding
 * onsets and observing sample extremes in the same pass costs one traversal rather than two. That
 * is also why `options.index` saves anything: with a complete index the onsets are already known,
 * so a sweep that does not want sample statistics needs no traversal at all.
 *
 * Chunk size comes from `record-index.ts`, so a validation sweep and an index build have the same
 * bounded working set.
 */
async function traverse(
  recording: EdfRecording,
  options: ValidateOptions | undefined,
  scanSamples: boolean,
): Promise<Traversal> {
  const { source, header } = recording;
  const recordCount = header.recordCount;
  const onsets = new BigInt64Array(recordCount);
  const diagnostics: EdfDiagnostic[] = [];
  // Across the whole sweep, not across one chunk: the codes `decodeAnnotations` caps per CALL are
  // capped per SWEEP here, because this loop makes one call per scan chunk and the chunk size is a
  // memory budget. See `appendChunkDiagnostics`.
  const cappedSeen = new Set<string>();

  const accumulators: StatsAccumulator[] = scanSamples
    ? header.dataSignalIndices.map((signalIndex) => ({
        signalIndex,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
        outOfDigitalRangeCount: 0,
        sampleCount: 0,
      }))
    : [];

  const chunkRecords = scanChunkRecords(header, options?.maxMaterializeBytes);
  /*
   * One scratch array for every signal and every chunk.
   *
   * This is normally bounded by the chunk's own byte size, because `scanChunkRecords` fits the
   * chunk into a scan block. That bound fails for a single record larger than the whole block:
   * the record count floors to 1 and the scratch size becomes `samplesPerRecord` unclamped, up
   * to the 99,999,999 an 8-byte EDF field can hold — a 400 MB allocation reachable from one
   * corrupted digit in a 512-byte file, made before any read, so no downstream check can catch
   * it. Validation exists to be pointed at untrusted files, so it is exactly the caller who
   * needs the budget honoured rather than a documented cap that only the read path respects.
   */
  let scratch: Int32Array | undefined;
  if (scanSamples) {
    let maxSamplesPerRecord = 0;
    for (const accumulator of accumulators) {
      const signal = header.signals[accumulator.signalIndex];
      if (signal !== undefined) {
        maxSamplesPerRecord = Math.max(maxSamplesPerRecord, signal.samplesPerRecord);
      }
    }
    // Clamped to the records that EXIST. `chunkRecords` is a chunk size, chosen from the record
    // geometry and not from the file's length, so on a short file it is larger than the whole
    // recording — a 4-record file was budgeted and allocated for a full chunk it can never fill,
    // and a 552-byte file was refused under any budget below 8 MiB. That is the opposite of the
    // failure this guard exists for: refusing a read that is genuinely small.
    const scratchRecords = Math.min(chunkRecords, Math.max(0, header.recordCount));
    const scratchBytes = scratchRecords * maxSamplesPerRecord * BYTES_PER_SCRATCH_SAMPLE;
    const budgetBytes = resolveMaterializeBudget(options?.maxMaterializeBytes);
    if (scratchBytes > budgetBytes) {
      // "Drop scanSamples" only helps when dropping it stops the sweep reading. On EDF+/BDF+ it
      // does not: the onsets live in each record's annotation region, so the traversal runs
      // either way and refuses again at the same budget with a different message. Offering it
      // there sent the reader round a loop — the second refusal is the record-read guard, whose
      // own advice is to read fewer records per call, which is not a lever this caller holds
      // (fixed in 0.3.77).
      const canSkipReading = header.annotationSignalIndices.length === 0;
      throw new EdfBudgetError(
        `Scanning samples needs a ${scratchBytes}-byte scratch buffer for ${scratchRecords} ` +
          `records of up to ${pluralise(maxSamplesPerRecord, 'sample')}, above the ` +
          `${budgetBytes}-byte ` +
          'maxMaterializeBytes budget, so the scan was refused before anything was allocated. ' +
          'Next: raise options.maxMaterializeBytes' +
          (canSkipReading
            ? ', or drop scanSamples and validate the header alone.'
            : ' — this file declares an annotations signal, so its record onsets are read even ' +
              'with scanSamples off and the sweep would refuse again at this budget. ' +
              'validateHeader(header) is the form that reads nothing.'),
        { requiredBytes: scratchBytes, budgetBytes },
      );
    }
    scratch = new Int32Array(scratchRecords * maxSamplesPerRecord);
  }

  let recordsScanned = 0;
  let bytesRead = 0;
  while (recordsScanned < recordCount) {
    const records: RecordRange = {
      start: recordsScanned,
      count: Math.min(chunkRecords, recordCount - recordsScanned),
    };
    const bytes = await readRecordBytes(source, header, records, options);
    bytesRead += bytes.length;

    // Never strict: a sweep whose job is to list every defect must not stop at the first one.
    // The origin is the recording's, so the sweep's verdict does not depend on its chunk size.
    const decoded = decodeAnnotations(header, bytes, records, {
      originTicks: recording.timeline.startOffsetTicks,
    });
    onsets.set(decoded.recordOnsetTicks, records.start);
    appendChunkDiagnostics(diagnostics, decoded.diagnostics, cappedSeen);

    for (const accumulator of accumulators) {
      const digital = decodeDigitalCounted(
        header,
        bytes,
        records,
        accumulator.signalIndex,
        scratch,
        options,
      );
      const samples = digital.digital;
      for (let i = 0; i < samples.length; i += 1) {
        // biome-ignore lint/style/noNonNullAssertion: i is bounded by samples.length.
        const value = samples[i]!;
        if (value < accumulator.min) accumulator.min = value;
        if (value > accumulator.max) accumulator.max = value;
      }
      accumulator.outOfDigitalRangeCount += digital.outOfDigitalRangeCount;
      accumulator.sampleCount += samples.length;
    }

    recordsScanned += records.count;
    options?.onProgress?.(recordsScanned, recordCount);
  }

  return {
    onsets,
    diagnostics,
    recordsScanned,
    bytesRead,
    signalStats: accumulators.map(finaliseStats),
  };
}

/**
 * The full conformance sweep.
 *
 * What it costs is stated rather than hidden: `recordsScanned` and `bytesRead` are what actually
 * happened, so a report claiming a file is clean also says how much of it was looked at. A sweep
 * with `scanSamples: false` over a file whose onsets are already known — a complete
 * `options.index`, or a plain EDF whose onsets are arithmetic — reads nothing at all and says so.
 *
 * `diagnostics` gathers everything known about the recording in one array: what the header parse
 * found, what `validateHeader` re-checks, what the timeline probes saw, and what the traversal
 * decoded. Duplicates between them are left in — deduplicating would silently drop the second of
 * two genuinely different occurrences of the same code.
 *
 * A non-monotonic timeline still THROWS, here as everywhere: it is always fatal, because no
 * answer derived from those onsets would mean anything.
 */
export async function validateRecording(
  recording: EdfRecording,
  options?: ValidateOptions,
): Promise<ValidationReport> {
  const { header, timeline } = recording;
  const recordCount = header.recordCount;
  const scanSamples = options?.scanSamples === true;
  const supplied = usableIndex(options?.index, recordCount);
  const onsetsAreArithmetic = header.annotationSignalIndices.length === 0;

  const diagnostics: EdfDiagnostic[] = [
    ...header.diagnostics,
    ...validateHeader(header),
    ...timeline.diagnostics,
  ];

  const mustReadOnsets = supplied === undefined && !onsetsAreArithmetic;
  const traversal =
    scanSamples || mustReadOnsets ? await traverse(recording, options, scanSamples) : undefined;
  // A sweep that read nothing still finished. `scanOnsets` owns the rule for this same option and
  // states it: a file it does not need to scan is still reported once, "with the traversal
  // complete, so a caller's bar finishes". Neither case here could say so — a sweep that skipped
  // its traversal never entered the loop, and a file with no records entered it and stopped — so a
  // progress bar over `validateRecording` sat at zero for exactly the files that finished fastest.
  if (traversal === undefined || recordCount === 0) options?.onProgress?.(recordCount, recordCount);
  if (traversal !== undefined) appendDiagnostics(diagnostics, traversal.diagnostics);

  let segmentCount: number;
  let gaps: readonly EdfGap[];
  if (supplied?.segments !== undefined && supplied.gaps !== undefined) {
    segmentCount = supplied.segments.length;
    gaps = supplied.gaps;
  } else if (traversal !== undefined) {
    assertMonotonicOnsetArray(traversal.onsets);
    const segmentation = buildSegmentation(
      traversal.onsets,
      header.recordDurationTicks,
      timeline.startOffsetTicks,
    );
    segmentCount = segmentation.segments.length;
    gaps = segmentation.gaps;
  } else {
    // No stored onsets and none read: record r starts at r * recordDuration by definition, so the
    // recording is one segment and there is nothing structural left to disagree about.
    segmentCount = recordCount > 0 ? 1 : 0;
    gaps = [];
  }
  reportStructure(header, segmentCount, gaps, diagnostics);

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    diagnostics: Object.freeze(diagnostics),
    recordsScanned: traversal?.recordsScanned ?? 0,
    bytesRead: traversal?.bytesRead ?? 0,
    signalStats: Object.freeze(traversal?.signalStats ?? []),
  };
}
