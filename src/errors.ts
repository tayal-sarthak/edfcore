/**
 * The error hierarchy.
 *
 * Layer 1. One rule decides which of these you get: if edfcore cannot proceed without
 * inventing something, it throws; if it can proceed truthfully, it records an `EdfDiagnostic`.
 * There is no third category, and there is no `console` call anywhere in this package.
 *
 * `edfErrorKind` exists so consumers can discriminate without `instanceof`, which fails across
 * realms — an iframe, a worker, or two copies of the package in one dependency tree.
 */

import type { EdfDiagnostic, EdfDiagnosticCode, RecordRange } from './types.js';

/**
 * The supported way to tell edfcore's errors apart. Branch on `error.edfErrorKind`, not on
 * `instanceof`: a class identity is false across a realm boundary — an iframe, a worker, two
 * copies of the package in one tree — where these six strings are not.
 */
export type EdfErrorKind = 'format' | 'scaling' | 'range' | 'source' | 'budget' | 'channel';

const EMPTY_DIAGNOSTICS: readonly EdfDiagnostic[] = Object.freeze([]);

/**
 * The base every error edfcore throws extends — abstract, so it is a category rather than
 * something to construct. A plain `RangeError` from this package is therefore deliberate and
 * means the opposite: the file is fine and the call was wrong. `isEdfError` is the check.
 */
export abstract class EdfError extends Error {
  abstract readonly edfErrorKind: EdfErrorKind;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined);
    // `new.target.name` is the FALLBACK, for a consumer who subclasses `EdfError` themselves.
    // Every class in this file overwrites it with a literal in its own constructor, because
    // `new.target.name` reads `Function.prototype.name` — which a minifier rewrites. Bundled
    // with esbuild --minify, `new EdfFormatError(...).name` came out as `"t"`, in exactly the
    // browser build where `error.name` is what a consumer branches on (fixed in 0.3.12).
    this.name = new.target.name;
  }
}

/**
 * Every concrete error edfcore throws.
 *
 * This exists so `edfErrorKind` actually discriminates in TypeScript. `EdfError` alone
 * declares only the kind, so narrowing against the abstract class leaves the extra fields
 * (`code`, `budgetBytes`, `matchingIndices`, …) unreachable and forces a cast at every call
 * site. Switching on `edfErrorKind` over this union reaches them without one.
 */
export type AnyEdfError =
  | EdfFormatError
  | EdfScalingError
  | EdfRangeError
  | EdfSourceError
  | EdfBudgetError
  | EdfAmbiguousChannelError
  | EdfChannelNotFoundError;

/**
 * Returns true for any error thrown by edfcore, across realms.
 *
 * Checks the `edfErrorKind` brand rather than `instanceof`, which fails whenever the error
 * crossed a realm boundary — an iframe, a worker, or two copies of the package in one
 * dependency tree.
 *
 * Note that a handful of caller-error paths deliberately throw a plain `RangeError` instead
 * (asking for records that cannot exist, or handing an annotation channel to a sample read).
 * Those are bugs in the calling code rather than problems with the file, and this returns
 * false for them.
 */
export function isEdfError(value: unknown): value is AnyEdfError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { edfErrorKind?: unknown }).edfErrorKind === 'string'
  );
}

export interface EdfFormatErrorInit {
  readonly code: EdfDiagnosticCode;
  readonly diagnostic?: EdfDiagnostic;
  /** Everything already found when this became fatal. See `EdfFormatError.collected`. */
  readonly collected?: readonly EdfDiagnostic[];
  readonly field?: string;
  readonly byteOffset?: number;
  readonly signalIndex?: number;
  readonly recordIndex?: number;
  readonly cause?: unknown;
}

/**
 * The file is wrong. Also what `strict: true` throws, carrying the diagnostic that would
 * otherwise have been collected.
 */
export class EdfFormatError extends EdfError {
  readonly edfErrorKind = 'format' as const;
  readonly code: EdfDiagnosticCode;
  readonly diagnostic: EdfDiagnostic | undefined;
  /**
   * The diagnostics already collected when this one turned out to be fatal, in the order they
   * were found. Empty when the fatal was raised before any collection existed.
   *
   * A header parse accumulates as it goes and reaches its fatal checks last, so by the time one
   * throws it may have found several defects that have nothing to do with the fatal — and the
   * fatal is often the least informative of the set. `inspectEdf` reports these alongside it;
   * before 0.3.18 they were discarded with the sink and only the fatal survived.
   */
  readonly collected: readonly EdfDiagnostic[];
  readonly field: string | undefined;
  readonly byteOffset: number | undefined;
  readonly signalIndex: number | undefined;
  readonly recordIndex: number | undefined;

  constructor(message: string, init: EdfFormatErrorInit) {
    super(message, { cause: init.cause });
    this.name = 'EdfFormatError';
    this.code = init.code;
    this.diagnostic = init.diagnostic;
    this.collected = init.collected ?? EMPTY_DIAGNOSTICS;
    this.field = init.field ?? init.diagnostic?.field;
    this.byteOffset = init.byteOffset ?? init.diagnostic?.byteOffset;
    this.signalIndex = init.signalIndex ?? init.diagnostic?.signalIndex;
    this.recordIndex = init.recordIndex ?? init.diagnostic?.recordIndex;
  }
}

/**
 * Physical units are unavailable for one signal, because the header's ranges do not define a
 * scale. `decodeDigital` still works on that signal — edfcore will not invent a gain.
 */
export class EdfScalingError extends EdfError {
  readonly edfErrorKind = 'scaling' as const;
  readonly code: EdfDiagnosticCode;
  readonly signalIndex: number;
  readonly label: string;

  constructor(
    message: string,
    init: { code: EdfDiagnosticCode; signalIndex: number; label: string; cause?: unknown },
  ) {
    super(message, { cause: init.cause });
    this.name = 'EdfScalingError';
    this.code = init.code;
    this.signalIndex = init.signalIndex;
    this.label = init.label;
  }
}

/** Your bug, not the file's: you asked for records that do not exist. */
export class EdfRangeError extends EdfError {
  readonly edfErrorKind = 'range' as const;
  readonly requested: RecordRange;
  readonly available: RecordRange;

  constructor(
    message: string,
    init: { requested: RecordRange; available: RecordRange; cause?: unknown },
  ) {
    super(message, { cause: init.cause });
    this.name = 'EdfRangeError';
    this.requested = init.requested;
    this.available = init.available;
  }
}

/** A `ByteSource` broke its contract: it returned a different number of bytes than asked. */
export class EdfSourceError extends EdfError {
  readonly edfErrorKind = 'source' as const;
  readonly offset: number;
  readonly requestedLength: number;
  readonly receivedLength: number | undefined;

  constructor(
    message: string,
    init: {
      offset: number;
      requestedLength: number;
      receivedLength?: number | undefined;
      cause?: unknown;
    },
  ) {
    super(message, { cause: init.cause });
    this.name = 'EdfSourceError';
    this.offset = init.offset;
    this.requestedLength = init.requestedLength;
    this.receivedLength = init.receivedLength;
  }
}

/**
 * An allocation was refused before it happened. Float64 physical output is four times the
 * on-disk size for EDF, so without this one honest call can take down a browser tab.
 */
export class EdfBudgetError extends EdfError {
  readonly edfErrorKind = 'budget' as const;
  readonly requiredBytes: number;
  readonly budgetBytes: number;
  readonly optionName = 'maxMaterializeBytes' as const;

  constructor(
    message: string,
    init: { requiredBytes: number; budgetBytes: number; cause?: unknown },
  ) {
    super(message, { cause: init.cause });
    this.name = 'EdfBudgetError';
    this.requiredBytes = init.requiredBytes;
    this.budgetBytes = init.budgetBytes;
  }
}

/**
 * Two or more signals share the requested label. Real files do this: CHB-MIT ships `T8-P8`
 * twice. Silently returning the first is how the wrong channel ends up in a paper.
 */
export class EdfAmbiguousChannelError extends EdfError {
  readonly edfErrorKind = 'channel' as const;
  readonly label: string;
  readonly matchingIndices: readonly number[];

  constructor(
    message: string,
    init: { label: string; matchingIndices: readonly number[]; cause?: unknown },
  ) {
    super(message, { cause: init.cause });
    this.name = 'EdfAmbiguousChannelError';
    this.label = init.label;
    this.matchingIndices = init.matchingIndices;
  }
}

export class EdfChannelNotFoundError extends EdfError {
  readonly edfErrorKind = 'channel' as const;
  readonly selector: string | number;
  readonly availableLabels: readonly string[];

  constructor(
    message: string,
    init: { selector: string | number; availableLabels: readonly string[]; cause?: unknown },
  ) {
    super(message, { cause: init.cause });
    this.name = 'EdfChannelNotFoundError';
    this.selector = init.selector;
    this.availableLabels = init.availableLabels;
  }
}
