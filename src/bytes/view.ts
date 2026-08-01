/**
 * Bounds-checked slicing.
 *
 * Layer 0. Every offset here is a plain JS number — exact to 2^53 — and is never touched by
 * `|0`, `<<`, `>>` or `>>>`. A data offset in a multi-gigabyte BDF routinely exceeds 2^31,
 * where every bitwise operator silently wraps it to a negative number. (Bitwise ops are
 * correct and required for SAMPLE decoding, which operates on 16- and 24-bit values.)
 */

import { decodeHeaderLatin1 } from './latin1.js';

/**
 * A plain `RangeError`, deliberately not `EdfRangeError`: reaching here means edfcore
 * computed an offset wrongly, or a caller mixed a header with bytes from another file.
 * `EdfRangeError` is reserved for the honest case of a caller asking for records that do not
 * exist, and conflating the two would let an internal bug present itself as user error.
 */
function assertInBounds(bytes: Uint8Array, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError(`byte offset must be a non-negative safe integer, got ${offset}`);
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError(`byte length must be a non-negative safe integer, got ${length}`);
  }
  if (offset + length > bytes.length) {
    throw new RangeError(
      `byte range [${offset}, ${offset + length}) is outside the ${bytes.length}-byte buffer`,
    );
  }
}

/**
 * A VIEW of `length` bytes at `offset`, sharing memory with `bytes` — no copy is made.
 *
 * Nothing in edfcore mutates a source buffer, so a view is safe to read for as long as the
 * buffer lives. A caller that pools or reuses buffers must not retain the view past that
 * reuse: use `copyBytes` when the bytes have to outlive the read that produced them.
 */
export function sliceBytes(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  assertInBounds(bytes, offset, length);
  return bytes.subarray(offset, offset + length);
}

/** `length` bytes at `offset`, copied into a buffer of their own. */
export function copyBytes(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  assertInBounds(bytes, offset, length);
  return bytes.slice(offset, offset + length);
}

/**
 * The RAW, untrimmed text of a fixed-width header field, decoded as ISO-8859-1.
 *
 * Untrimmed on purpose: `raw.*` on the header exposes what the file actually wrote, and the
 * numeric grammars need the padding to tell a right-justified field from a conformant one.
 * Callers that want the value trim it themselves with `trimEdfField`.
 */
export function readAsciiField(bytes: Uint8Array, offset: number, length: number): string {
  return decodeHeaderLatin1(sliceBytes(bytes, offset, length));
}
