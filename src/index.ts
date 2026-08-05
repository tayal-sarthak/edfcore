/**
 * `edfcore` — the universal entry point.
 *
 * Layer 7. Re-exports only: this file contains no logic, so nothing can be true here that is not
 * true in the module that owns it.
 *
 * Two rules hold for everything reachable from this file, transitively:
 *
 * - NO import of a Node built-in, transitively. `edfcore/node` is the only module allowed one, and
 *   a packaging test greps the built universal bundle for the scheme prefix to prove it — which is
 *   also why that prefix is not written out anywhere in this file. It is what lets one build serve
 *   Node, browsers, Deno and Bun with no environment conditions in the exports map: conditions are
 *   the single largest source of ecosystem incompatibility, and a dual CJS/ESM build would load
 *   two copies of `EdfFormatError` and break every `instanceof`.
 * - NO top-level `await`, which is what makes `require(esm)` on Node >= 22.12 safe.
 *
 * The API is three layers, and they are meant to be visible as three. PRIMITIVES are pure,
 * synchronous and take bytes; the I/O LAYER is thin, async and does no caching; the CONVENIENCE
 * LAYER is composition over both. A consumer who outgrows the top layer drops to the one below it
 * without leaving the package.
 */

// ===========================================================================
// Types — every public data shape. `export type` throughout, for
// verbatimModuleSyntax and so nothing here emits a runtime import.
// ===========================================================================

/** The trailing `options` argument shared by every primitive that can allocate. */
export type { MaterializeOptions } from './decode/digital.js';
export type { FormatDiagnosticsOptions } from './diagnostics/format.js';
export type {
  AbortSignalLike,
  BlobLike,
  BuildIndexOptions,
  ByteSource,
  CacheOptions,
  DecodeAnnotationsOptions,
  EdfAnnotation,
  EdfAnnotationsResult,
  EdfAnnotationWindow,
  EdfCalendarDate,
  EdfChunk,
  EdfChunkSignal,
  EdfClockTime,
  EdfDiagnostic,
  EdfDiagnosticCode,
  EdfEnvelopeChunk,
  EdfEnvelopeSignal,
  EdfGap,
  EdfHeader,
  EdfInspection,
  EdfKnownDiagnosticCode,
  EdfLocation,
  EdfPatientId,
  EdfPhysicalEnvelope,
  EdfRawHeaderFields,
  EdfRawSignalFields,
  EdfRecordIndex,
  EdfRecording,
  EdfRecordingId,
  EdfSampleLocation,
  EdfScale,
  EdfSegment,
  EdfSeverity,
  EdfSignal,
  EdfStartTime,
  EdfStatusWord,
  EdfTimeline,
  EdfTriggerEvent,
  EdfVariant,
  EnvelopeSelection,
  FetchLike,
  FormatHeaderOptions,
  HttpResponseLike,
  HttpSourceOptions,
  OpenOptions,
  ParseOptions,
  ReadOptions,
  RecordRange,
  RecordSelection,
  StreamSelection,
  TriggerSelection,
  WindowSelection,
} from './types.js';

// ===========================================================================
// Errors
//
// `edfErrorKind` is the supported way to discriminate: `instanceof` is false across a realm
// boundary — an iframe, a worker, two copies of the package in one tree — and `isEdfError`
// exists so that check has one spelling.
// ===========================================================================

export type { AnyEdfError, EdfErrorKind, EdfFormatErrorInit } from './errors.js';
export {
  EdfAmbiguousChannelError,
  EdfBudgetError,
  EdfChannelNotFoundError,
  EdfError,
  EdfFormatError,
  EdfRangeError,
  EdfScalingError,
  EdfSourceError,
  isEdfError,
} from './errors.js';

// ===========================================================================
// Constants
// ===========================================================================

export {
  BDF_ANNOTATIONS_LABEL,
  BDF_DIGITAL_MAX,
  BDF_DIGITAL_MIN,
  EDF_ANNOTATIONS_LABEL,
  EDF_DIGITAL_MAX,
  EDF_DIGITAL_MIN,
  EDF_HEADER_BLOCK_BYTES,
  EDF_RECOMMENDED_MAX_RECORD_BYTES,
  TICKS_PER_SECOND,
  VERSION,
} from './constants.js';

// ===========================================================================
// Primitives — pure, synchronous, zero I/O. Every one of these is testable
// from a Uint8Array literal with no mocks.
// ===========================================================================

export { decodeHeaderLatin1 } from './bytes/latin1.js';
export { decodeDigital } from './decode/digital.js';
export { clampToDigitalRange, toPhysical } from './decode/physical.js';
export { formatDiagnostics } from './diagnostics/format.js';
export { formatStartTimeNaive } from './header/dates.js';
export {
  declaredDurationSeconds,
  findSignals,
  getSignal,
  isAnnotationLabel,
  matchSignals,
} from './header/lookup.js';
export { parseHeader } from './header/parse.js';
export { decodeAnnotations } from './tal/annotations.js';
export { resolveTimeWindow, trimToWindow } from './time/window.js';

// ===========================================================================
// I/O adapters — universal, format-independent, and none of them caches.
// `cachedSource` is the only cache in edfcore: opt-in, visible at the call
// site, and removed by deleting one wrapper.
// ===========================================================================

export { blobSource } from './io/blob.js';
export { byteSource } from './io/bytes.js';
export { cachedSource } from './io/cached.js';
export { httpSource } from './io/http.js';

// ===========================================================================
// I/O layer — thin, async, no caching.
// ===========================================================================

export { readHeader, readRecordBytes } from './io/read.js';
export { buildRecordIndex, buildTimeline } from './record-index.js';

// ===========================================================================
// Convenience layer
// ===========================================================================

export {
  countAnnotationsByText,
  filterAnnotationsByText,
  filterAnnotationsByTime,
} from './annotations-query.js';
export { decodeStatusWord, getStatusSignal, readTriggers } from './biosemi.js';
export { envelopeOfSamples, readEnvelope, toPhysicalEnvelope } from './envelope.js';
export { formatHeader } from './format-header.js';
export { inspectEdf } from './inspect.js';
export { openEdf, readAnnotations, readRecords, readWindow } from './recording.js';
export {
  sampleIndexAt,
  sampleStartSeconds,
  sampleStartTicks,
} from './sample-grid.js';
export { streamRecords } from './stream.js';
