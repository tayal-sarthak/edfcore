/**
 * The strict-vs-collect decision.
 *
 * Layer 1. Every diagnostic edfcore emits is built here, which is what makes two invariants
 * structural rather than conventional:
 *
 * - `strict: true` throws `EdfFormatError` carrying the first would-be diagnostic, so under
 *   strict every `diagnostics` array is empty by construction;
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
export function toFormatError(diagnostic: EdfDiagnostic, cause?: unknown): EdfFormatError {
  const init: EdfFormatErrorInit =
    cause === undefined
      ? { code: diagnostic.code, diagnostic }
      : { code: diagnostic.code, diagnostic, cause };
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
  report(init: DiagnosticInit): void {
    const diagnostic = createDiagnostic(init);
    if (isAlwaysFatal(diagnostic.code) || (this.strict && diagnostic.severity !== 'info')) {
      throw toFormatError(diagnostic);
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
