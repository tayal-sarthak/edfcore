/**
 * Bytes as hex, in prose.
 *
 * Layer 0. Imports nothing.
 *
 * Two modules had a private `hexBytes` under the same name and they disagreed about the answer.
 * `header/fields.ts` wrote `0x4b 0x61 0x9f`; `header/variant.ts` wrote `44 6f 77`, in a sentence
 * that goes on to say "nor BDF's 0xFF followed by BIOSEMI" — both spellings of a byte, three
 * words apart, in one message. Without the prefix a short run reads as a decimal number until the
 * eye reaches a digit above 9, which on the `NOT_AN_EDF_FILE` diagnostic is the fifth byte.
 *
 * `0x` per byte, because that message is the argument: the author reached for it the moment a
 * single byte had to be named, and a list is the same claim repeated.
 *
 * This is NOT the renderer for the `rawBytes` block under a diagnostic. That one is a dump with an
 * ASCII column beside it — `30 20 20 20  |0   |` — where the columns are the point and a prefix on
 * every byte would push the ASCII off the line. It stays in `diagnostics/format.ts`, bare, and the
 * difference is that one is prose and the other is a hex dump.
 */

/** How many bytes a message quotes before eliding. Enough to recognise the problem. */
const DEFAULT_MAX_BYTES = 16;

/** `'0x9f'`. */
export function hexByte(byte: number): string {
  return `0x${byte.toString(16).padStart(2, '0')}`;
}

/**
 * `'0x4b 0x61 0x9f'`, from `from`, eliding with `...` on whichever side was cut.
 *
 * The ellipses are what stop a quoted run being read as the whole field: a caller pointing at the
 * first bad byte 40 bytes into an 80-byte identification field is showing a window, and a window
 * that does not say so is a claim about the field.
 */
export function hexBytes(
  bytes: Uint8Array,
  from: number = 0,
  max: number = DEFAULT_MAX_BYTES,
): string {
  const start = Math.max(0, from);
  const shown = bytes.subarray(start, start + max);
  const parts: string[] = [];
  for (const byte of shown) parts.push(hexByte(byte));
  const head = start > 0 ? '... ' : '';
  const tail = start + shown.length < bytes.length ? ' ...' : '';
  return head + parts.join(' ') + tail;
}
