/**
 * Numeric options, refused rather than silently coerced.
 *
 * Layer 1. Imports one constant and nothing else, so every layer can reach it — which is the
 * point: `maxMaterializeBytes` is read in six modules spread across the stack — `io/read.ts`,
 * `decode/digital.ts`, `decode/physical.ts`, `record-index.ts`, `envelope.ts` and `validate.ts` —
 * and a guard that only one of them applies is not a guard.
 *
 * These options are typed `number`, which admits `NaN` and `Infinity`, and both arrive easily:
 * `Number(process.env.EDF_BUDGET)`, `Number(searchParams.get('block'))` and any absent key in a
 * JSON config all produce `NaN`. Left alone they do not fail loudly. `Math.max(1, NaN)` is `NaN`
 * and every comparison against `NaN` is false, so a guard written as `if (value < 1)` simply does
 * not fire — and the failure then surfaces somewhere else entirely, blaming something else.
 *
 * A plain `RangeError`, not an `EdfError`: this is a bug in the calling code rather than a problem
 * with the file, which is the same split `isEdfError` documents.
 */

import { DEFAULT_MAX_MATERIALIZE_BYTES } from './constants.js';

/**
 * `undefined` takes the default; anything non-finite throws. The two are kept apart deliberately:
 * an omitted option means "use the default", while a `NaN` means a caller computed something and
 * got nothing — treating them alike would silently apply the default to a real mistake.
 */
export function requireFiniteOption(
  value: number | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (Number.isFinite(value)) return value;
  throw new RangeError(
    `options.${name} must be a finite number, but was ${String(value)}. Next: check the ` +
      'expression that produced it — Number() on an absent environment variable, query ' +
      'parameter or config key yields NaN.',
  );
}

/**
 * `maxMaterializeBytes`, or the 256 MiB default.
 *
 * The two ways a `NaN` budget used to surface, neither of which named the budget:
 *
 * - `readWindow` and `readAnnotations` compared `requiredBytes <= NaN`, which is false, so every
 *   read was refused with an `EdfBudgetError` reporting a "NaN-byte maxMaterializeBytes budget"
 *   and advising the caller to "read fewer records per call" — advice no record count can satisfy.
 * - `validateRecording` and `buildRecordIndex` sized their scan chunks from it, so `chunkRecords`
 *   became `NaN` and the failure arrived as an `EdfRangeError` about
 *   `records { start: 0, count: NaN }`, telling the caller to "clamp the range against
 *   header.recordCount" — a range neither function takes as a parameter.
 *
 * One bad option, two different wrong diagnoses. Resolving it in one place means the message names
 * the argument that is actually wrong (fixed in 0.3.21). `requireFiniteOption` was written for
 * exactly this class in 0.1.3, for the cache and HTTP options, and was never applied here.
 */
export function resolveMaterializeBudget(value: number | undefined): number {
  const budget = requireFiniteOption(value, 'maxMaterializeBytes', DEFAULT_MAX_MATERIALIZE_BYTES);
  if (budget >= 0) return budget;
  throw new RangeError(
    `options.maxMaterializeBytes must not be negative, but was ${budget}. Next: pass the number ` +
      'of bytes a single call may allocate, or omit it for the ' +
      `${DEFAULT_MAX_MATERIALIZE_BYTES}-byte default.`,
  );
}
