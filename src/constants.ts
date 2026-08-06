/**
 * Format constants.
 *
 * Layer 0. Imports nothing. Every magic number the parser relies on lives here with the
 * clause it comes from, so no other file needs a bare literal.
 */

/** The fixed header is one of these, and each signal adds exactly one more. */
export const EDF_HEADER_BLOCK_BYTES = 256 as const;

/** Total header size is always `EDF_HEADER_BLOCK_BYTES * (signalCount + 1)`. */
export const EDF_SIGNAL_HEADER_BYTES = 256 as const;

/** Trimmed, case-sensitive. On disk the field is `'EDF Annotations '` — 15 chars plus a pad. */
export const EDF_ANNOTATIONS_LABEL = 'EDF Annotations' as const;
export const BDF_ANNOTATIONS_LABEL = 'BDF Annotations' as const;

/** EDF spec recommendation, not a limit. Exceeding it is a warning, never an error. */
export const EDF_RECOMMENDED_MAX_RECORD_BYTES = 61440 as const;

/**
 * Time is compared in exact 100 ns ticks, never in floats. Float equality on event times is
 * how ERP alignment silently breaks.
 */
export const TICKS_PER_SECOND = 10000000n;

/** 16-bit two's complement. */
export const EDF_DIGITAL_MIN = -32768 as const;
export const EDF_DIGITAL_MAX = 32767 as const;

/** 24-bit two's complement, sign-extended from bit 23. */
export const BDF_DIGITAL_MIN = -8388608 as const;
export const BDF_DIGITAL_MAX = 8388607 as const;

/** ns lives in a 4-byte field, so it cannot exceed four digits. */
export const EDF_MAX_SIGNAL_COUNT = 9999 as const;

/** Default ceiling for any read that allocates. Refused before allocating, not during. */
export const DEFAULT_MAX_MATERIALIZE_BYTES: number = 256 * 1024 * 1024;

/** TAL structural bytes. Every byte of a multi-byte UTF-8 sequence is >= 0x80, so these can
 *  never collide with text — which is why splitting on structure before decoding is safe. */
export const TAL_ONSET_DURATION_SEPARATOR = 0x15 as const;
export const TAL_FIELD_TERMINATOR = 0x14 as const;
export const TAL_TERMINATOR = 0x00 as const;

/** Fixed-header field offsets and lengths, per the EDF specification. */
export const HEADER_FIELDS = {
  version: { offset: 0, length: 8 },
  patientId: { offset: 8, length: 80 },
  recordingId: { offset: 88, length: 80 },
  startDate: { offset: 168, length: 8 },
  startTime: { offset: 176, length: 8 },
  headerByteLength: { offset: 184, length: 8 },
  reserved: { offset: 192, length: 44 },
  recordCount: { offset: 236, length: 8 },
  recordDuration: { offset: 244, length: 8 },
  signalCount: { offset: 252, length: 4 },
} as const;

/**
 * Per-signal header field widths, in the order they appear.
 *
 * The layout is FIELD-MAJOR, not one struct per signal: all `ns` labels, then all `ns`
 * transducers, and so on. For signal `i`, a field's address is
 * `256 + ns * (sum of widths before it) + i * (its own width)`.
 */
export const SIGNAL_FIELD_WIDTHS = {
  label: 16,
  transducerType: 80,
  physicalDimension: 8,
  physicalMinimum: 8,
  physicalMaximum: 8,
  digitalMinimum: 8,
  digitalMaximum: 8,
  prefiltering: 80,
  samplesPerRecord: 8,
  reserved: 32,
} as const;

/** Cumulative width preceding each per-signal field. Multiply by ns to get its block start. */
export const SIGNAL_FIELD_BLOCK_OFFSETS = {
  label: 0,
  transducerType: 16,
  physicalDimension: 96,
  physicalMinimum: 104,
  physicalMaximum: 112,
  digitalMinimum: 120,
  digitalMaximum: 128,
  prefiltering: 136,
  samplesPerRecord: 216,
  reserved: 224,
} as const;

/** Published package version. Kept in sync with package.json by a test. */
export const VERSION = '0.2.22';
