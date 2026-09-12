/**
 * Header text decoding.
 *
 * Layer 0. Imports nothing. Sole owner of turning header bytes into strings.
 *
 * ISO-8859-1 is the identity map onto U+0000..U+00FF, so the whole decoder is
 * `String.fromCharCode`. `TextDecoder` is banned here and everywhere outside `src/tal/`:
 * verified on Node v24.4.0, `TextDecoder('latin1' | 'iso-8859-1' | 'ascii' | 'windows-1252')`
 * all report `encoding === 'windows-1252'` yet decode 0x80 as U+0080, while the WHATWG
 * Encoding Standard mandates U+20AC for those labels. The same header bytes would therefore
 * produce different strings in Node and in a spec-compliant browser.
 */

/** Padding bytes an EDF field may carry. Space is the spec's; NUL is what writers emit. */
const CHAR_NUL = 0x00;
const CHAR_SPACE = 0x20;

/** The spec's legal header alphabet. Anything outside it is Latin-1 in practice. */
const PRINTABLE_ASCII_MIN = 0x20;
const PRINTABLE_ASCII_MAX = 0x7e;

/**
 * Well under every engine's argument-count limit (Safari's is the lowest, ~65k), so a
 * maximal 2.56 MB header costs 625 calls rather than one that throws.
 */
const CHUNK_BYTES = 4096;

function fromCharCodes(bytes: Uint8Array): string {
  // A Uint8Array is an array-like at runtime, which is all `apply` needs; the strict
  // `Function.prototype.apply` signature only admits `number[]`, hence the cast.
  return String.fromCharCode.apply(null, bytes as unknown as number[]);
}

/**
 * The one-byte-per-element tags, written out rather than shared with `io/source.ts`'s `isByteArray`.
 *
 * This module is Layer 0 and imports nothing, which is the property that lets the header decoder be
 * the one thing in the package with no dependencies. `a-header-that-was-never-bytes.test.ts`
 * asserts the two admit the same set, which is the drift `io/bytes.ts` records being bitten by in
 * 0.2.23 when one of its two copies was rewritten and the other was missed.
 */
const BYTE_ARRAY_TAGS = new Set(['[object Uint8Array]', '[object Uint8ClampedArray]']);

/**
 * Decode header bytes as ISO-8859-1: byte `b` becomes code point U+00`b`, always.
 *
 * Never `TextDecoder` — see the module comment.
 */
export function decodeHeaderLatin1(bytes: Uint8Array): string {
  /*
   * The two wrong views both produced text rather than an error, which is the worst pair of
   * outcomes a decoder can have. An `ArrayBuffer` has no `length`, so `undefined <= 4096` is false,
   * the chunk loop never ran, and the whole header decoded to `''`. An `Int8Array` has one byte per
   * element, so it passed every length check and then decoded every byte above 0x7f to a different
   * character — 0xb5, the bare micro sign real equipment writes, came out as U+FFB5. `byteSource`
   * refuses exactly this pair at construction and says why; this is the same refusal one layer
   * down, where the bytes are actually read (fixed in 0.6.96).
   */
  if (!ArrayBuffer.isView(bytes) || !BYTE_ARRAY_TAGS.has(Object.prototype.toString.call(bytes))) {
    throw new RangeError(
      'decodeHeaderLatin1() needs a Uint8Array. An ArrayBuffer has no length, so it decoded to ' +
        'the empty string; an Int8Array has one byte per element, so it decoded every byte above ' +
        '0x7f to a different character. Next: pass `new Uint8Array(buffer)` for an ArrayBuffer, ' +
        'and `new Uint8Array(view.buffer, view.byteOffset, view.byteLength)` for any other view.',
    );
  }
  if (bytes.length <= CHUNK_BYTES) return fromCharCodes(bytes);
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
    parts.push(fromCharCodes(bytes.subarray(start, Math.min(start + CHUNK_BYTES, bytes.length))));
  }
  return parts.join('');
}

/**
 * True when the range holds any byte outside printable ASCII 32..126 — the alphabet the EDF
 * spec allows in a header field. Drives `NON_ASCII_HEADER_FIELD`, which is a warning: the
 * field still decodes truthfully as Latin-1, and real equipment writes accented names and a
 * bare 0xB5 for micro.
 *
 * Trailing NUL padding counts, deliberately: it is outside the alphabet too, and the caller
 * that wants to tolerate it can check the padding itself.
 */
export function hasNonPrintableAscii(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte < PRINTABLE_ASCII_MIN || byte > PRINTABLE_ASCII_MAX) return true;
  }
  return false;
}

/**
 * What EDF field padding is, once, for the four modules that act on it.
 *
 * `trimEdfField` below states the rule and the reason: only 0x20 and 0x00, because a trailing TAB
 * or CR is not padding but content the file should not contain, and hiding it here would hide it
 * from `NON_ASCII_HEADER_FIELD`. `bytes/numbers.ts` trims the same padding before parsing a number
 * and `header/fields.ts` finds a field's content bounds inside its own bytes, `header/variant.ts` decides whether the version block is `'0'` and
 * seven pad bytes, and each had grown a byte-identical copy of these two lines with its own pair
 * of constants.
 *
 * Three copies of a rule are three chances for two of them to disagree, and the disagreement would
 * not look like one: a field would trim one way for display and another way for its numeric parse,
 * so `NUMERIC_FIELD_NOT_LEFT_JUSTIFIED` would fire on a field `trimEdfField` had already called
 * clean. `padding.test.ts` checks the rule across all 256 byte values from both public
 * sides, and that every module acting on it imports this rather than growing another.
 */
export function isEdfPadding(code: number): boolean {
  return code === CHAR_SPACE || code === CHAR_NUL;
}

/**
 * Strip EDF field padding: spaces and NULs, from both ends.
 *
 * EDF pads on the RIGHT with spaces, so trailing padding is the expected case. Leading
 * padding is stripped as well, and that choice is deliberate: a label written `'  Fp1'`
 * names the same electrode as `'Fp1   '`, and text fields are compared, not measured. No
 * evidence is lost by it — every field is also exposed raw and untrimmed, and for numeric
 * fields the non-conformance is reported separately by `parseEdfInteger`/`parseEdfNumber`,
 * which read the untrimmed string.
 *
 * Only 0x20 and 0x00 are stripped. A trailing TAB or CR is not padding, it is content the
 * file should not contain, and hiding it here would hide it from `NON_ASCII_HEADER_FIELD`.
 */
export function trimEdfField(text: string): string {
  let start = 0;
  let end = text.length;
  while (end > start && isEdfPadding(text.charCodeAt(end - 1))) end--;
  while (start < end && isEdfPadding(text.charCodeAt(start))) start++;
  return text.slice(start, end);
}
