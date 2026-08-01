/**
 * Every public data shape in edfcore.
 *
 * Layer 0. Types only — this module emits no runtime code, so any layer may import it without
 * creating a dependency edge.
 *
 * Two conventions run through the whole file:
 *
 * 1. A field that may be absent is declared `T | undefined` and is always present as a key.
 *    Optional (`?`) is reserved for *options* the caller passes in. Reading a result should
 *    never require knowing whether a key exists.
 * 2. Anything that can be checked against the file is exposed twice — as parsed value and as
 *    the raw bytes it came from. edfcore never destroys evidence.
 */

import type { EdfDiagnosticCode, EdfSeverity } from './diagnostics/codes.js';

export type {
  EdfDiagnosticCode,
  EdfKnownDiagnosticCode,
  EdfSeverity,
} from './diagnostics/codes.js';

// ===========================================================================
// Structural platform shims
//
// edfcore compiles with `lib: ["ES2022"]` and `types: []`, so neither the DOM nor
// @types/node can leak into the published .d.ts. These structural interfaces are what the
// real platform types are checked against — `tests/types/shim-assignability.test-d.ts`
// asserts the real ones remain assignable.
// ===========================================================================

export interface AbortSignalLike {
  readonly aborted: boolean;
}

export interface BlobLike {
  readonly size: number;
  slice(start?: number, end?: number): BlobLike;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface HttpResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * `globalThis.fetch` is assignable to this.
 *
 * `signal` is deliberately absent from `init`: naming it would drag in the real `AbortSignal`
 * by parameter contravariance, which is the exact DOM dependency these shims exist to avoid.
 * It is still passed at runtime.
 */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; method?: string },
) => Promise<HttpResponseLike>;

// ===========================================================================
// I/O
// ===========================================================================

export interface ReadOptions {
  readonly signal?: AbortSignalLike;
  /** Refuse before allocating rather than dying inside it. Default 256 MiB. */
  readonly maxMaterializeBytes?: number;
}

export interface ParseOptions {
  /**
   * When true the first would-be diagnostic throws `EdfFormatError` carrying it, so every
   * `diagnostics` array is consequently empty. Check order is pinned and tested, which is what
   * makes error identity stable across refactors.
   */
  readonly strict?: boolean;
}

export type OpenOptions = ParseOptions & ReadOptions;

/**
 * A random-access byte range reader.
 *
 * CONTRACT, verified on every call including user-supplied sources: `read` resolves with
 * EXACTLY `length` bytes or rejects. It never pads and never truncates. The returned array is
 * owned by the caller, so a caching implementation must hand back a copy.
 */
export interface ByteSource {
  readonly byteLength: number;
  read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array>;
  close?(): Promise<void> | void;
}

export interface HttpSourceOptions extends ReadOptions {
  readonly fetch?: FetchLike;
  readonly headers?: Readonly<Record<string, string>>;
  readonly byteLength?: number;
  readonly maxConcurrency?: number;
  /** Server answered 200 instead of 206. Default false, i.e. throw rather than silently
   *  buffering gigabytes the caller did not ask for. */
  readonly allowFullDownload?: boolean;
}

export interface CacheOptions {
  /** Block size in bytes. Default 1 MiB. Blocks are byte-aligned, not record-aligned: the
   *  cache is format-independent by construction and never sees a header to learn a record
   *  size from. Round this to a multiple of `header.recordByteLength` yourself if you want
   *  block boundaries to fall on record boundaries. */
  readonly blockBytes?: number;
  /** LRU budget. Default 64 MiB. */
  readonly maxBytes?: number;
}

// ===========================================================================
// Header model
// ===========================================================================

export type EdfVariant = 'EDF' | 'EDF+C' | 'EDF+D' | 'BDF' | 'BDF+C' | 'BDF+D';

export interface EdfCalendarDate {
  readonly year: number;
  /** 1-12. Not a JavaScript month index. */
  readonly month: number;
  readonly day: number;
}

export interface EdfClockTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * EDF records local time at the patient with no timezone, so edfcore never produces a `Date`:
 * a `Date` silently applies the reader's zone, and is worst exactly at DST boundaries.
 */
export interface EdfStartTime {
  /** From the `dd.mm.yy` header field, through the 1985-2084 rule. */
  readonly headerDate: EdfCalendarDate | undefined;
  /** From the EDF+ recording-identification `Startdate` subfield — the only unambiguous
   *  four-digit year, and the only way past 2084. */
  readonly recordingIdDate: EdfCalendarDate | undefined;
  readonly resolvedDate: EdfCalendarDate | undefined;
  readonly dateSource: 'headerField' | 'recordingIdField' | 'none';
  readonly clock: EdfClockTime;
  readonly secondsSinceMidnight: number;
}

export interface EdfPatientId {
  readonly raw: string;
  readonly conformant: boolean;
  readonly code: string | undefined;
  readonly sex: 'F' | 'M' | undefined;
  readonly birthDate: EdfCalendarDate | undefined;
  readonly name: string | undefined;
  readonly extraSubfields: readonly string[];
}

export interface EdfRecordingId {
  readonly raw: string;
  readonly conformant: boolean;
  readonly startDate: EdfCalendarDate | undefined;
  readonly investigationCode: string | undefined;
  readonly technicianCode: string | undefined;
  readonly equipmentCode: string | undefined;
  readonly extraSubfields: readonly string[];
}

/**
 * `physical = bitValue * (offset + digital)`.
 *
 * This is EDFlib's exact expression, kept verbatim for float64 bit-parity with pyEDFlib.
 * It is *not* the numerically better form, and it must not be "simplified" — see
 * `src/decode/physical.ts`.
 */
export interface EdfScale {
  readonly bitValue: number;
  readonly offset: number;
}

/** Header text exactly as written, before trimming or interpretation. */
export interface EdfRawSignalFields {
  readonly label: string;
  readonly transducerType: string;
  readonly physicalDimension: string;
  readonly physicalMinimum: string;
  readonly physicalMaximum: string;
  readonly digitalMinimum: string;
  readonly digitalMaximum: string;
  readonly prefiltering: string;
  readonly samplesPerRecord: string;
  readonly reserved: string;
}

export interface EdfRawHeaderFields {
  readonly version: string;
  readonly patientId: string;
  readonly recordingId: string;
  readonly startDate: string;
  readonly startTime: string;
  readonly headerByteLength: string;
  readonly reserved: string;
  readonly recordCount: string;
  readonly recordDuration: string;
  readonly signalCount: string;
}

export interface EdfSignal {
  readonly index: number;
  readonly kind: 'data' | 'annotations';
  /** Trimmed. `raw.label` keeps the padding. */
  readonly label: string;
  readonly transducerType: string;
  readonly prefiltering: string;
  /** Trimmed. `raw.physicalDimension` keeps the padding and the exact bytes. */
  readonly physicalDimension: string;
  /** Normalised for comparison only: the several encodings of micro all become `u`. */
  readonly unit: string;
  readonly physicalMinimum: number;
  /** MAY be less than the minimum: that is a negative amplifier gain, it is legal, and
   *  edfcore never "fixes" it. */
  readonly physicalMaximum: number;
  readonly digitalMinimum: number;
  readonly digitalMaximum: number;
  /** Authoritative. Sample indexing uses this, never a rate. */
  readonly samplesPerRecord: number;
  /** Derived. `undefined` exactly when `recordDurationSeconds === 0`, which is legal.
   *  Never index by this. */
  readonly sampleRateHz: number | undefined;
  readonly sampleCount: number;
  /** `undefined` when scaling is impossible or unsafe: a degenerate or inverted digital
   *  range, a degenerate physical range, or a log-transformed channel. `toPhysical` then
   *  throws `EdfScalingError`; `decodeDigital` keeps working. */
  readonly scale: EdfScale | undefined;
  /** Byte offset of this signal's block within one data record. */
  readonly recordByteOffset: number;
  readonly recordByteLength: number;
  readonly raw: EdfRawSignalFields;
}

export interface EdfHeader {
  readonly variant: EdfVariant;
  readonly continuity: 'continuous' | 'discontinuous';
  readonly bytesPerSample: 2 | 3;
  /** Always the computed `256 * (ns + 1)`, never the declared value. */
  readonly headerByteLength: number;
  /** What the file claims at offset 184. Kept so a mismatch stays visible. */
  readonly declaredHeaderByteLength: number;
  readonly recordByteLength: number;
  readonly dataByteLength: number;
  /** MAY legitimately be 0 — then never divide by it. */
  readonly recordDurationSeconds: number;
  readonly recordDurationTicks: bigint;
  /** Resolved and non-negative. */
  readonly recordCount: number;
  /** Verbatim. `-1` means the writer never closed the file. */
  readonly declaredRecordCount: number;
  readonly recordCountSource: 'headerField' | 'sourceByteLength';
  readonly startTime: EdfStartTime;
  readonly patient: EdfPatientId;
  readonly recording: EdfRecordingId;
  readonly signals: readonly EdfSignal[];
  readonly dataSignalIndices: readonly number[];
  readonly annotationSignalIndices: readonly number[];
  /** The full 44 reserved bytes, verbatim. */
  readonly reserved: string;
  readonly raw: EdfRawHeaderFields;
  /** The whole header, for hexdumps and bug reports. */
  readonly rawBytes: Uint8Array;
  readonly diagnostics: readonly EdfDiagnostic[];
}

// ===========================================================================
// Time
// ===========================================================================

/** Start plus count, never start plus end: there is no inclusive/exclusive ambiguity. */
export interface RecordRange {
  readonly start: number;
  readonly count: number;
}

export interface EdfSegment {
  readonly index: number;
  readonly records: RecordRange;
  readonly startSeconds: number;
  readonly startTicks: bigint;
  readonly durationSeconds: number;
  readonly endSeconds: number;
}

export interface EdfGap {
  readonly beforeSegmentIndex: number;
  readonly afterSegmentIndex: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly durationSeconds: number;
}

export interface EdfLocation {
  readonly recordIndex: number;
  readonly recordStartSeconds: number;
  readonly offsetInRecordSeconds: number;
}

export interface EdfTimeline {
  readonly recordCount: number;
  readonly recordDurationSeconds: number;
  /** Sub-second start carried by record 0's timekeeping TAL. In [0, 1). */
  readonly startOffsetSeconds: number;
  readonly startOffsetTicks: bigint;
  /** Last record end minus first record start. Includes gaps. */
  readonly spanSeconds: number;
  /** Sum of record durations. Equals `spanSeconds` exactly when the file is contiguous. */
  readonly coveredSeconds: number;
  readonly diagnostics: readonly EdfDiagnostic[];
}

export interface EdfRecordIndex {
  /** `probed` = record 0 and the last record only. `complete` = every record verified. */
  readonly coverage: 'probed' | 'complete';
  readonly recordCount: number;
  /** Present only when `coverage === 'complete'`. Deliberately absent otherwise: no property
   *  on this object may ever read as "continuous" when we have not checked. */
  readonly segments: readonly EdfSegment[] | undefined;
  readonly gaps: readonly EdfGap[] | undefined;
  /** One targeted read of that record's annotation region. Memoised. */
  onsetTicks(recordIndex: number, options?: ReadOptions): Promise<bigint>;
  /** O(log recordCount) probes. Onsets are monotonic; any observed violation is fatal. */
  locate(seconds: number, options?: ReadOptions): Promise<EdfLocation | undefined>;
}

export interface BuildIndexOptions extends ParseOptions, ReadOptions {
  readonly onProgress?: (done: number, total: number) => void;
}

// ===========================================================================
// Samples and annotations
// ===========================================================================

export interface EdfChunkSignal {
  readonly signalIndex: number;
  /** The truth. Never padded to a round number. */
  readonly sampleCount: number;
  readonly digital: Int32Array;
  /** Index of the first sample on this signal's own sample grid. */
  readonly firstSampleIndex: number;
  /** Start of this signal's samples. A record-aligned read gives every signal the same
   *  value, since they all begin at the same record; it becomes genuinely per-signal after
   *  `trimToWindow`, where each signal's own sample grid decides the boundary. */
  readonly startSeconds: number;
  /** Counted during decode, so it costs nothing. A non-zero count means the declared
   *  digital range is wrong, not that the samples are. */
  readonly outOfDigitalRangeCount: number;
}

export interface EdfChunk {
  readonly records: RecordRange;
  readonly startSeconds: number;
  readonly durationSeconds: number;
  readonly byteOffset: number;
  /** Bytes actually read from the source. Makes overread visible instead of invisible. */
  readonly byteLength: number;
  readonly signals: readonly EdfChunkSignal[];
  readonly precededByGap: EdfGap | undefined;
  readonly diagnostics: readonly EdfDiagnostic[];
}

export interface EdfAnnotation {
  /** Verbatim on-disk value, relative to the header startdate/starttime (EDF+ 2.2.4). */
  readonly onsetSecondsFromHeaderStart: number;
  /** Rebased to the first record's true start — the EDFlib/pyEDFlib/MNE convention. */
  readonly onsetSecondsFromFirstRecord: number;
  /** Exact, in 100 ns units. Compare event times with this, never with the floats. */
  readonly onsetTicks: bigint;
  /** The original digits, so precision is never lost to a round-trip. */
  readonly onsetRaw: string;
  readonly durationSeconds: number | undefined;
  readonly durationTicks: bigint | undefined;
  readonly durationRaw: string | undefined;
  /** Verbatim. Never trimmed, never case-folded. */
  readonly text: string;
  /** From the EDF+ `description@@channel` convention. */
  readonly channelLabel: string | undefined;
  readonly signalIndex: number;
  readonly recordIndex: number;
  readonly byteOffsetInRecord: number;
  readonly textEncoding: 'utf-8' | 'latin-1-fallback';
}

export interface EdfAnnotationsResult {
  /** Timekeeping TALs and empty texts excluded. Stable sort by
   *  (onsetTicks, signalIndex, byteOffsetInRecord). */
  readonly annotations: readonly EdfAnnotation[];
  /** One entry per record in the decoded range. This is the primitive the timeline is
   *  built from. */
  readonly recordOnsetTicks: BigInt64Array;
  readonly diagnostics: readonly EdfDiagnostic[];
}

// ===========================================================================
// Diagnostics
// ===========================================================================

export interface EdfDiagnostic {
  readonly code: EdfDiagnosticCode;
  readonly severity: EdfSeverity;
  /** Names the field, the raw bytes as written, the rule, and an actionable next step. */
  readonly message: string;
  readonly field: string | undefined;
  readonly byteOffset: number | undefined;
  readonly byteLength: number | undefined;
  readonly rawBytes: Uint8Array | undefined;
  readonly raw: string | undefined;
  readonly expected: string | undefined;
  readonly actual: string | undefined;
  readonly signalIndex: number | undefined;
  readonly recordIndex: number | undefined;
  /** A spec clause, e.g. 'EDF+ additional specification 5'. Verifiable and stable, unlike a
   *  claim about how some other library behaves. */
  readonly specReference: string | undefined;
}

// ===========================================================================
// Recording and selections
// ===========================================================================

export interface EdfRecording {
  readonly source: ByteSource;
  readonly header: EdfHeader;
  readonly timeline: EdfTimeline;
  readonly index: EdfRecordIndex;
}

export interface RecordSelection {
  readonly records: RecordRange;
  /** Required, with no "all signals" default: a 256-channel file must never be read
   *  wholesale because an argument was omitted. */
  readonly signalIndices: readonly number[];
}

export interface WindowSelection {
  readonly startSeconds: number;
  readonly durationSeconds: number;
  readonly signalIndices: readonly number[];
}

export interface DecodeAnnotationsOptions extends ParseOptions {
  /** Defaults to every annotation signal. Only the first carries timekeeping. */
  readonly signalIndices?: readonly number[];
}

/** Header-only triage. Reads at most 128 KiB and never throws on malformed content. */
export interface EdfInspection {
  readonly ok: boolean;
  readonly variant: EdfVariant | undefined;
  readonly header: EdfHeader | undefined;
  readonly byteLength: number;
  readonly bytesRead: number;
  readonly headerBytes: Uint8Array | undefined;
  readonly diagnostics: readonly EdfDiagnostic[];
}

// ===========================================================================
// Validation (edfcore/validate)
// ===========================================================================

export interface ValidateOptions extends ReadOptions {
  /** Reuse a completed index so conformance costs one traversal, not two. */
  readonly index?: EdfRecordIndex;
  readonly scanSamples?: boolean;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface ObservedSignalStats {
  readonly signalIndex: number;
  readonly observedDigitalMin: number;
  readonly observedDigitalMax: number;
  readonly outOfDigitalRangeCount: number;
  readonly sampleCount: number;
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly diagnostics: readonly EdfDiagnostic[];
  readonly recordsScanned: number;
  readonly bytesRead: number;
  readonly signalStats: readonly ObservedSignalStats[];
}
