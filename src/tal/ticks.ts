/**
 * Decimal text to exact 100 ns ticks.
 *
 * Layer 3. Sole owner of the string -> tick conversion, which is the whole reason event times
 * in edfcore compare exactly. `parseFloat`, `Number(text)` and float arithmetic appear nowhere
 * on that path: an onset written `+0.1` and one written `+0.3` are integers here, so equality,
 * ordering and subtraction are decided by the digits on disk rather than by float64 rounding.
 */

import { TICKS_PER_SECOND } from '../constants.js';

/**
 * One parsed onset or duration field.
 *
 * `ticks` is the authoritative value; `seconds` and any float derived from it are conveniences.
 */
export interface TickParse {
  /**
   * The text matched the EDF+ grammar for its field. When false, `ticks` is 0n except in the
   * one documented case in `parseSignedTicks` (a valid magnitude with the sign missing).
   */
  readonly ok: boolean;
  readonly ticks: bigint;
  /** The input verbatim, so a caller never has to reconstruct the digits it came from. */
  readonly raw: string;
  /** Lossy by construction. See `ticksToSeconds`. */
  readonly seconds: number;
}

const ASCII_ZERO = 0x30;
const ASCII_NINE = 0x39;
const ASCII_PLUS = 0x2b;
const ASCII_MINUS = 0x2d;
const ASCII_DOT = 0x2e;

/** `TICKS_PER_SECOND` is 10^7, so exactly seven fractional decimal digits are representable. */
const TICK_FRACTION_DIGITS = 7;

/** Exact: 10^7 is far below 2^53, so this conversion loses nothing. */
const TICKS_PER_SECOND_FLOAT = Number(TICKS_PER_SECOND);

interface MagnitudeParse {
  readonly ok: boolean;
  /** Non-negative. The sign is applied by the caller, to the whole value. */
  readonly ticks: bigint;
}

const MAGNITUDE_FAILED: MagnitudeParse = { ok: false, ticks: 0n };

function isAsciiDigit(code: number): boolean {
  return code >= ASCII_ZERO && code <= ASCII_NINE;
}

/**
 * `1*DIGIT [ "." 1*DIGIT ]` starting at `start`, accumulated digit by digit into a bigint.
 *
 * Fractional digits beyond the seventh are below tick resolution and are TRUNCATED, never
 * rounded: rounding would move an event to a time that is in no file, and for a stimulus marker
 * that is the difference between a pre- and a post-stimulus sample. The extra digits are still
 * required to be digits, so `+1.00000000x` is rejected rather than silently truncated.
 */
function parseMagnitudeTicks(text: string, start: number): MagnitudeParse {
  const end = text.length;
  let i = start;
  let whole = 0n;

  while (i < end) {
    const code = text.charCodeAt(i);
    if (!isAsciiDigit(code)) break;
    whole = whole * 10n + BigInt(code - ASCII_ZERO);
    i += 1;
  }
  if (i === start) return MAGNITUDE_FAILED;

  let ticks = whole * TICKS_PER_SECOND;
  if (i === end) return { ok: true, ticks };

  // Anything other than a decimal point here is a space, a second sign, a stray structural
  // byte or trailing padding, and none of those are part of the grammar.
  if (text.charCodeAt(i) !== ASCII_DOT) return MAGNITUDE_FAILED;
  i += 1;

  let fractionDigits = 0;
  let scale = TICKS_PER_SECOND;
  while (i < end) {
    const code = text.charCodeAt(i);
    if (!isAsciiDigit(code)) return MAGNITUDE_FAILED;
    fractionDigits += 1;
    if (fractionDigits <= TICK_FRACTION_DIGITS) {
      scale = scale / 10n;
      ticks += BigInt(code - ASCII_ZERO) * scale;
    }
    i += 1;
  }
  if (fractionDigits === 0) return MAGNITUDE_FAILED;

  return { ok: true, ticks };
}

/**
 * An EDF+ onset: `("+" / "-") 1*DIGIT [ "." 1*DIGIT ]`.
 *
 * The sign is mandatory, so an unsigned onset is a spec violation and `ok` is false — the caller
 * emits `TAL_MALFORMED`. The magnitude is parsed anyway and returned in `ticks`, so a lenient
 * caller can still use the value instead of discarding an otherwise readable annotation. That is
 * the only case where `ok: false` comes with a meaningful `ticks`.
 *
 * `-` applies to the WHOLE value, fraction included: `-0.5` is -5000000 ticks, not -0 plus
 * 5000000. Splitting the sign off the fraction flips pre-stimulus event times about zero.
 */
export function parseSignedTicks(text: string): TickParse {
  const first = text.length > 0 ? text.charCodeAt(0) : -1;
  const negative = first === ASCII_MINUS;
  const signed = negative || first === ASCII_PLUS;
  const magnitude = parseMagnitudeTicks(text, signed ? 1 : 0);
  const ticks = negative ? -magnitude.ticks : magnitude.ticks;
  return { ok: magnitude.ok && signed, ticks, raw: text, seconds: ticksToSeconds(ticks) };
}

/**
 * An EDF+ duration: `1*DIGIT [ "." 1*DIGIT ]`, never signed.
 *
 * A leading `+` or `-` fails the grammar; it is not tolerated and not stripped, because a signed
 * duration means the writer's field layout is not the one we are reading.
 */
export function parseUnsignedTicks(text: string): TickParse {
  const magnitude = parseMagnitudeTicks(text, 0);
  return {
    ok: magnitude.ok,
    ticks: magnitude.ticks,
    raw: text,
    seconds: ticksToSeconds(magnitude.ticks),
  };
}

/**
 * Ticks as float64 seconds, for ergonomics and display.
 *
 * Lossy by construction — most tick values are not representable in binary floating point, and
 * beyond 2^53 ticks (~28.5 years) even the integer part rounds. The exact value always stays
 * available as ticks, and that is what comparisons must use.
 *
 * Split into whole seconds plus remainder so that only the remainder is ever divided; bigint
 * `/` truncates toward zero and `%` keeps the dividend's sign, so both parts share a sign and
 * the sum is correct for negative onsets.
 */
export function ticksToSeconds(ticks: bigint): number {
  const wholeSeconds = ticks / TICKS_PER_SECOND;
  const remainder = ticks % TICKS_PER_SECOND;
  return Number(wholeSeconds) + Number(remainder) / TICKS_PER_SECOND_FLOAT;
}

/**
 * Integer division that rounds toward -Infinity and +Infinity respectively, `b` positive.
 *
 * Bigint `/` truncates toward zero, so both need a correction on the negative side, and the
 * negative side is reached by ordinary input: a window that starts before record 0 is how a
 * pre-stimulus epoch is spelled. They live here, beside the tick conversions, because every
 * caller is dividing a tick count by another tick count and three modules had grown their own
 * copies of the same four lines.
 */
export function floorDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b === 0n || a > 0n ? quotient : quotient - 1n;
}

/**
 * Division rounding toward positive infinity, the counterpart to `floorDiv` above. BigInt `/`
 * truncates toward zero, so neither direction is what the operator gives for a negative operand —
 * and a time before the recording's start is exactly where that matters.
 */
export function ceilDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b === 0n || a < 0n ? quotient : quotient + 1n;
}

const INT64_MIN: bigint = -(2n ** 63n);
const INT64_MAX: bigint = 2n ** 63n - 1n;

/**
 * Clamps a tick count to what a `BigInt64Array` element can hold.
 *
 * Assignment to a `BigInt64Array` wraps modulo 2^64 rather than throwing, and every onset array
 * in edfcore is one. Wrapping turns a monotonically increasing series into one that jumps
 * backwards, which downstream code reads as a genuine discontinuity: a file whose declared
 * record duration overflows the range then indexes as one segment per record, with negative
 * gaps between them and no diagnostic anywhere.
 *
 * Saturating keeps the array non-decreasing, so an absurd geometry stays visibly absurd instead
 * of becoming plausibly wrong. Reaching either bound needs a declared geometry that is already
 * impossible — over 29,000 years of records — but `recordDuration` is a free-form ASCII field
 * that accepts exponent notation, so three bytes are enough to ask for it.
 */
export function saturateToInt64(ticks: bigint): bigint {
  if (ticks > INT64_MAX) return INT64_MAX;
  if (ticks < INT64_MIN) return INT64_MIN;
  return ticks;
}

/**
 * Seconds to ticks, rounded to the NEAREST tick (ties away from zero is not required; ties go
 * toward +Infinity, as `Math.round` does).
 *
 * Only for user-supplied bounds such as a time window, never for a value read from disk: a
 * caller's `30.0` must resolve to 300000000 ticks and not to 299999999 because `30 * 1e7` landed
 * one ULP low. On-disk values reach ticks through the digit parsers above, which never round.
 *
 * Throws `RangeError` for a non-finite argument: there is no tick count for NaN or Infinity, and
 * inventing 0 would silently move a window to the file start.
 */
export function secondsToTicks(seconds: number): bigint {
  if (!Number.isFinite(seconds)) {
    throw new RangeError(
      `expected a finite number of seconds, received ${seconds}. ` +
        'Next: check the window bound you passed in.',
    );
  }
  return BigInt(Math.round(seconds * TICKS_PER_SECOND_FLOAT));
}
