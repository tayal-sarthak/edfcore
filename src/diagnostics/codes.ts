/**
 * The diagnostic vocabulary.
 *
 * Layer 1. Imports nothing, so every other module may depend on it.
 *
 * A diagnostic is a *value*, never a log line. Each code has exactly one severity and one
 * disposition, both fixed here:
 *
 * - `fatal`    — edfcore cannot proceed without inventing something. Always throws, even when
 *                `strict` is false.
 * - `deferred` — the header parses, but one signal cannot be scaled. `signal.scale` becomes
 *                `undefined`, `decodeDigital` keeps working, and `toPhysical` throws.
 * - `warning`  — the file is impolite but readable, and what we return is true.
 * - `info`     — the file is correct; the note exists because the situation surprises people.
 */

/**
 * How much a diagnostic should worry you. `info` is the one to know: those describe correct
 * files, are carried by nearly every conforming EDF, and are exempt from `strict` — so filtering
 * on severity rather than treating the array as uniformly bad is usually what a caller wants.
 */
export type EdfSeverity = 'error' | 'warning' | 'info';

/** How a code behaves when it fires. See the module comment. */
export type EdfDiagnosticDisposition = 'fatal' | 'deferred' | 'warning' | 'info';

/**
 * Every code edfcore itself can emit, grouped by disposition.
 *
 * This union and the `DISPOSITIONS` map below are checked against each other by the compiler:
 * the map is typed as a total `Record` over this union, so a code added to one and not the
 * other is a build error rather than a silent gap.
 */
export type EdfKnownDiagnosticCode =
  // Always fatal
  | 'NOT_AN_EDF_FILE'
  | 'SOURCE_TOO_SMALL'
  | 'SIGNAL_COUNT_INVALID'
  | 'NUMERIC_FIELD_INVALID'
  | 'COMMA_DECIMAL_SEPARATOR'
  | 'RECORD_SIZE_ZERO'
  | 'EDFPLUS_WITHOUT_ANNOTATION_SIGNAL'
  | 'TIMELINE_NOT_MONOTONIC'
  | 'RECORDING_SPAN_UNREPRESENTABLE'
  // Deferred-fatal: header parses, scaling does not
  | 'DEGENERATE_DIGITAL_RANGE'
  | 'DEGENERATE_PHYSICAL_RANGE'
  | 'INVERTED_DIGITAL_RANGE'
  | 'LOG_TRANSFORMED_CHANNEL'
  | 'SCALE_UNAVAILABLE'
  // Warnings
  | 'HEADER_SIZE_MISMATCH'
  | 'RECORD_COUNT_RECOVERED'
  | 'TRUNCATED_FILE'
  | 'PARTIAL_FINAL_RECORD'
  | 'TRAILING_BYTES'
  | 'RECORD_SIZE_ABOVE_RECOMMENDED'
  | 'NONSTANDARD_RESERVED_FIELD'
  | 'NON_ASCII_HEADER_FIELD'
  | 'NUMERIC_FIELD_NOT_LEFT_JUSTIFIED'
  | 'DATE_FIELDS_DISAGREE'
  | 'DATE_UNPARSEABLE'
  | 'STARTTIME_UNPARSEABLE'
  | 'PATIENT_ID_NONCONFORMANT'
  | 'RECORDING_ID_NONCONFORMANT'
  | 'DUPLICATE_SIGNAL_LABEL'
  | 'DIGITAL_RANGE_EXCEEDS_FORMAT'
  | 'ZERO_SAMPLES_PER_RECORD'
  | 'ZERO_RECORD_DURATION'
  | 'ANNOTATION_SIGNAL_HEADER_NONCONFORMANT'
  | 'MISSING_EDFPLUS_MARKER'
  | 'TIMEKEEPING_TAL_MISSING'
  | 'TIMEKEEPING_TAL_NONCONFORMANT'
  | 'START_OFFSET_OUT_OF_RANGE'
  | 'TAL_MALFORMED'
  | 'TAL_TRUNCATED_AT_REGION_END'
  | 'TAL_REGION_NOT_NUL_TERMINATED'
  | 'ANNOTATION_TEXT_NOT_UTF8'
  | 'RECORD_ONSET_SPACING_VIOLATION'
  | 'DISCONTINUITY_IN_CONTINUOUS_FILE'
  // Info
  | 'DATE_CLIPPED_TO_1985_2084'
  | 'INVERTED_PHYSICAL_RANGE'
  | 'NEGATIVE_ANNOTATION_ONSET';

const DISPOSITIONS: Readonly<Record<EdfKnownDiagnosticCode, EdfDiagnosticDisposition>> = {
  // ---- Always fatal --------------------------------------------------------
  /** No recognisable EDF or BDF version block at offset 0. */
  NOT_AN_EDF_FILE: 'fatal',
  /** Fewer than 256 bytes, or fewer than 256*(ns+1). */
  SOURCE_TOO_SMALL: 'fatal',
  /** ns outside 1..9999, blank, or non-numeric. Every later offset is a multiple of it. */
  SIGNAL_COUNT_INVALID: 'fatal',
  /** A field the file geometry depends on failed its grammar end-to-end. */
  NUMERIC_FIELD_INVALID: 'fatal',
  /** '0,5' and '1,024' are indistinguishable; guessing turns 1024 into 1.024. */
  COMMA_DECIMAL_SEPARATOR: 'fatal',
  /** Every signal declares 0 samples per record, so records have no size to step by. */
  RECORD_SIZE_ZERO: 'fatal',
  /** EDF+ marker present but no annotation signal: no per-record timing exists, so any
   *  time we reported would be invented. */
  EDFPLUS_WITHOUT_ANNOTATION_SIGNAL: 'fatal',
  /** Record onsets went backwards. Every time-based answer would be wrong. */
  TIMELINE_NOT_MONOTONIC: 'fatal',
  RECORDING_SPAN_UNREPRESENTABLE: 'fatal',

  // ---- Deferred-fatal: header parses, scaling does not -----------------------
  /** digitalMinimum === digitalMaximum. Division by zero. EDF+ spec item 5. */
  DEGENERATE_DIGITAL_RANGE: 'deferred',
  /** physicalMinimum === physicalMaximum. Every sample would map to one value. */
  DEGENERATE_PHYSICAL_RANGE: 'deferred',
  /** digitalMinimum > digitalMaximum. Violates EDF+ item 5; we will not guess the intent. */
  INVERTED_DIGITAL_RANGE: 'deferred',
  /** Physical dimension is exactly 'Filtered': values are log-compressed (edffloat.html),
   *  so the linear formula would be wrong by orders of magnitude. Refused, not applied. */
  LOG_TRANSFORMED_CHANNEL: 'deferred',
  /** `toPhysical` was called on a signal with no scale and the specific cause was not
   *  re-derivable from the signal alone. Naming the wrong cause would be worse. */
  SCALE_UNAVAILABLE: 'deferred',

  // ---- Warnings: the file stays readable and what we return is true ----------
  /** Header byte-count field disagrees with 256*(ns+1). The computed value always wins. */
  HEADER_SIZE_MISMATCH: 'warning',
  /** recordCount was -1 (writer never closed the file); recovered from the source length. */
  RECORD_COUNT_RECOVERED: 'warning',
  /** The file is shorter than its declared record count implies. */
  TRUNCATED_FILE: 'warning',
  /** A final partial record exists. Only whole records are exposed; nothing is zero-padded. */
  PARTIAL_FINAL_RECORD: 'warning',
  /** Bytes exist beyond the last whole data record. */
  TRAILING_BYTES: 'warning',
  /** Record exceeds the 61440-byte recommendation. */
  RECORD_SIZE_ABOVE_RECOMMENDED: 'warning',
  /** Reserved field is neither blank nor a recognised EDF+/BDF+ marker. */
  NONSTANDARD_RESERVED_FIELD: 'warning',
  /** A header field carries bytes outside printable ASCII. Decoded as Latin-1. */
  NON_ASCII_HEADER_FIELD: 'warning',
  /** A numeric field is right-justified; the spec requires left-justified. */
  NUMERIC_FIELD_NOT_LEFT_JUSTIFIED: 'warning',
  /** Header startdate and the recording-id Startdate disagree. Both are exposed; we pick no winner. */
  DATE_FIELDS_DISAGREE: 'warning',
  /** The startdate could not be parsed at all. The CLOCK has its own code below. */
  DATE_UNPARSEABLE: 'warning',
  /**
   * The starttime field is not a clock. `startTime.clock` is a substituted midnight and
   * `startTime.clockSource` is `'none'`; the calendar date is unaffected.
   */
  STARTTIME_UNPARSEABLE: 'warning',
  /** Patient identification does not follow the EDF+ subfield grammar. */
  PATIENT_ID_NONCONFORMANT: 'warning',
  /** Recording identification does not follow the EDF+ subfield grammar. */
  RECORDING_ID_NONCONFORMANT: 'warning',
  /** Two signals share a label. `getSignal` by label will throw for these. */
  DUPLICATE_SIGNAL_LABEL: 'warning',
  /** Declared digital range exceeds what the sample width can represent. */
  DIGITAL_RANGE_EXCEEDS_FORMAT: 'warning',
  /** A signal declares 0 samples per record. */
  ZERO_SAMPLES_PER_RECORD: 'warning',
  /** Record duration is 0. Legal in EDF+, but sample rates become undefined. */
  ZERO_RECORD_DURATION: 'warning',
  /** An annotation signal's header fields deviate from the EDF+ requirements. */
  ANNOTATION_SIGNAL_HEADER_NONCONFORMANT: 'warning',
  /** An 'EDF Annotations' signal exists without an EDF+ marker in the reserved field.
   *  Annotations are parsed anyway; the channel is never exposed as an ordinary signal. */
  MISSING_EDFPLUS_MARKER: 'warning',
  /** A data record has no timekeeping TAL. */
  TIMEKEEPING_TAL_MISSING: 'warning',
  /** The timekeeping TAL exists but deviates (e.g. the widespread `+t 0x14 0x00` shorthand). */
  TIMEKEEPING_TAL_NONCONFORMANT: 'warning',
  /** Record 0's sub-second start offset fell outside [0, 1). */
  START_OFFSET_OUT_OF_RANGE: 'warning',
  /** A TAL did not match the grammar. That TAL is skipped; the file is kept. */
  TAL_MALFORMED: 'warning',
  /** A TAL ran past the end of its annotation region and was discarded. */
  TAL_TRUNCATED_AT_REGION_END: 'warning',
  /** The annotation region tail was not NUL padding. */
  TAL_REGION_NOT_NUL_TERMINATED: 'warning',
  /** Annotation text was not valid UTF-8; decoded as Latin-1 instead. */
  ANNOTATION_TEXT_NOT_UTF8: 'warning',
  /** Consecutive record onsets are not spaced by the record duration. */
  RECORD_ONSET_SPACING_VIOLATION: 'warning',
  /** A file marked EDF+C contains a real discontinuity. */
  DISCONTINUITY_IN_CONTINUOUS_FILE: 'warning',

  // ---- Info: correct, and deliberately not a warning ------------------------
  /** A two-digit year was resolved through the spec's own 1985..2084 rule. Every conforming
   *  EDF file has a two-digit year, so this is the normal path, not a defect — it is
   *  reported only because the resolved century is worth being able to see. */
  DATE_CLIPPED_TO_1985_2084: 'info',
  /** physicalMinimum > physicalMaximum encodes a negative amplifier gain. Spec-sanctioned
   *  (EDF FAQ Q6). Never "fixed" — swapping them is a silent polarity flip. */
  INVERTED_PHYSICAL_RANGE: 'info',
  /** A negative annotation onset is normal for pre-stimulus events. */
  NEGATIVE_ANNOTATION_ONSET: 'info',
};

/**
 * Open union: known codes autocomplete, and a `default` branch stays mandatory so adding a
 * code in a minor release cannot break a consumer's exhaustive switch.
 */
export type EdfDiagnosticCode = EdfKnownDiagnosticCode | (string & {});

/**
 * Every known code and how it behaves, as one table. Typed by `EdfKnownDiagnosticCode`, so adding
 * a code to the union without deciding its disposition fails to compile — which is what keeps the
 * two from drifting apart.
 */
export const DIAGNOSTIC_DISPOSITIONS: Readonly<
  Record<EdfKnownDiagnosticCode, EdfDiagnosticDisposition>
> = DISPOSITIONS;

/** Unknown codes are treated as warnings — an unrecognised note must never escalate. */
export function dispositionOf(code: EdfDiagnosticCode): EdfDiagnosticDisposition {
  return DISPOSITIONS[code as EdfKnownDiagnosticCode] ?? 'warning';
}

export function severityOf(code: EdfDiagnosticCode): EdfSeverity {
  const disposition = dispositionOf(code);
  if (disposition === 'fatal' || disposition === 'deferred') return 'error';
  if (disposition === 'warning') return 'warning';
  return 'info';
}

/** Fires regardless of `strict`: proceeding would require inventing data. */
export function isAlwaysFatal(code: EdfDiagnosticCode): boolean {
  return dispositionOf(code) === 'fatal';
}
