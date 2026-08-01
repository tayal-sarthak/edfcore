/**
 * The two EDF numeric grammars.
 *
 * Layer 0. Imports nothing. Sole owner of turning an 8-byte ASCII field into a number.
 *
 * The spec says these fields are ASCII, left-justified and space-padded. Real files break
 * that in every way imaginable, so parsing reports *why* it failed rather than returning NaN
 * and leaving the caller to guess which diagnostic the bytes deserve: a comma decimal is
 * fatal, a right-justified field is a warning, and `'20 48'` is neither of those.
 */

/**
 * The outcome of parsing one numeric field.
 *
 * `ok === false` means `value` is meaningless — it is NaN, so a caller that ignores this flag
 * fails loudly instead of quietly recording a plausible 0.
 *
 * `problem` is single-valued and ordered by how much it matters: a field that is both
 * right-justified and comma-separated reports `'comma-decimal'`, because that is the one the
 * caller must refuse.
 */
export interface EdfNumberParse {
  readonly ok: boolean;
  readonly value: number;
  /** The field exactly as it was read, padding included. */
  readonly raw: string;
  readonly problem: 'none' | 'empty' | 'comma-decimal' | 'not-left-justified' | 'malformed';
}

type EdfNumberProblem = EdfNumberParse['problem'];

const CHAR_NUL = 0x00;
const CHAR_SPACE = 0x20;

/** No decimal point and no exponent — see `parseEdfInteger`. */
const INTEGER_GRAMMAR = /^[+-]?[0-9]+$/;

/** `'.5'`, `'+22'`, `'1E3'` and `'-1.23E-4'` are all emitted by real writers. */
const NUMBER_GRAMMAR = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

function isPadding(code: number): boolean {
  return code === CHAR_SPACE || code === CHAR_NUL;
}

function failure(raw: string, problem: EdfNumberProblem): EdfNumberParse {
  return { ok: false, value: Number.NaN, raw, problem };
}

function containsNul(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === CHAR_NUL) return true;
  }
  return false;
}

function parseField(raw: string, grammar: RegExp, integral: boolean): EdfNumberParse {
  let start = 0;
  let end = raw.length;
  while (start < end && isPadding(raw.charCodeAt(start))) start++;
  while (end > start && isPadding(raw.charCodeAt(end - 1))) end--;
  const core = raw.slice(start, end);

  // Distinct from malformed: an all-space field is a writer omitting a value, not corrupting
  // one, and several fields are legally blank.
  if (core.length === 0) return failure(raw, 'empty');

  if (core.includes(',')) {
    // '0,5' (half) and '1,024' (a thousand and twenty-four) are indistinguishable, and
    // substituting '.' in the second silently turns 1024 into 1.024. Fatal, never guessed.
    // Reported as comma-decimal only when the field is otherwise numeric; 'a,b' is just junk.
    const substituted = core.replaceAll(',', '.');
    return failure(raw, NUMBER_GRAMMAR.test(substituted) ? 'comma-decimal' : 'malformed');
  }

  // Embedded whitespace inside the digits reaches here intact: '20 48' fails the grammar and
  // is malformed, never 2048 and never 20.
  if (!grammar.test(core)) return failure(raw, 'malformed');

  const value = Number(core);
  // Guards a digit string too long for exact float64 (integral) or one like '1e999' that
  // overflows to Infinity. Neither can come from an 8-byte field, but this function takes a
  // string, not a field.
  if (integral ? !Number.isSafeInteger(value) : !Number.isFinite(value)) {
    return failure(raw, 'malformed');
  }

  // The value is trustworthy; the layout is not. Leading padding means right-justified, and a
  // NUL anywhere in the padding means the writer used the wrong pad byte. Both parse, and
  // both are worth a NUMERIC_FIELD_NOT_LEFT_JUSTIFIED warning.
  const leftJustified = start === 0 && !containsNul(raw.slice(end));
  return { ok: true, value, raw, problem: leftJustified ? 'none' : 'not-left-justified' };
}

/**
 * Parse a field that must be a whole number: signal count, samples per record, record count,
 * digital minimum and maximum.
 *
 * Exponent forms are deliberately rejected. Every field parsed by this function sizes the
 * file geometry, and `'1E3'` in one of them is far likelier to be corruption than a writer's
 * idea of 1000 — accepting it would turn unreadable bytes into a confidently wrong offset.
 * `'256.0'` is rejected for the same reason.
 */
export function parseEdfInteger(raw: string): EdfNumberParse {
  return parseField(raw, INTEGER_GRAMMAR, true);
}

/**
 * Parse a field that may be fractional: physical minimum and maximum, record duration.
 *
 * Accepts a leading sign, a bare leading or trailing point, and an exponent, because writers
 * in the wild emit `'+22'`, `'.5'`, `'1E3'` and `'-1.23E-4'`.
 */
export function parseEdfNumber(raw: string): EdfNumberParse {
  return parseField(raw, NUMBER_GRAMMAR, false);
}
