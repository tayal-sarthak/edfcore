/**
 * The strict-vs-collect decision.
 *
 * Layer 1. Every diagnostic edfcore emits is built here, which is what makes two invariants
 * structural rather than conventional:
 *
 * - `strict: true` throws `EdfFormatError` carrying the first would-be diagnostic whose severity
 *   is not `info`; `info` notes are exempt and are still collected, which is why a strict parse
 *   of a conforming file can still return a `diagnostics` array;
 * - a code whose disposition is `fatal` throws whether or not `strict` is set, because
 *   proceeding would require inventing data.
 *
 * The caller never passes a severity — it is derived from the code by `severityOf`, so one code
 * cannot acquire two severities in two call sites.
 */

import { EdfFormatError, type EdfFormatErrorInit } from '../errors.js';
import type { EdfDiagnostic, ParseOptions } from '../types.js';
import { type EdfDiagnosticCode, isAlwaysFatal, severityOf } from './codes.js';

/**
 * Everything a diagnostic may carry except its severity. Optional here, required-or-undefined
 * on `EdfDiagnostic`: `createDiagnostic` normalises between the two, which is what lets the
 * result type stay exhaustive under `exactOptionalPropertyTypes`.
 */
export interface DiagnosticInit {
  readonly code: EdfDiagnosticCode;
  /** Must name the field, the raw bytes as written, the rule, and an actionable next step. */
  readonly message: string;
  readonly field?: string;
  readonly byteOffset?: number;
  readonly byteLength?: number;
  readonly rawBytes?: Uint8Array;
  readonly raw?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly signalIndex?: number;
  readonly recordIndex?: number;
  /** A spec clause, e.g. 'EDF+ additional specification 5'. */
  readonly specReference?: string;
}

/**
 * Appends every diagnostic in `source` to `target`, without an argument spread.
 *
 * `target.push(...source)` passes each element as a separate call argument, and V8 throws
 * `RangeError: Maximum call stack size exceeded` past roughly 125,000 of them. Several
 * diagnostics are deliberately reported once per record — `TIMEKEEPING_TAL_MISSING` names the
 * record whose onset it had to derive — so a long recording with a systematically damaged
 * annotation section reaches that count honestly. A 32 MiB file with 130,000 records is enough.
 *
 * The failure was worse than a crash: the thrown value is a bare `RangeError` about the call
 * stack, so it is neither an `EdfError` nor a caller mistake, and it lands in the one function
 * whose whole purpose is to survive being pointed at an untrusted file.
 */
export function appendDiagnostics(target: EdfDiagnostic[], source: readonly EdfDiagnostic[]): void {
  for (const diagnostic of source) target.push(diagnostic);
}

/**
 * Codes `decodeAnnotations` caps at one report per CALL, for a caller that makes many calls.
 *
 * `tal/annotations.ts` bounds diagnostic volume by one test: does another occurrence carry
 * information available nowhere else? `NEGATIVE_ANNOTATION_ONSET` does not — the onsets are in the
 * result — so it is emitted once per call and says so in its own message.
 *
 * A whole-file sweep is not one call. `validateRecording` and `readEnvelope` both fold a recording
 * one SCAN CHUNK at a time and call `decodeAnnotations` per chunk, so the cap reset at every chunk
 * boundary and the count became the number of chunks that happened to contain one. The chunk size
 * is `scanChunkRecords(header, maxMaterializeBytes)` — a pure memory knob — so the same file
 * reported this code 3, 4, 5 or 10 times depending on a budget that must not change an answer
 * (fixed in 0.3.60).
 *
 * `TIMEKEEPING_TAL_NONCONFORMANT` has the same cap for its non-destructive kind and is NOT in this
 * set: the destructive kind shares the code and is deliberately reported per record, because each
 * one names a different annotation that was lost. Collapsing by code alone would drop those, which
 * is a worse defect than the one this fixes. Separating them needs `decodeAnnotations` to publish
 * which kind it emitted, which is more than this belongs in.
 */
const ONCE_PER_ANNOTATION_CALL: ReadonlySet<string> = new Set(['NEGATIVE_ANNOTATION_ONSET']);

/**
 * `appendDiagnostics` for a caller folding one `decodeAnnotations` call per scan chunk.
 *
 * `seen` is the fold's own state and must live across the whole sweep, not across one chunk —
 * that is the entire point.
 */
export function appendChunkDiagnostics(
  target: EdfDiagnostic[],
  source: readonly EdfDiagnostic[],
  seen: Set<string>,
): void {
  for (const diagnostic of source) {
    if (ONCE_PER_ANNOTATION_CALL.has(diagnostic.code)) {
      if (seen.has(diagnostic.code)) continue;
      seen.add(diagnostic.code);
    }
    target.push(diagnostic);
  }
}

export function createDiagnostic(init: DiagnosticInit): EdfDiagnostic {
  return {
    code: init.code,
    severity: severityOf(init.code),
    message: init.message,
    field: init.field,
    byteOffset: init.byteOffset,
    byteLength: init.byteLength,
    // Copied, not aliased: a diagnostic outlives the read that produced it, and the caller's
    // view is typically a subarray of a buffer an I/O adapter is free to reuse.
    rawBytes: init.rawBytes === undefined ? undefined : init.rawBytes.slice(),
    raw: init.raw,
    expected: init.expected,
    actual: init.actual,
    signalIndex: init.signalIndex,
    recordIndex: init.recordIndex,
    specReference: init.specReference,
  };
}

/**
 * The one way to turn a diagnostic into the error that carries it. `EdfFormatError` re-derives
 * `field`/`byteOffset`/`signalIndex`/`recordIndex` from the diagnostic, so they are not repeated.
 */
export function toFormatError(
  diagnostic: EdfDiagnostic,
  cause?: unknown,
  collected?: readonly EdfDiagnostic[],
): EdfFormatError {
  const init: EdfFormatErrorInit = {
    code: diagnostic.code,
    diagnostic,
    ...(cause === undefined ? {} : { cause }),
    // A copy: the sink keeps collecting into its own array, and an error is evidence of the
    // moment it was thrown.
    ...(collected === undefined || collected.length === 0 ? {} : { collected: [...collected] }),
  };
  return new EdfFormatError(`[${diagnostic.code}] ${diagnostic.message}`, init);
}

/**
 * `toFormatError(createDiagnostic(init))`, for the paths that throw without a sink — an always
 * fatal code detected before one exists, or where the type system needs the `throw` to be
 * visible at the call site.
 */
export function fatalError(init: DiagnosticInit, cause?: unknown): EdfFormatError {
  return toFormatError(createDiagnostic(init), cause);
}

/**
 * The one place `strict` is turned into a decision. Every module that finds a departure reports
 * it here rather than choosing between collecting and throwing itself, which is what keeps the
 * rule — and the `info` exemption — from being reimplemented slightly differently per caller.
 */
export class DiagnosticSink {
  /**
   * Readable so a caller can skip building a message it is about to throw away. Never so a
   * caller can re-implement the decision in `report`.
   */
  readonly strict: boolean;

  #collected: EdfDiagnostic[] = [];

  constructor(options?: ParseOptions) {
    this.strict = options?.strict === true;
  }

  get size(): number {
    return this.#collected.length;
  }

  /**
   * Records the diagnostic, or throws `EdfFormatError` when the code is always fatal, or when
   * `strict` is set and the code describes an actual defect. There is no severity parameter
   * by design.
   *
   * `info` codes are exempt from `strict`. They exist to explain something that is correct but
   * surprising — a spec-sanctioned negative gain, a pre-stimulus onset, the mandated two-digit
   * year rule — so throwing on one would contradict what the severity means, and would make
   * `strict` reject conforming files. Every `info` note is still collected and readable.
   */
  /**
   * The fatal a caller raises directly, carrying what this sink has already found.
   *
   * `fatalError` is the sinkless version and stays that way. Where a sink DOES exist, throwing
   * through it is what lets `inspectEdf` report the defects the parse had already accumulated
   * rather than only the one that stopped it (added in 0.3.18).
   */
  fatal(init: DiagnosticInit, cause?: unknown): EdfFormatError {
    return toFormatError(createDiagnostic(init), cause, this.#collected);
  }

  report(init: DiagnosticInit): void {
    const diagnostic = createDiagnostic(init);
    if (isAlwaysFatal(diagnostic.code) || (this.strict && diagnostic.severity !== 'info')) {
      // Everything found before this one travels with it, for the same reason.
      throw toFormatError(diagnostic, undefined, this.#collected);
    }
    this.#collected.push(diagnostic);
  }

  /** A frozen copy: an array already attached to a result must not grow if reporting continues. */
  get diagnostics(): readonly EdfDiagnostic[] {
    return Object.freeze(this.#collected.slice());
  }

  /** `diagnostics`, then reset — for a sink reused across records. */
  drain(): readonly EdfDiagnostic[] {
    const collected = this.diagnostics;
    this.#collected = [];
    return collected;
  }
}
