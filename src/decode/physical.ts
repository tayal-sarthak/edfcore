/**
 * Digital counts to physical units.
 *
 * Layer 3. Sole owner of the scaling expression. The expression is PINNED — see `toPhysical`
 * before changing anything in this file.
 *
 * Also home to `clampToDigitalRange`, which is a cross-validation tool and never part of a
 * read: EDFlib clamps silently when it loads samples, edfcore does not, and reproducing that
 * behaviour has to be something a caller asks for explicitly.
 */

import { EdfBudgetError, EdfScalingError } from '../errors.js';
import { resolveMaterializeBudget } from '../options.js';
import type { EdfDiagnosticCode, EdfSignal } from '../types.js';
import type { MaterializeOptions } from './digital.js';

export type { MaterializeOptions } from './digital.js';

const BYTES_PER_FLOAT64 = 8;
const BYTES_PER_INT32 = 4;

/** The physical dimension that marks a log-compressed channel (EDFlib `edffloat.html`). */
const LOG_TRANSFORMED_DIMENSION = 'Filtered';

interface ScalingFailure {
  readonly code: EdfDiagnosticCode;
  /** Completes the sentence `signal 7 "EMG Chin" ...`. */
  readonly reason: string;
  readonly specReference: string | undefined;
  /**
   * What to do instead. Defaults to "decodeDigital still works on this signal", which is true for
   * every DATA signal whose header ranges are unusable — and false for the annotations channel,
   * where decoding TAL text as samples is the exact mistake this package exists to prevent.
   */
  readonly nextStep?: string;
}

function assertWithinBudget(
  requiredBytes: number,
  what: string,
  options: MaterializeOptions | undefined,
): void {
  const budgetBytes = resolveMaterializeBudget(options?.maxMaterializeBytes);
  if (requiredBytes <= budgetBytes) return;
  throw new EdfBudgetError(
    `Producing ${what} needs a ${requiredBytes}-byte array, above the ${budgetBytes}-byte ` +
      'maxMaterializeBytes budget, so the allocation was refused before it was attempted. ' +
      'Next: convert fewer samples per call, reuse an `out` array, or raise ' +
      'options.maxMaterializeBytes.',
    { requiredBytes, budgetBytes },
  );
}

/**
 * Why `signal.scale` is `undefined`, re-derived from the signal itself.
 *
 * The header records the matching diagnostic at parse time, but a bare `EdfSignal` does not
 * carry it, and `toPhysical` takes a signal. These four tests are the same ones `header/scale.ts`
 * applies, IN THE SAME ORDER — a signal can fail two of them at once, and the order is what
 * decides which cause is named, so the code reported here is the code the header reported.
 * `buildScale` owns that order; this function follows it. A signal that fails none
 * of them yet still has no scale gets `SCALE_UNAVAILABLE` rather than the nearest-looking code:
 * naming the wrong cause is worse than admitting the cause is not on hand.
 */
function describeScalingFailure(signal: EdfSignal): ScalingFailure {
  const digitalSpec =
    'EDF+ additional specification 5: "Digital maximum must be larger than Digital minimum"';
  // FIRST, and ahead of the four re-derived tests. `parseSignalHeaders` deliberately does not run
  // `buildScale` over an annotations channel — its physical and digital fields describe nothing a
  // caller may use, and checking them "would report a defect about a number nobody may use". So
  // such a signal has no scale AND no diagnostic, and re-running the four tests over those unused
  // fields named a cause the header never evaluated: an annotations channel declaring 0/0 was
  // refused with DEGENERATE_PHYSICAL_RANGE asserting a header defect, and the conventional -1/1
  // one with SCALE_UNAVAILABLE saying "the header recorded the reason" — sending the reader to a
  // `header.diagnostics` entry that does not exist, in both cases. Neither ever said the real
  // reason (fixed in 0.3.22).
  if (signal.kind === 'annotations') {
    return {
      code: 'SCALE_UNAVAILABLE',
      reason:
        "is this file's annotations channel: its bytes are EDF+ TAL text rather than " +
        'measurements, so no scale was ever built for it and its physical fields describe ' +
        'nothing',
      specReference: 'EDF+ specification 2.2.4 (the EDF Annotations signal)',
      // NOT "decodeDigital() still works on this signal". It does, and it produces numbers that
      // look exactly like a signal — the one failure this package exists to prevent.
      nextStep:
        'Next: read this channel with readAnnotations(recording, records), and pass only ' +
        'header.dataSignalIndices to a sample read.',
    };
  }
  if (signal.digitalMinimum === signal.digitalMaximum) {
    return {
      code: 'DEGENERATE_DIGITAL_RANGE',
      reason:
        `declares digitalMinimum == digitalMaximum == ${signal.digitalMinimum}, which makes ` +
        'the gain a division by zero',
      specReference: digitalSpec,
    };
  }
  if (signal.physicalMinimum === signal.physicalMaximum) {
    return {
      code: 'DEGENERATE_PHYSICAL_RANGE',
      reason:
        `declares physicalMinimum == physicalMaximum == ${signal.physicalMinimum}, so every ` +
        'sample would map to that one value',
      specReference: undefined,
    };
  }
  if (signal.digitalMinimum > signal.digitalMaximum) {
    return {
      code: 'INVERTED_DIGITAL_RANGE',
      reason:
        `declares digitalMinimum ${signal.digitalMinimum} above digitalMaximum ` +
        `${signal.digitalMaximum}, and edfcore will not guess which one the writer meant`,
      specReference: digitalSpec,
    };
  }
  if (signal.physicalDimension.trim() === LOG_TRANSFORMED_DIMENSION) {
    return {
      code: 'LOG_TRANSFORMED_CHANNEL',
      reason:
        `has physical dimension "${LOG_TRANSFORMED_DIMENSION}", so its values are ` +
        'log-compressed and the linear formula would be wrong by orders of magnitude',
      specReference: 'EDFlib edffloat.html',
    };
  }
  return {
    code: 'SCALE_UNAVAILABLE',
    reason: 'has no usable scale, and the header recorded the reason rather than the signal',
    specReference: undefined,
  };
}

function scalingError(signal: EdfSignal): EdfScalingError {
  const failure = describeScalingFailure(signal);
  const message =
    `[${failure.code}] signal ${signal.index} "${signal.label}" ${failure.reason}, so ` +
    'physical units are undefined for it. Raw fields: digital minimum ' +
    `"${signal.raw.digitalMinimum}", digital maximum "${signal.raw.digitalMaximum}", ` +
    `physical minimum "${signal.raw.physicalMinimum}", physical maximum ` +
    `"${signal.raw.physicalMaximum}", physical dimension "${signal.raw.physicalDimension}". ` +
    (failure.specReference === undefined ? '' : `${failure.specReference}. `) +
    (failure.nextStep ??
      'Next: decodeDigital() still works on this signal; edfcore will not invent a gain.');
  return new EdfScalingError(message, {
    code: failure.code,
    signalIndex: signal.index,
    label: signal.label,
  });
}

/**
 * Float64 by contract, never Float32.
 *
 * Float32 carries 24 significand bits, so a 24-bit BDF sample scaled into it loses about a
 * quarter of a quantisation step — a rounding error a quarter the size of the smallest real
 * difference the hardware can express.
 */
function resolveFloat64Out(
  out: Float64Array | undefined,
  length: number,
  options: MaterializeOptions | undefined,
): Float64Array {
  if (out === undefined) {
    assertWithinBudget(length * BYTES_PER_FLOAT64, `${length} physical samples`, options);
    return new Float64Array(length);
  }
  if (out.length < length) {
    throw new RangeError(
      `out holds ${out.length} samples but this conversion produces ${length}. Next: size the ` +
        'reused array to digital.length, or omit it and let toPhysical allocate.',
    );
  }
  // A longer `out` is narrowed to a view over its own memory, so reuse still allocates no
  // samples while `result.length` stays equal to the real sample count.
  return out.length === length ? out : out.subarray(0, length);
}

function resolveInt32Out(
  out: Int32Array | undefined,
  length: number,
  options: MaterializeOptions | undefined,
): Int32Array {
  if (out === undefined) {
    assertWithinBudget(length * BYTES_PER_INT32, `${length} clamped samples`, options);
    return new Int32Array(length);
  }
  if (out.length < length) {
    throw new RangeError(
      `out holds ${out.length} samples but this clamp produces ${length}. Next: size the ` +
        'reused array to digital.length, or omit it and let clampToDigitalRange allocate.',
    );
  }
  return out.length === length ? out : out.subarray(0, length);
}

/**
 * `physical = bitValue * (offset + digital)`, in float64 throughout.
 *
 * THIS EXPRESSION IS PINNED AND MUST NOT BE "SIMPLIFIED". It is numerically worse than
 * `physicalMinimum + (digital - digitalMinimum) * gain`, and that is not an accident: it is
 * EDFlib's exact form, kept verbatim so edfcore reproduces pyEDFlib/EDFlib float64 output
 * bit for bit. The two forms disagree by up to ~9.3e-10 LSB — ten orders of magnitude below
 * the quantisation floor, and on asymmetric ranges they differ on nearly half the samples by
 * one ULP. Rewriting this line breaks the golden-value tests, and rightly so.
 *
 * Throws `EdfScalingError` when `signal.scale` is `undefined`. edfcore never fabricates a gain,
 * and `decodeDigital` keeps working on such a signal.
 */
export function toPhysical(
  signal: EdfSignal,
  digital: ArrayLike<number>,
  out?: Float64Array,
  options?: MaterializeOptions,
): Float64Array {
  const scale = signal.scale;
  if (scale === undefined) throw scalingError(signal);

  const length = digital.length;
  const physical = resolveFloat64Out(out, length, options);
  const bitValue = scale.bitValue;
  const offset = scale.offset;
  for (let i = 0; i < length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i < digital.length, per the ArrayLike contract.
    physical[i] = bitValue * (offset + digital[i]!);
  }
  return physical;
}

/**
 * The signal's declared physical bounds, in ascending order.
 *
 * `signal.physicalMinimum` is not the smaller of the two. A negative amplifier gain is declared
 * by putting the larger value in the minimum field, it is legal, and edfcore never "fixes" it —
 * so `{ low: signal.physicalMinimum, high: signal.physicalMaximum }` written by hand gives a
 * viewer an inverted y-axis on exactly the channels where the trace is also inverted, and the
 * two mistakes hide each other.
 *
 * This is the DECLARED envelope, not the observed one: samples outside it exist (that is what
 * `outOfDigitalRangeCount` counts) and this function does not look at any. It is what a fixed
 * axis or a gain control should be built from.
 *
 * Throws `RangeError` when either bound is not finite, for the reason `clampToDigitalRange`
 * does: `Math.min(NaN, x)` is `NaN`, and an axis from `NaN` to `NaN` draws nothing while
 * reporting no error at all.
 */
export function physicalRangeOf(signal: EdfSignal): {
  readonly low: number;
  readonly high: number;
} {
  const { physicalMinimum, physicalMaximum } = signal;
  if (!Number.isFinite(physicalMinimum) || !Number.isFinite(physicalMaximum)) {
    throw new RangeError(
      `signal ${signal.index} "${signal.label}" declares physical minimum ` +
        `"${signal.raw.physicalMinimum}" and physical maximum "${signal.raw.physicalMaximum}", ` +
        'which do not both parse as numbers, so it has no physical range. Next: read ' +
        'header.diagnostics for this signal.',
    );
  }
  return physicalMinimum <= physicalMaximum
    ? { low: physicalMinimum, high: physicalMaximum }
    : { low: physicalMaximum, high: physicalMinimum };
}

/**
 * Clamp to the declared digital range. POST-HOC ONLY — nothing on the read path calls this.
 *
 * It exists to reproduce a clamping consumer (EDFlib clamps silently on read; edfcore does not)
 * when cross-validating against one. Clamping to `[min(digMin, digMax), max(digMin, digMax)]`
 * rather than to `[digMin, digMax]` matters for an inverted declaration, where the naive bounds
 * are empty and collapse every sample onto a single value.
 */
export function clampToDigitalRange(
  signal: EdfSignal,
  digital: Int32Array,
  out?: Int32Array,
  options?: MaterializeOptions,
): Int32Array {
  const low = Math.min(signal.digitalMinimum, signal.digitalMaximum);
  const high = Math.max(signal.digitalMinimum, signal.digitalMaximum);
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    // Every comparison against a NaN bound is false, so proceeding would return the input
    // unchanged while claiming to have clamped it.
    throw new RangeError(
      `signal ${signal.index} "${signal.label}" declares digital minimum ` +
        `"${signal.raw.digitalMinimum}" and digital maximum "${signal.raw.digitalMaximum}", ` +
        'which do not both parse as numbers, so there is no range to clamp to. Next: read ' +
        'header.diagnostics for this signal.',
    );
  }

  const length = digital.length;
  const clamped = resolveInt32Out(out, length, options);
  for (let i = 0; i < length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i < digital.length.
    const value = digital[i]!;
    clamped[i] = value < low ? low : value > high ? high : value;
  }
  return clamped;
}
