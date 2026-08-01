/**
 * Digital-to-physical scale, and the decision to refuse one.
 *
 * Layer 2. Sole owner of `EdfScale` construction and of the four conditions under which a
 * signal gets `scale: undefined` instead of a fabricated gain.
 *
 * The expression is EDFlib's, verbatim:
 *
 *     bitValue = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum)
 *     offset   = physicalMaximum / bitValue - digitalMaximum
 *     physical = bitValue * (offset + digital)
 *
 * The textbook `physicalMinimum + (digital - digitalMinimum) * gain` form is numerically
 * *better* and is deliberately not used: it shifts up to ~45% of samples by one ULP on
 * asymmetric ranges, which would forfeit float64 bit-parity with pyEDFlib for a divergence ten
 * orders of magnitude below the quantisation floor. Do not "simplify" this.
 *
 * `physicalMinimum > physicalMaximum` is legal — it is how a negative amplifier gain is
 * written — and produces a negative `bitValue`. The two are never swapped: a silent polarity
 * flip is a clinically wrong result that looks perfectly normal.
 */

import { trimEdfField } from '../bytes/latin1.js';
import type { DiagnosticInit, DiagnosticSink } from '../diagnostics/collector.js';
import type { EdfRawSignalFields, EdfScale } from '../types.js';

/** EDF+ 'edffloat': a channel whose values are log-compressed, so the linear map is wrong. */
const LOG_TRANSFORMED_DIMENSION = 'Filtered';

/** U+00B5 MICRO SIGN, U+03BC GREEK SMALL LETTER MU. A raw 0xB5 header byte decodes to the
 *  former through Latin-1, so both spellings and the byte are covered. */
const MICRO_SIGNS = /[µμ]/g;
const MICRO_REPLACEMENT = 'u';

const RANGE_SPEC_REFERENCE = 'EDF+ additional specification 5';

/** Byte offsets of the per-signal fields a scaling diagnostic points at. */
export interface ScaleFieldOffsets {
  readonly physicalDimension: number;
  readonly physicalMinimum: number;
  readonly physicalMaximum: number;
  readonly digitalMinimum: number;
  readonly digitalMaximum: number;
}

export interface ScaleInput {
  readonly signalIndex: number;
  /** Trimmed label, for the message. */
  readonly label: string;
  /** Physical dimension exactly as written; `'Filtered'` is refused after trimming. */
  readonly physicalDimension: string;
  readonly physicalMinimum: number;
  readonly physicalMaximum: number;
  readonly digitalMinimum: number;
  readonly digitalMaximum: number;
  /** The raw per-signal field text, so a message can quote the bytes as written. */
  readonly raw: EdfRawSignalFields | undefined;
  /** Where those fields live in the header. */
  readonly byteOffsets: ScaleFieldOffsets | undefined;
}

/**
 * Collapse the encodings of micro to `'u'` so units can be compared.
 *
 * For comparison ONLY: `signal.physicalDimension` stays exactly as the file wrote it. Nothing
 * else is touched — case is meaningful (`mV` is not `MV`), and edfcore does not normalise units
 * to SI volts.
 */
export function normaliseUnit(physicalDimension: string): string {
  return trimEdfField(physicalDimension).replace(MICRO_SIGNS, MICRO_REPLACEMENT);
}

function isLogTransformed(physicalDimension: string): boolean {
  return trimEdfField(physicalDimension) === LOG_TRANSFORMED_DIMENSION;
}

/** A diagnostic init with the fields that are only known when the caller supplied context. */
function scaleDiagnostic(
  input: ScaleInput,
  code: DiagnosticInit['code'],
  message: string,
  field: keyof ScaleFieldOffsets,
  expected: string,
  actual: string,
  specReference: string,
): DiagnosticInit {
  const byteOffset = input.byteOffsets?.[field];
  const raw = input.raw?.[field];
  return {
    code,
    message,
    field,
    signalIndex: input.signalIndex,
    expected,
    actual,
    specReference,
    ...(byteOffset === undefined ? {} : { byteOffset }),
    ...(raw === undefined ? {} : { raw }),
  };
}

function describe(input: ScaleInput): string {
  return `signal ${input.signalIndex} ${JSON.stringify(input.label)}`;
}

/** `'"0       " at byte offset 3400'`, or the value alone when the caller gave no context. */
function quoteField(input: ScaleInput, field: keyof ScaleFieldOffsets): string {
  const raw = input.raw?.[field];
  const byteOffset = input.byteOffsets?.[field];
  const rawText = raw === undefined ? '' : `raw ${JSON.stringify(raw)}`;
  const offsetText = byteOffset === undefined ? '' : `at byte offset ${byteOffset}`;
  const parts = [rawText, offsetText].filter((part) => part.length > 0);
  return parts.length === 0 ? '' : ` (${parts.join(' ')})`;
}

/**
 * The scale for one signal, or `undefined` when edfcore refuses to invent one.
 *
 * The refusals are checked in this fixed order: degenerate digital range, degenerate physical
 * range, inverted digital range, log-transformed channel, and finally a derived gain that is not
 * a usable float64 number. Each is deferred-fatal — `decodeDigital` keeps working on the signal
 * and `toPhysical` throws `EdfScalingError`.
 *
 * A non-finite input returns `undefined` without a diagnostic: the only way to get here with
 * one is a numeric field that failed its grammar, which the caller has already reported
 * against the field itself.
 */
export function buildScale(input: ScaleInput, sink: DiagnosticSink): EdfScale | undefined {
  const { physicalMinimum, physicalMaximum, digitalMinimum, digitalMaximum } = input;
  if (
    !Number.isFinite(physicalMinimum) ||
    !Number.isFinite(physicalMaximum) ||
    !Number.isFinite(digitalMinimum) ||
    !Number.isFinite(digitalMaximum)
  ) {
    return undefined;
  }

  if (digitalMaximum === digitalMinimum) {
    sink.report(
      scaleDiagnostic(
        input,
        'DEGENERATE_DIGITAL_RANGE',
        `${describe(input)} declares digitalMinimum == digitalMaximum == ${digitalMinimum}, ` +
          'so physical scale is undefined (division by zero)' +
          `${quoteField(input, 'digitalMinimum')}. ${RANGE_SPEC_REFERENCE}: "Digital maximum ` +
          'must be larger than Digital minimum". Next: decodeDigital() still works on this ' +
          'signal; edfcore will not invent a gain.',
        'digitalMinimum',
        'digitalMaximum > digitalMinimum',
        `${digitalMinimum} == ${digitalMaximum}`,
        RANGE_SPEC_REFERENCE,
      ),
    );
    return undefined;
  }

  if (physicalMaximum === physicalMinimum) {
    sink.report(
      scaleDiagnostic(
        input,
        'DEGENERATE_PHYSICAL_RANGE',
        `${describe(input)} declares physicalMinimum == physicalMaximum == ` +
          `${physicalMinimum}, so every digital value would map to the same physical value` +
          `${quoteField(input, 'physicalMinimum')}. ${RANGE_SPEC_REFERENCE}: "Physical ` +
          'maximum must differ from Physical minimum". Next: decodeDigital() still works on ' +
          'this signal; edfcore will not invent a gain.',
        'physicalMinimum',
        'physicalMaximum != physicalMinimum',
        `${physicalMinimum} == ${physicalMaximum}`,
        RANGE_SPEC_REFERENCE,
      ),
    );
    return undefined;
  }

  if (digitalMinimum > digitalMaximum) {
    sink.report(
      scaleDiagnostic(
        input,
        'INVERTED_DIGITAL_RANGE',
        `${describe(input)} declares digitalMinimum ${digitalMinimum} greater than ` +
          `digitalMaximum ${digitalMaximum}${quoteField(input, 'digitalMinimum')}. ` +
          `${RANGE_SPEC_REFERENCE}: "Digital maximum must be larger than Digital minimum". ` +
          'Unlike an inverted physical range this has no sanctioned meaning, so edfcore will ' +
          'not guess whether the fields were swapped or the samples inverted. Next: ' +
          'decodeDigital() still works on this signal.',
        'digitalMinimum',
        'digitalMaximum > digitalMinimum',
        `${digitalMinimum} > ${digitalMaximum}`,
        RANGE_SPEC_REFERENCE,
      ),
    );
    return undefined;
  }

  if (isLogTransformed(input.physicalDimension)) {
    sink.report(
      scaleDiagnostic(
        input,
        'LOG_TRANSFORMED_CHANNEL',
        `${describe(input)} has physical dimension exactly "${LOG_TRANSFORMED_DIMENSION}"` +
          `${quoteField(input, 'physicalDimension')}, which marks a logarithmically ` +
          'transformed channel (EDF specification edffloat.html): its samples are ' +
          'log-compressed, so the linear digital-to-physical map would be wrong by orders of ' +
          'magnitude. Next: decodeDigital() still works on this signal; edfcore detects the ' +
          'transform and refuses it rather than applying an inverse it cannot verify.',
        'physicalDimension',
        'a linear physical dimension',
        LOG_TRANSFORMED_DIMENSION,
        'EDF specification edffloat.html',
      ),
    );
    return undefined;
  }

  if (physicalMinimum > physicalMaximum) {
    sink.report(
      scaleDiagnostic(
        input,
        'INVERTED_PHYSICAL_RANGE',
        `${describe(input)} declares physicalMinimum ${physicalMinimum} greater than ` +
          `physicalMaximum ${physicalMaximum}${quoteField(input, 'physicalMinimum')}. This ` +
          'is legal and encodes a negative amplifier gain (EDF FAQ Q6), so bitValue comes ' +
          'out negative. Next: nothing to do — edfcore never swaps the two, because a silent ' +
          'polarity flip is a clinically wrong result that looks normal.',
        'physicalMinimum',
        'physicalMinimum < physicalMaximum, or a deliberate negative gain',
        `${physicalMinimum} > ${physicalMaximum}`,
        'EDF FAQ Q6 (negative amplifier gain)',
      ),
    );
  }

  // EDFlib's exact expression. See the module comment before changing either line.
  const bitValue = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum);
  const offset = physicalMaximum / bitValue - digitalMaximum;

  // The four INPUTS being finite does not make the DERIVED pair finite. An 8-byte field may write
  // an exponent, so a physical range can underflow against the digital range (`0`..`5E-324` over
  // -1..1 gives bitValue 0 and offset Infinity) or overflow it (`-9.9E307`..`9.9E307` gives
  // bitValue Infinity). Either way `bitValue * (offset + digital)` is NaN or +/-Infinity for every
  // sample in the channel, which is a fabricated gain by another name — so the scale is refused
  // exactly as the degenerate cases above are, and `decodeDigital` keeps working.
  if (bitValue === 0 || !Number.isFinite(bitValue) || !Number.isFinite(offset)) {
    sink.report(
      scaleDiagnostic(
        input,
        'DEGENERATE_PHYSICAL_RANGE',
        `${describe(input)} declares the physical range ${physicalMinimum}..${physicalMaximum} ` +
          `over the digital range ${digitalMinimum}..${digitalMaximum}` +
          `${quoteField(input, 'physicalMaximum')}, and the gain those imply is not a usable ` +
          `float64 number: bitValue is ${bitValue} and offset is ${offset}, so ` +
          'bitValue * (offset + digital) is NaN or infinite for every sample. ' +
          `${RANGE_SPEC_REFERENCE}. Next: decodeDigital() still works on this signal; edfcore ` +
          'will not invent a gain, and a physical range this far outside float64 is a corrupt ' +
          'field rather than a calibration.',
        'physicalMaximum',
        'a physical range that defines a finite, non-zero gain',
        `bitValue ${bitValue}, offset ${offset}`,
        RANGE_SPEC_REFERENCE,
      ),
    );
    return undefined;
  }

  return { bitValue, offset };
}
