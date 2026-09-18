/**
 * Numeric options, refused rather than silently coerced.
 *
 * Layer 1. Imports one constant and one Layer 1 helper that imports nothing, so every layer can
 * reach it — which is the
 * point: `maxMaterializeBytes` is resolved in six modules spread across the stack — `io/read.ts`,
 * `decode/digital.ts`, `decode/physical.ts`, `record-index.ts`, `envelope.ts` and `validate.ts` —
 * and read raw and handed on in two more, `io/cached.ts` and `biosemi.ts`. A guard that only one
 * of the eight applies is not a guard.
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
import { describeValue } from './text/describe.js';

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
  /*
   * `describeValue`, not `String(value)`. The module note above is about a `number` that admits
   * `NaN` and `Infinity`, and both read correctly when printed bare. A string does not:
   * `Number.isFinite('1e9')` is false, so `maxMaterializeBytes: '1e9'` was refused — correctly —
   * and then reported as "must be a finite number, but was 1e9", which is a finite number. That is
   * the shape 0.6.92, 0.6.94 and 0.6.99 were spent on, in the one module whose whole subject is
   * options "refused rather than silently coerced"; its own sweep reached six guards and not this
   * one, which sits under eight (fixed in 0.6.114).
   *
   * A string is also the value this guard most often meets. Every source the note names —
   * `process.env`, `searchParams.get`, a JSON config — hands over a string, and the note's own
   * example wraps it in `Number()` precisely because the raw value is one.
   */
  throw new RangeError(
    `options.${name} must be a finite number, but was ${describeValue(value)}. Next: check the ` +
      'expression that produced it — Number() on an absent environment variable, query ' +
      'parameter or config key yields NaN.',
  );
}

/**
 * `maxItems`, resolved against the number of items there actually are.
 *
 * The same class as `requireFiniteOption` and a different answer for `Infinity`, which is why it
 * is a second function rather than a call to that one. `formatValidationReport` caps at 20 by
 * default, so `Infinity` is the only spelling of "print all of them" a caller has; clamped against
 * `total` it is exact, and refusing it would remove the option's only way to say that.
 *
 * `NaN` is refused. It used to mean the same as `Infinity` — both were `!Number.isFinite`, both
 * returned `total` — so a limit computed from an absent config key printed the whole list, which
 * is the opposite of what the caller asked for and looks like a file with a great deal wrong with
 * it. `parseArgs` has refused a `NaN --limit` since the flag existed, and says why in a comment;
 * the library function underneath it did the thing that comment describes.
 */
/**
 * The OPTIONS object, in the three formatters that take a `maxItems`.
 *
 * Every option in this package is a field on one, so the number a caller means IS the option:
 * `formatAnnotations(annotations, 20)` is what gets written when the intent is twenty rows. A bare
 * number has no `maxItems`, so `options?.maxItems` was `undefined`, `requireItemLimit` took that
 * as "no limit given" — its documented default — and every annotation was printed.
 *
 * Silently. `format-annotations.ts` argues the opposite case at length: truncation "always says how
 * much it withheld", because a listing that stopped without saying so "would be indistinguishable
 * from a recording that simply had no more events". A listing that did NOT truncate when it was
 * asked to is the same confusion from the other side, and on a scoring file with fifty thousand
 * events it is fifty thousand lines where twenty were asked for.
 *
 * `null` and `undefined` still mean "no options", which is what they already meant.
 */
export function assertOptions(options: unknown, call: string, listed: string): void {
  if (options === undefined || typeof options === 'object') return;
  throw new RangeError(
    `${call}(): the options are ${describeValue(options)}, not an object — maxItems is a field ` +
      `on one, so this call would have listed every ${listed} rather than that many. ` +
      'Next: pass maxItems on an options object.',
  );
}

/**
 * A boolean option, refused rather than read as false.
 *
 * Every flag in this package is resolved as `options?.flag === true`, which never coerces — the
 * right way to read a boolean, and therefore a silent one: `'true'`, `'1'` and `1` are each
 * not-`true`, so every one of them means OFF. 0.6.182 closed this for `strict` and made the
 * argument: the same failure the bare-value guards exist to stop, reached through them rather than
 * past them.
 *
 * Text is what arrives. These are the options a CLI flag, a query parameter and a JSON or YAML
 * config key set, and all three hand over a string — which is the argument `requireItemLimit` above
 * makes for its own coercion check.
 *
 * `consequence` completes the sentence "so this call ..." with what the OFF reading actually did,
 * because that is the part a caller cannot see.
 */
export function requireBooleanOption(value: unknown, name: string, consequence: string): void {
  if (value === undefined || typeof value === 'boolean') return;
  throw new RangeError(
    `options.${name} must be true or false, and was ${describeValue(value)}. It is compared ` +
      `against a boolean rather than coerced, so anything else silently takes one side of it and ` +
      `${consequence}. Next: pass a boolean — a flag, a query parameter and a config key all ` +
      'arrive as text, so compare with === "true" first.',
  );
}

export function requireItemLimit(value: number | undefined, total: number): number {
  if (value === undefined) return total;
  /*
   * The one numeric option in this module that was silently coerced, which is the thing the module
   * exists not to do. `Math.floor('3')` is 3, so `maxItems: '3'` printed three items and nothing
   * said the option had been read as text — and `Math.floor` is where every other value in this
   * function is decided, so the coercion sat underneath four documented behaviours.
   *
   * Text is exactly what reaches this option. `--limit` is a flag, a viewer's cap comes off a query
   * parameter, and a config file holds strings; the fix for all three is `Number()`, and the `NaN`
   * that a bad one produces is refused below with a message about that conversion (fixed in
   * 0.6.115).
   */
  if (typeof value !== 'number') {
    throw new RangeError(
      `options.maxItems must be a number, and was given ${describeValue(value)}. Next: pass how ` +
        'many items to print, or Infinity for no cap. A flag, a query parameter and a config key ' +
        'all arrive as text — convert with Number() first.',
    );
  }
  if (Number.isNaN(value)) {
    throw new RangeError(
      'options.maxItems must be a number, but was NaN. Next: check the expression that produced ' +
        'it — Number() on an absent environment variable, query parameter or config key yields ' +
        'NaN. Pass Infinity for no cap.',
    );
  }
  return Math.max(0, Math.min(total, Math.floor(value)));
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
